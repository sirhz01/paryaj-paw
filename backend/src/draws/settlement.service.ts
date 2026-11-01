import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { CLOCK, Clock } from '../common/clock';
import { AppError } from '../common/errors';
import { DATABASE, Database, Queryable } from '../database/db';
import { AgentWalletService } from '../agents/agent-wallet.service';
import { payoutCents } from '../keno/paytable';
import { WalletService } from '../wallet/wallet.service';
import { DrawGame, TicketBet, betMultiplier } from './games';
import { DrawSettingsService } from './settings.service';

const CHUNK = 500;

interface PendingEntry {
  id: number;
  /** Ticket de joueur : gains et remboursements passent par son portefeuille. */
  user_id: number | null;
  /** Ticket vendu au guichet : le liquide est payé à la présentation du ticket, l'agent touche sa commission. */
  agent_id: number | null;
  stake_cents: number;
  commission_bp: number;
  bet: TicketBet;
  settings_version: number;
}

/**
 * Règlement des tickets d'un tirage, par lots dans des transactions courtes.
 * Chaque lot verrouille les portefeuilles des joueurs puis les agents, dans l'ordre ; relancer un règlement est sans risque.
 */
@Injectable()
export class SettlementService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly wallet: WalletService,
    private readonly agentWallet: AgentWalletService,
    private readonly settings: DrawSettingsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Gagnant, perdant ou en revue (gros gain). Les gains ordinaires des joueurs sont crédités aussitôt ;
   * ceux des tickets d'agent attendent leur paiement au guichet. La commission de l'agent porte sur les mises jouées.
   */
  async settleDraw(drawId: number): Promise<void> {
    const { rows } = await this.db.query<{ game: DrawGame; balls: number[]; status: string }>(
      'SELECT game, balls, status FROM draws WHERE id = $1',
      [drawId],
    );
    const draw = rows[0];
    if (draw?.status !== 'drawn') return;

    await this.eachPendingChunk(drawId, async (tx, entries) => {
      for (const entry of entries) {
        const { config } = await this.settings.byVersion(entry.settings_version, tx);
        const multiplier = betMultiplier(draw.game, entry.bet, draw.balls, config);
        const payout = payoutCents(entry.stake_cents, multiplier, config.maxPayoutCents);
        const status = payout === 0 ? 'lost' : payout > config.reviewThresholdCents ? 'review' : 'won';
        const commission = entry.agent_id === null ? 0 : Math.floor((entry.stake_cents * entry.commission_bp) / 10_000);
        await tx.query(
          'UPDATE ticket_entries SET status = $2, payout_cents = $3, commission_cents = $4, settled_at = $5 WHERE id = $1',
          [entry.id, status, payout, commission, this.clock.now()],
        );
        const ref = { type: 'ticket_entry', id: entry.id };
        if (status === 'won' && entry.user_id !== null) {
          await this.wallet.lock(tx, entry.user_id);
          await this.wallet.post(tx, entry.user_id, 'win', payout, ref);
        }
        if (commission > 0) {
          await this.agentWallet.lock(tx, entry.agent_id!);
          await this.agentWallet.post(tx, entry.agent_id!, 'commission', commission, ref);
        }
      }
    });
    await this.db.query(`UPDATE draws SET status = 'settled', settled_at = $2 WHERE id = $1 AND status = 'drawn'`, [
      drawId,
      this.clock.now(),
    ]);
  }

  /** Tirage annulé : la mise est rendue au portefeuille du joueur, ou au guichet pour un ticket d'agent. */
  async refundDraw(drawId: number): Promise<void> {
    await this.eachPendingChunk(drawId, async (tx, entries) => {
      for (const entry of entries) {
        await tx.query(`UPDATE ticket_entries SET status = 'refunded', settled_at = $2 WHERE id = $1`, [entry.id, this.clock.now()]);
        if (entry.user_id === null) continue;
        await this.wallet.lock(tx, entry.user_id);
        await this.wallet.post(tx, entry.user_id, 'bet_refund', entry.stake_cents, { type: 'ticket_entry', id: entry.id });
      }
    });
  }

  async pendingReviews(limit: number) {
    const { rows } = await this.db.query(
      `SELECT e.id AS "entryId", t.code AS "ticketCode", t.game, e.user_id AS "userId", u.phone,
              a.code AS "agentCode", e.draw_id AS "drawId", t.bet, e.stake_cents AS "stakeCents",
              e.payout_cents AS "payoutCents", e.settled_at AS "settledAt"
         FROM ticket_entries e JOIN tickets t ON t.id = e.ticket_id
         LEFT JOIN users u ON u.id = e.user_id LEFT JOIN agents a ON a.id = e.agent_id
        WHERE e.status = 'review' ORDER BY e.id LIMIT $1`,
      [limit],
    );
    return rows;
  }

  /** Gros gain validé : crédité au joueur, ou payable au guichet pour un ticket d'agent. */
  approve(staffId: number, entryId: number) {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ user_id: number | null; payout_cents: number }>(
        `UPDATE ticket_entries SET status = 'won', reviewed_by = $2, reviewed_at = $3
          WHERE id = $1 AND status = 'review' RETURNING user_id, payout_cents`,
        [entryId, staffId, this.clock.now()],
      );
      if (!rows[0]) throw new AppError('ENTRY_NOT_IN_REVIEW', HttpStatus.CONFLICT);
      const userId = rows[0].user_id;
      if (userId !== null) {
        await this.wallet.lock(tx, userId);
        await this.wallet.post(tx, userId, 'win', rows[0].payout_cents, { type: 'ticket_entry', id: entryId });
      }
      await this.audit.log(staffId, 'ticket.win.approve', { type: 'ticket_entry', id: entryId }, {}, tx);
      return { entryId, status: 'won', payoutCents: rows[0].payout_cents };
    });
  }

  /** Gros gain refusé (fraude, erreur) : pas de gain, la mise est rendue (au guichet pour un ticket d'agent). */
  reject(staffId: number, entryId: number, reason: string) {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ user_id: number | null; stake_cents: number }>(
        `UPDATE ticket_entries SET status = 'rejected', reviewed_by = $2, reviewed_at = $3, review_note = $4
          WHERE id = $1 AND status = 'review' RETURNING user_id, stake_cents`,
        [entryId, staffId, this.clock.now(), reason],
      );
      if (!rows[0]) throw new AppError('ENTRY_NOT_IN_REVIEW', HttpStatus.CONFLICT);
      const userId = rows[0].user_id;
      if (userId !== null) {
        await this.wallet.lock(tx, userId);
        await this.wallet.post(tx, userId, 'bet_refund', rows[0].stake_cents, { type: 'ticket_entry', id: entryId });
      }
      await this.audit.log(staffId, 'ticket.win.reject', { type: 'ticket_entry', id: entryId }, { reason }, tx);
      return { entryId, status: 'rejected' };
    });
  }

  private async eachPendingChunk(
    drawId: number,
    handle: (tx: Queryable, entries: PendingEntry[]) => Promise<void>,
  ): Promise<void> {
    for (;;) {
      const done = await this.db.transaction(async (tx) => {
        const { rows } = await tx.query<PendingEntry>(
          `SELECT e.id, e.user_id, e.agent_id, e.stake_cents, t.commission_bp, t.bet, t.settings_version
             FROM ticket_entries e JOIN tickets t ON t.id = e.ticket_id
            WHERE e.draw_id = $1 AND e.status = 'pending'
            ORDER BY e.user_id NULLS LAST, e.agent_id, e.id LIMIT ${CHUNK}
            FOR UPDATE OF e SKIP LOCKED`,
          [drawId],
        );
        if (rows.length === 0) return true;
        await handle(tx, rows);
        return false;
      });
      if (done) return;
    }
  }
}
