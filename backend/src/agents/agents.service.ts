import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuditService } from '../common/audit.service';
import { AppError } from '../common/errors';
import { HAITI_TIME_ZONE, SQL_HAITI_DAY_START, normalizeHaitiPhone } from '../common/haiti';
import { AppConfig, CONFIG } from '../config';
import { DATABASE, Database, isUniqueViolation } from '../database/db';
import { pickupCodeHash } from '../payments/payments.service';
import { WalletService } from '../wallet/wallet.service';
import { AgentWalletService } from './agent-wallet.service';

const AGENT_TOKEN_TTL_SECONDS = 12 * 3600;

export interface AgentInput {
  name: string;
  phone: string;
  password: string;
  location?: string;
  ticketCommissionBp: number;
  depositCommissionBp: number;
  creditLimitCents: number;
}

export interface AgentUpdate {
  name?: string;
  location?: string;
  status?: 'active' | 'blocked';
  ticketCommissionBp?: number;
  depositCommissionBp?: number;
  creditLimitCents?: number;
}

const COLUMNS = `id, code, name, phone, location, status, balance_cents AS "balanceCents",
  credit_limit_cents AS "creditLimitCents", ticket_commission_bp AS "ticketCommissionBp",
  deposit_commission_bp AS "depositCommissionBp", created_at AS "createdAt"`;

const commissionOf = (amountCents: number, bp: number) => Math.floor((amountCents * bp) / 10_000);

