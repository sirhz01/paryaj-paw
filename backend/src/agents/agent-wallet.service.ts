import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { DATABASE, Database, Queryable } from '../database/db';

export type AgentLedgerKind =
  | 'float_topup'
  | 'float_withdrawal'
  | 'ticket_sale'
  | 'ticket_payout'
  | 'player_deposit'
  | 'player_withdrawal'
  | 'commission';

export interface LockedAgent {
  balanceCents: number;
  creditLimitCents: number;
  status: 'active' | 'blocked';
  ticketCommissionBp: number;
  depositCommissionBp: number;
}

/**
 * Seul point d'écriture du crédit de vente des agents, sur le modèle du portefeuille joueur :
 * chaque mouvement ajoute une ligne au journal append-only `agent_ledger`.
 * Ordre des verrous : portefeuilles joueurs d'abord, agents ensuite.
 */
@Injectable()
export class AgentWalletService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async lock(tx: Queryable, agentId: number): Promise<LockedAgent> {
    const { rows } = await tx.query<LockedAgent>(
      `SELECT balance_cents AS "balanceCents", credit_limit_cents AS "creditLimitCents", status,
              ticket_commission_bp AS "ticketCommissionBp", deposit_commission_bp AS "depositCommissionBp"
         FROM agents WHERE id = $1 FOR UPDATE`,
      [agentId],
    );
    if (!rows[0]) throw new AppError('AGENT_NOT_FOUND', HttpStatus.NOT_FOUND);
    return rows[0];
  }

  /** Verrouille l'agent et refuse s'il est bloqué. */
  async lockActive(tx: Queryable, agentId: number): Promise<LockedAgent> {
    const agent = await this.lock(tx, agentId);
    if (agent.status !== 'active') throw new AppError('AGENT_BLOCKED', HttpStatus.FORBIDDEN);
    return agent;
  }

  /** Mouvement signé ; refuse de descendre sous −limite de crédit. Appeler `lock` avant, dans la même transaction. */
  async post(
    tx: Queryable,
    agentId: number,
    kind: AgentLedgerKind,
    amountCents: number,
    ref: { type: string; id: string | number },
  ): Promise<number> {
    const { rows } = await tx.query<{ balance_cents: number }>(
      `UPDATE agents SET balance_cents = balance_cents + $2
        WHERE id = $1 AND balance_cents + $2 >= -credit_limit_cents
        RETURNING balance_cents`,
      [agentId, amountCents],
    );
    if (!rows[0]) throw new AppError('INSUFFICIENT_FLOAT');
    await tx.query(
      `INSERT INTO agent_ledger (agent_id, kind, amount_cents, balance_after_cents, ref_type, ref_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [agentId, kind, amountCents, rows[0].balance_cents, ref.type, String(ref.id)],
    );
    return rows[0].balance_cents;
  }

  async ledger(agentId: number, limit: number, beforeId?: number) {
    const { rows } = await this.db.query(
      `SELECT id, kind, amount_cents AS "amountCents", balance_after_cents AS "balanceAfterCents",
              ref_type AS "refType", ref_id AS "refId", created_at AS "createdAt"
         FROM agent_ledger WHERE agent_id = $1 AND ($2::bigint IS NULL OR id < $2)
        ORDER BY id DESC LIMIT $3`,
      [agentId, beforeId ?? null, limit],
    );
    return rows;
  }
}
