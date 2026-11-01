import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { HAITI_TIME_ZONE } from '../common/haiti';
import { DATABASE, Database, Queryable } from '../database/db';

export type LedgerKind = 'deposit' | 'withdrawal' | 'withdrawal_refund' | 'bet' | 'win' | 'bet_refund' | 'adjustment';

export interface LedgerEntry {
  id: number;
  kind: LedgerKind;
  amountCents: number;
  balanceAfterCents: number;
  refType: string;
  refId: string;
  createdAt: Date;
}

export interface TransactionQuery {
  from?: string;
  to?: string;
  beforeId?: number;
  limit: number;
}

/**
 * Seul point d'écriture des soldes. Chaque mouvement est une ligne du journal
 * (append-only) portant le solde obtenu : le solde est toujours la somme du journal.
 */
@Injectable()
export class WalletService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Verrouille le portefeuille jusqu'à la fin de la transaction et renvoie son solde. */
  async lock(tx: Queryable, userId: number): Promise<number> {
    const { rows } = await tx.query<{ balance_cents: number }>(
      'SELECT balance_cents FROM wallets WHERE user_id = $1 FOR UPDATE',
      [userId],
    );
    if (!rows[0]) throw new AppError('WALLET_NOT_FOUND', HttpStatus.NOT_FOUND);
    return rows[0].balance_cents;
  }

  /** Mouvement signé ; refuse tout solde négatif. Appeler `lock` avant, dans la même transaction. */
  async post(
    tx: Queryable,
    userId: number,
    kind: LedgerKind,
    amountCents: number,
    ref: { type: string; id: string | number },
  ): Promise<number> {
    const { rows } = await tx.query<{ balance_cents: number }>(
      `UPDATE wallets SET balance_cents = balance_cents + $2, updated_at = now()
        WHERE user_id = $1 AND balance_cents + $2 >= 0
        RETURNING balance_cents`,
      [userId, amountCents],
    );
    if (!rows[0]) throw new AppError('INSUFFICIENT_FUNDS');
    await tx.query(
      `INSERT INTO ledger_entries (user_id, kind, amount_cents, balance_after_cents, ref_type, ref_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, kind, amountCents, rows[0].balance_cents, ref.type, String(ref.id)],
    );
    return rows[0].balance_cents;
  }

  async balance(userId: number): Promise<number> {
    const { rows } = await this.db.query<{ balance_cents: number }>(
      'SELECT balance_cents FROM wallets WHERE user_id = $1',
      [userId],
    );
    if (!rows[0]) throw new AppError('WALLET_NOT_FOUND', HttpStatus.NOT_FOUND);
    return rows[0].balance_cents;
  }

  /** Historique du plus récent au plus ancien ; `from` et `to` sont des jours (AAAA-MM-JJ) en heure d'Haïti. */
  async transactions(userId: number, q: TransactionQuery): Promise<LedgerEntry[]> {
    const { rows } = await this.db.query<{
      id: number;
      kind: LedgerKind;
      amount_cents: number;
      balance_after_cents: number;
      ref_type: string;
      ref_id: string;
      created_at: Date;
    }>(
      `SELECT id, kind, amount_cents, balance_after_cents, ref_type, ref_id, created_at
         FROM ledger_entries
        WHERE user_id = $1
          AND ($2::date IS NULL OR created_at >= ($2::date::timestamp AT TIME ZONE '${HAITI_TIME_ZONE}'))
          AND ($3::date IS NULL OR created_at < (($3::date + 1)::timestamp AT TIME ZONE '${HAITI_TIME_ZONE}'))
          AND ($4::bigint IS NULL OR id < $4)
        ORDER BY id DESC
        LIMIT $5`,
      [userId, q.from ?? null, q.to ?? null, q.beforeId ?? null, q.limit],
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      amountCents: r.amount_cents,
      balanceAfterCents: r.balance_after_cents,
      refType: r.ref_type,
      refId: r.ref_id,
      createdAt: r.created_at,
    }));
  }
}