@Injectable()
export class AgentsService {
  private dummyHash?: Promise<string>;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly jwt: JwtService,
    private readonly agentWallet: AgentWalletService,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
  ) {}

  // Back-office -------------------------------------------------------------------------------

  /** Code d'agent attribué dans l'ordre : PV0001, PV0002… (imprimé sur les tickets). */
  async create(staffId: number, input: AgentInput) {
    const phone = this.phone(input.phone);
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    try {
      return await this.db.transaction(async (tx) => {
        const { rows } = await tx.query<{ id: number }>(
          `WITH next AS (SELECT nextval('agents_id_seq') AS id)
           INSERT INTO agents (id, code, name, phone, password_hash, location, ticket_commission_bp, deposit_commission_bp,
                               credit_limit_cents, created_by)
           SELECT id, 'PV' || lpad(id::text, 4, '0'), $1, $2, $3, $4, $5, $6, $7, $8 FROM next
           RETURNING id`,
          [input.name, phone, passwordHash, input.location ?? null, input.ticketCommissionBp, input.depositCommissionBp,
            input.creditLimitCents, staffId],
        );
        await this.audit.log(staffId, 'agent.create', { type: 'agent', id: rows[0].id }, {
          ticketCommissionBp: input.ticketCommissionBp,
          depositCommissionBp: input.depositCommissionBp,
          creditLimitCents: input.creditLimitCents,
        }, tx);
        return this.get(rows[0].id, tx);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('PHONE_ALREADY_REGISTERED', HttpStatus.CONFLICT);
      throw error;
    }
  }

  async get(agentId: number, q = this.db as Pick<Database, 'query'>) {
    const { rows } = await q.query(`SELECT ${COLUMNS} FROM agents WHERE id = $1`, [agentId]);
    if (!rows[0]) throw new AppError('AGENT_NOT_FOUND', HttpStatus.NOT_FOUND);
    return rows[0];
  }

  async list(search: string | undefined, limit: number) {
    const { rows } = await this.db.query(
      `SELECT ${COLUMNS} FROM agents
        WHERE $1::text IS NULL OR code ILIKE '%' || $1 || '%' OR name ILIKE '%' || $1 || '%' OR phone LIKE '%' || $1 || '%'
        ORDER BY id DESC LIMIT $2`,
      [search ?? null, limit],
    );
    return rows;
  }

  /** Blocage, taux de commission (pour les ventes à venir) et limite de crédit. */
  async update(staffId: number, agentId: number, changes: AgentUpdate) {
    try {
      return await this.db.transaction(async (tx) => {
        const { rows } = await tx.query<{ id: number }>(
          `UPDATE agents
              SET name = COALESCE($2, name), location = COALESCE($3, location), status = COALESCE($4, status),
                  ticket_commission_bp = COALESCE($5, ticket_commission_bp),
                  deposit_commission_bp = COALESCE($6, deposit_commission_bp),
                  credit_limit_cents = COALESCE($7, credit_limit_cents)
            WHERE id = $1 RETURNING id`,
          [agentId, changes.name ?? null, changes.location ?? null, changes.status ?? null,
            changes.ticketCommissionBp ?? null, changes.depositCommissionBp ?? null, changes.creditLimitCents ?? null],
        );
        if (!rows[0]) throw new AppError('AGENT_NOT_FOUND', HttpStatus.NOT_FOUND);
        await this.audit.log(staffId, 'agent.update', { type: 'agent', id: agentId }, { ...changes }, tx);
        return this.get(agentId, tx);
      });
    } catch (error) {
      // La limite ne peut pas descendre sous la dette actuelle de l'agent.
      if ((error as { code?: string }).code === '23514') throw new AppError('CREDIT_LIMIT_BELOW_DEBT', HttpStatus.CONFLICT);
      throw error;
    }
  }

  /** L'agent a versé du liquide à l'exploitant (`topup`) ou a été payé de son crédit (`withdrawal`). */
  adjustFloat(staffId: number, agentId: number, direction: 'topup' | 'withdrawal', amountCents: number, reference: string) {
    return this.db.transaction(async (tx) => {
      await this.agentWallet.lock(tx, agentId);
      const kind = direction === 'topup' ? 'float_topup' : 'float_withdrawal';
      const balanceCents = await this.agentWallet.post(tx, agentId, kind, direction === 'topup' ? amountCents : -amountCents, {
        type: 'staff',
        id: staffId,
      });
      await this.audit.log(staffId, `agent.${kind}`, { type: 'agent', id: agentId }, { amountCents, reference }, tx);
      return { agentId, balanceCents };
    });
  }

  // Agent ---------------------------------------------------------------------------------------

  async login(rawPhone: string, password: string) {
    const phone = normalizeHaitiPhone(rawPhone);
    const { rows } = phone
      ? await this.db.query<{ id: number; password_hash: string; status: string }>(
          'SELECT id, password_hash, status FROM agents WHERE phone = $1',
          [phone],
        )
      : { rows: [] };
    const agent = rows[0];
    this.dummyHash ??= argon2.hash('dummy-password', { type: argon2.argon2id });
    const valid = await argon2.verify(agent?.password_hash ?? (await this.dummyHash), password);
    if (!agent || !valid) throw new AppError('INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED);
    if (agent.status !== 'active') throw new AppError('AGENT_BLOCKED', HttpStatus.FORBIDDEN);
    const accessToken = await this.jwt.signAsync(
      { sub: String(agent.id), typ: 'agent' },
      { secret: this.config.agentJwtSecret, expiresIn: AGENT_TOKEN_TTL_SECONDS },
    );
    return { accessToken, expiresIn: AGENT_TOKEN_TTL_SECONDS };
  }

  /**
   * Dépôt en liquide sur le compte d'un joueur : son portefeuille est crédité, le crédit de vente de l'agent
   * débité, la commission de dépôt versée aussitôt. Mêmes règles qu'un dépôt en ligne (blocage, auto-exclusion, limite).
   */
  async depositForPlayer(agentId: number, req: { phone: string; amountCents: number; idempotencyKey: string }) {
    const userId = await this.playerId(req.phone);
    const key = `agent-${agentId}-${req.idempotencyKey}`;
    try {
      return await this.db.transaction(async (tx) => {
        const { rows: existing } = await tx.query('SELECT id FROM payments WHERE user_id = $1 AND idempotency_key = $2', [userId, key]);
        if (existing[0]) return this.payment(existing[0].id as number, tx);

        // Ordre des verrous : le portefeuille du joueur, puis l'agent.
        await this.wallet.lock(tx, userId);
        const agent = await this.agentWallet.lockActive(tx, agentId);
        const { rows } = await tx.query<{ status: string; excluded: boolean; limit: number | null; today: number }>(
          `SELECT u.status, COALESCE(u.self_excluded_until > now(), false) AS excluded, u.daily_deposit_limit_cents AS "limit",
                  (SELECT COALESCE(sum(amount_cents), 0)::bigint FROM payments
                    WHERE user_id = u.id AND direction = 'deposit' AND status IN ('pending', 'completed')
                      AND created_at >= ${SQL_HAITI_DAY_START}) AS today
             FROM users u WHERE u.id = $1`,
          [userId],
        );
        const user = rows[0];
        if (user.status === 'blocked') throw new AppError('ACCOUNT_BLOCKED', HttpStatus.FORBIDDEN);
        if (user.excluded) throw new AppError('SELF_EXCLUDED', HttpStatus.FORBIDDEN);
        if (user.limit !== null && user.today + req.amountCents > user.limit) {
          throw new AppError('DEPOSIT_LIMIT_REACHED', HttpStatus.FORBIDDEN, { dailyDepositLimitCents: user.limit });
        }

        const { rows: inserted } = await tx.query<{ id: number }>(
          `INSERT INTO payments (user_id, direction, provider, amount_cents, status, idempotency_key, agent_id, provider_ref)
           VALUES ($1, 'deposit', 'agent', $2, 'completed', $3, $4, $5) RETURNING id`,
          [userId, req.amountCents, key, agentId, `agent:${agentId}`],
        );
        const ref = { type: 'payment', id: inserted[0].id };
        await this.agentWallet.post(tx, agentId, 'player_deposit', -req.amountCents, ref);
        await this.wallet.post(tx, userId, 'deposit', req.amountCents, ref);
        const commission = commissionOf(req.amountCents, agent.depositCommissionBp);
        if (commission > 0) await this.agentWallet.post(tx, agentId, 'commission', commission, ref);
        return this.payment(inserted[0].id, tx);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const { rows } = await this.db.query('SELECT id FROM payments WHERE user_id = $1 AND idempotency_key = $2', [userId, key]);
        if (rows[0]) return this.payment(rows[0].id as number);
      }
      throw error;
    }
  }

  /** Remise en liquide d'un retrait au guichet : téléphone du joueur et code qu'il a généré, valable 24 h. */
  async payWithdrawal(agentId: number, req: { phone: string; code: string }) {
    const userId = await this.playerId(req.phone);
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: number; amount_cents: number }>(
        `SELECT id, amount_cents FROM payments
          WHERE user_id = $1 AND provider = 'agent' AND direction = 'withdrawal' AND status = 'processing'
            AND pickup_code_hash = $2 AND pickup_expires_at > now()
          FOR UPDATE`,
        [userId, pickupCodeHash(this.config.otpPepper, userId, req.code)],
      );
      const payment = rows[0];
      if (!payment) throw new AppError('PICKUP_CODE_INVALID');
      await this.agentWallet.lockActive(tx, agentId);
      await tx.query(
        `UPDATE payments SET status = 'completed', agent_id = $2, provider_ref = $3, pickup_code_hash = NULL, updated_at = now()
          WHERE id = $1`,
        [payment.id, agentId, `agent:${agentId}`],
      );
      await this.agentWallet.post(tx, agentId, 'player_withdrawal', payment.amount_cents, { type: 'payment', id: payment.id });
      return this.payment(payment.id, tx);
    });
  }

  /** Sommes par type de mouvement sur la période (jours en heure d'Haïti), tickets vendus et crédit actuel. */
  async summary(agentId: number, from: string, to: string) {
    const range = `created_at >= ($2::date::timestamp AT TIME ZONE '${HAITI_TIME_ZONE}')
      AND created_at < (($3::date + 1)::timestamp AT TIME ZONE '${HAITI_TIME_ZONE}')`;
    const { rows: byKind } = await this.db.query<{ kind: string; total: number; count: number }>(
      `SELECT kind, sum(amount_cents)::bigint AS total, count(*)::int AS count
         FROM agent_ledger WHERE agent_id = $1 AND ${range} GROUP BY kind`,
      [agentId, from, to],
    );
    const { rows: sales } = await this.db.query<{ tickets: number; stakes: number }>(
      `SELECT count(*)::int AS tickets, COALESCE(sum(total_stake_cents), 0)::bigint AS stakes
         FROM tickets WHERE agent_id = $1 AND ${range}`,
      [agentId, from, to],
    );
    const total = (kind: string) => byKind.find((k) => k.kind === kind)?.total ?? 0;
    const agent = await this.get(agentId);
    return {
      agent,
      from,
      to,
      ticketsSold: sales[0].tickets,
      ticketSalesCents: -total('ticket_sale'),
      ticketPayoutsCents: total('ticket_payout'),
      playerDepositsCents: -total('player_deposit'),
      playerWithdrawalsCents: total('player_withdrawal'),
      commissionsCents: total('commission'),
      floatTopupsCents: total('float_topup'),
      floatWithdrawalsCents: -total('float_withdrawal'),
      /** Liquide que l'agent devrait avoir encaissé sur la période (ventes + dépôts − gains payés − retraits). */
      netCashCents: -total('ticket_sale') - total('ticket_payout') - total('player_deposit') - total('player_withdrawal'),
    };
  }

  private async payment(id: number, q: Pick<Database, 'query'> = this.db) {
    const { rows } = await q.query(
      `SELECT id, user_id AS "userId", direction, provider, amount_cents AS "amountCents", status,
              agent_id AS "agentId", created_at AS "createdAt", updated_at AS "updatedAt"
         FROM payments WHERE id = $1`,
      [id],
    );
    return rows[0];
  }

  private async playerId(rawPhone: string): Promise<number> {
    const phone = normalizeHaitiPhone(rawPhone);
    const { rows } = phone ? await this.db.query<{ id: number }>('SELECT id FROM users WHERE phone = $1', [phone]) : { rows: [] };
    if (!rows[0]) throw new AppError('PLAYER_NOT_FOUND', HttpStatus.NOT_FOUND);
    return rows[0].id;
  }

  private phone(raw: string): string {
    const phone = normalizeHaitiPhone(raw);
    if (!phone) throw new AppError('INVALID_PHONE');
    return phone;
  }
}
