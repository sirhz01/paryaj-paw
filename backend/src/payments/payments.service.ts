import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomInt } from 'node:crypto';
import { AuditService } from '../common/audit.service';
import { AppError } from '../common/errors';
import { SQL_HAITI_DAY_START } from '../common/haiti';
import { AppConfig, CONFIG } from '../config';
import { DATABASE, Database, Queryable, isUniqueViolation } from '../database/db';
import { WalletService } from '../wallet/wallet.service';
import { PAYMENT_PROVIDERS, PaymentProvider, ProviderName } from './providers/provider';

export type PaymentStatus = 'pending' | 'awaiting_approval' | 'processing' | 'completed' | 'failed' | 'rejected';

export interface Payment {
  id: number;
  userId: number;
  direction: 'deposit' | 'withdrawal';
  provider: ProviderName;
  amountCents: number;
  status: PaymentStatus;
  providerRef: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentRequest {
  provider: ProviderName;
  amountCents: number;
  idempotencyKey: string;
}

/** Durée de validité d'un code de retrait au guichet. */
const PICKUP_CODE_TTL_HOURS = 24;

/** Empreinte d'un code de retrait : liée au joueur, jamais stockée en clair. */
export function pickupCodeHash(pepper: string, userId: number, code: string): string {
  return createHmac('sha256', pepper).update(`pickup:${userId}:${code}`).digest('hex');
}

const COLUMNS = `id, user_id AS "userId", direction, provider, amount_cents AS "amountCents", status,
  provider_ref AS "providerRef", failure_reason AS "failureReason", created_at AS "createdAt", updated_at AS "updatedAt"`;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: Map<ProviderName, PaymentProvider>,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
  ) {}

  async deposit(userId: number, req: PaymentRequest): Promise<Payment & { redirectUrl?: string }> {
    // Au guichet, c'est l'agent qui enregistre le dépôt (POST /agent/deposits).
    if (req.provider === 'agent') throw new AppError('PROVIDER_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE, { provider: 'agent' });
    const provider = this.provider(req.provider);
    const replay = await this.findByKey(userId, req.idempotencyKey);
    if (replay) return replay;

    const user = await this.user(userId);
    if (user.status === 'blocked') throw new AppError('ACCOUNT_BLOCKED', HttpStatus.FORBIDDEN);
    if (user.excluded) throw new AppError('SELF_EXCLUDED', HttpStatus.FORBIDDEN);
    if (user.depositLimit !== null && user.depositedToday + req.amountCents > user.depositLimit) {
      throw new AppError('DEPOSIT_LIMIT_REACHED', HttpStatus.FORBIDDEN, { dailyDepositLimitCents: user.depositLimit });
    }

    let payment: Payment;
    try {
      const { rows } = await this.db.query<Payment>(
        `INSERT INTO payments (user_id, direction, provider, amount_cents, status, idempotency_key)
         VALUES ($1, 'deposit', $2, $3, 'pending', $4) RETURNING ${COLUMNS}`,
        [userId, req.provider, req.amountCents, req.idempotencyKey],
      );
      payment = rows[0];
    } catch (error) {
      if (isUniqueViolation(error)) return (await this.findByKey(userId, req.idempotencyKey))!;
      throw error;
    }

    const started = await provider.startDeposit(payment.id, payment.amountCents, user.phone);
    const { rows } = await this.db.query<Payment>(
      `UPDATE payments SET provider_ref = $2, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
      [payment.id, started.providerRef],
    );
    return { ...rows[0], redirectUrl: started.redirectUrl };
  }

  /** Demande au fournisseur où en est le dépôt et crédite le portefeuille une seule fois. */
  async checkDeposit(userId: number, paymentId: number): Promise<Payment> {
    const payment = await this.find(paymentId, userId);
    if (payment.direction !== 'deposit') throw new AppError('PAYMENT_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (payment.status !== 'pending' || !payment.providerRef) return payment;

    const result = await this.provider(payment.provider).checkDeposit(payment.providerRef);
    if (result.status === 'pending') return payment;

    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<Payment>(`SELECT ${COLUMNS} FROM payments WHERE id = $1 FOR UPDATE`, [paymentId]);
      const current = rows[0];
      if (current.status !== 'pending') return current;

      if (result.status === 'completed' && result.amountCents === current.amountCents) {
        await this.wallet.lock(tx, userId);
        await this.wallet.post(tx, userId, 'deposit', current.amountCents, { type: 'payment', id: current.id });
        return this.setStatus(tx, current.id, 'completed');
      }
      const reason = result.status === 'completed' ? 'amount_mismatch' : 'provider_failed';
      return this.setStatus(tx, current.id, 'failed', reason);
    });
  }

  /**
   * Débite tout de suite ; au-dessus du seuil, le retrait attend la validation de la finance.
   * Avec `agent`, le joueur génère ensuite un code de retrait et touche le liquide au guichet.
   */
  async withdraw(userId: number, req: PaymentRequest): Promise<Payment> {
    if (req.provider !== 'agent') this.provider(req.provider);
    const replay = await this.findByKey(userId, req.idempotencyKey);
    if (replay) return replay;

    let payment: Payment;
    try {
      payment = await this.db.transaction(async (tx) => {
        await this.wallet.lock(tx, userId);
        const user = await this.user(userId, tx);
        if (user.status === 'blocked') throw new AppError('ACCOUNT_BLOCKED', HttpStatus.FORBIDDEN);
        if (user.kycStatus !== 'verified') throw new AppError('KYC_REQUIRED', HttpStatus.FORBIDDEN);

        const status: PaymentStatus =
          req.amountCents > this.config.withdrawalApprovalThresholdCents ? 'awaiting_approval' : 'processing';
        const { rows } = await tx.query<Payment>(
          `INSERT INTO payments (user_id, direction, provider, amount_cents, status, idempotency_key)
           VALUES ($1, 'withdrawal', $2, $3, $4, $5) RETURNING ${COLUMNS}`,
          [userId, req.provider, req.amountCents, status, req.idempotencyKey],
        );
        await this.wallet.post(tx, userId, 'withdrawal', -req.amountCents, { type: 'payment', id: rows[0].id });
        return rows[0];
      });
    } catch (error) {
      if (isUniqueViolation(error)) return (await this.findByKey(userId, req.idempotencyKey))!;
      throw error;
    }
    return payment.status === 'processing' ? this.executePayout(payment.id) : payment;
  }

  async list(userId: number, limit: number): Promise<Payment[]> {
    const { rows } = await this.db.query<Payment>(
      `SELECT ${COLUMNS} FROM payments WHERE user_id = $1 ORDER BY id DESC LIMIT $2`,
      [userId, limit],
    );
    return rows;
  }

  async withdrawalsByStatus(status: PaymentStatus, limit: number): Promise<Payment[]> {
    const { rows } = await this.db.query<Payment>(
      `SELECT ${COLUMNS} FROM payments WHERE direction = 'withdrawal' AND status = $1 ORDER BY id LIMIT $2`,
      [status, limit],
    );
    return rows;
  }

  async approveWithdrawal(staffId: number, paymentId: number): Promise<Payment> {
    await this.db.transaction(async (tx) => {
      const { rows } = await tx.query(
        `UPDATE payments SET status = 'processing', reviewed_by = $2, reviewed_at = now(), updated_at = now()
          WHERE id = $1 AND direction = 'withdrawal' AND status = 'awaiting_approval' RETURNING id`,
        [paymentId, staffId],
      );
      if (!rows[0]) throw new AppError('PAYMENT_NOT_AWAITING_APPROVAL', HttpStatus.CONFLICT);
      await this.audit.log(staffId, 'withdrawal.approve', { type: 'payment', id: paymentId }, {}, tx);
    });
    return this.executePayout(paymentId);
  }

  async rejectWithdrawal(staffId: number, paymentId: number, reason: string): Promise<Payment> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<Payment>(
        `UPDATE payments SET status = 'rejected', failure_reason = $3, reviewed_by = $2, reviewed_at = now(), updated_at = now()
          WHERE id = $1 AND direction = 'withdrawal' AND status = 'awaiting_approval' RETURNING ${COLUMNS}`,
        [paymentId, staffId, reason],
      );
      const payment = rows[0];
      if (!payment) throw new AppError('PAYMENT_NOT_AWAITING_APPROVAL', HttpStatus.CONFLICT);
      await this.wallet.lock(tx, payment.userId);
      await this.wallet.post(tx, payment.userId, 'withdrawal_refund', payment.amountCents, { type: 'payment', id: payment.id });
      await this.audit.log(staffId, 'withdrawal.reject', { type: 'payment', id: paymentId }, { reason }, tx);
      return payment;
    });
  }

  /** Code à présenter au guichet avec son numéro de téléphone ; un nouveau code remplace le précédent. */
  async issuePickupCode(userId: number, paymentId: number): Promise<{ code: string; expiresAt: Date }> {
    const payment = await this.find(paymentId, userId);
    if (payment.provider !== 'agent' || payment.direction !== 'withdrawal') {
      throw new AppError('PAYMENT_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    if (payment.status !== 'processing') throw new AppError('PAYMENT_NOT_READY_FOR_PICKUP', HttpStatus.CONFLICT, { status: payment.status });
    const code = randomInt(0, 100_000_000).toString().padStart(8, '0');
    const { rows } = await this.db.query<{ expires_at: Date }>(
      `UPDATE payments SET pickup_code_hash = $2, pickup_expires_at = now() + make_interval(hours => $3::int), updated_at = now()
        WHERE id = $1 RETURNING pickup_expires_at AS expires_at`,
      [paymentId, pickupCodeHash(this.config.otpPepper, userId, code), PICKUP_CODE_TTL_HOURS],
    );
    return { code, expiresAt: rows[0].expires_at };
  }

  /** Retrait au guichet pas encore touché : annulé par le joueur, montant rendu au portefeuille. */
  cancelWithdrawal(userId: number, paymentId: number): Promise<Payment> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<Payment>(
        `UPDATE payments SET status = 'failed', failure_reason = 'cancelled_by_player', pickup_code_hash = NULL, updated_at = now()
          WHERE id = $1 AND user_id = $2 AND provider = 'agent' AND direction = 'withdrawal'
            AND status IN ('processing', 'awaiting_approval')
          RETURNING ${COLUMNS}`,
        [paymentId, userId],
      );
      const payment = rows[0];
      if (!payment) throw new AppError('PAYMENT_NOT_CANCELLABLE', HttpStatus.CONFLICT);
      await this.wallet.lock(tx, userId);
      await this.wallet.post(tx, userId, 'withdrawal_refund', payment.amountCents, { type: 'payment', id: payment.id });
      return payment;
    });
  }

  private async executePayout(paymentId: number): Promise<Payment> {
    const payment = await this.find(paymentId);
    // Retrait au guichet : il reste en traitement jusqu'à ce qu'un agent remette le liquide.
    if (payment.status !== 'processing' || payment.provider === 'agent') return payment;
    const { phone } = await this.user(payment.userId);

    let result: Awaited<ReturnType<PaymentProvider['payout']>>;
    try {
      result = await this.provider(payment.provider).payout(payment.id, payment.amountCents, phone);
    } catch (error) {
      this.logger.error(`Retrait ${payment.id} : issue inconnue, à rapprocher`, error as Error);
      return payment;
    }

    if (result.status === 'completed') {
      const { rows } = await this.db.query<Payment>(
        `UPDATE payments SET status = 'completed', provider_ref = $2, updated_at = now()
          WHERE id = $1 AND status = 'processing' RETURNING ${COLUMNS}`,
        [payment.id, result.providerRef],
      );
      return rows[0] ?? this.find(payment.id);
    }

    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<Payment>(
        `UPDATE payments SET status = 'failed', provider_ref = $2, failure_reason = $3, updated_at = now()
          WHERE id = $1 AND status = 'processing' RETURNING ${COLUMNS}`,
        [payment.id, result.providerRef, result.reason ?? 'provider_failed'],
      );
      if (!rows[0]) return this.find(payment.id, undefined, tx);
      await this.wallet.lock(tx, payment.userId);
      await this.wallet.post(tx, payment.userId, 'withdrawal_refund', payment.amountCents, { type: 'payment', id: payment.id });
      return rows[0];
    });
  }

  private async setStatus(tx: Queryable, id: number, status: PaymentStatus, reason?: string): Promise<Payment> {
    const { rows } = await tx.query<Payment>(
      `UPDATE payments SET status = $2, failure_reason = $3, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, status, reason ?? null],
    );
    return rows[0];
  }

  private async find(id: number, userId?: number, q: Queryable = this.db): Promise<Payment> {
    const { rows } = await q.query<Payment>(
      `SELECT ${COLUMNS} FROM payments WHERE id = $1 AND ($2::bigint IS NULL OR user_id = $2)`,
      [id, userId ?? null],
    );
    if (!rows[0]) throw new AppError('PAYMENT_NOT_FOUND', HttpStatus.NOT_FOUND);
    return rows[0];
  }

  private async findByKey(userId: number, key: string): Promise<Payment | undefined> {
    const { rows } = await this.db.query<Payment>(
      `SELECT ${COLUMNS} FROM payments WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, key],
    );
    return rows[0];
  }

  private async user(userId: number, q: Queryable = this.db) {
    const { rows } = await q.query<{
      phone: string;
      status: string;
      kycStatus: string;
      excluded: boolean;
      depositLimit: number | null;
      depositedToday: number;
    }>(
      `SELECT u.phone, u.status, u.kyc_status AS "kycStatus",
              COALESCE(u.self_excluded_until > now(), false) AS excluded,
              u.daily_deposit_limit_cents AS "depositLimit",
              (SELECT COALESCE(SUM(amount_cents), 0)::bigint FROM payments
                WHERE user_id = u.id AND direction = 'deposit' AND status IN ('pending', 'completed')
                  AND created_at >= ${SQL_HAITI_DAY_START}) AS "depositedToday"
         FROM users u WHERE u.id = $1`,
      [userId],
    );
    return rows[0];
  }

  private provider(name: ProviderName): PaymentProvider {
    const provider = this.providers.get(name);
    if (!provider) throw new AppError('PROVIDER_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE, { provider: name });
    return provider;
  }
}
