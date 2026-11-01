import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { CLOCK, Clock } from '../common/clock';
import { AppError } from '../common/errors';
import { DATABASE, Database, Queryable } from '../database/db';
import { payoutCents } from '../keno/paytable';
import { WalletService } from '../wallet/wallet.service';
import { DrawGame, TicketBet, betMultiplier } from './games';
import { DrawSettingsService } from './settings.service';

const CHUNK = 500;

interface PendingEntry {
  id: number;
  user_id: number;
  stake_cents: number;
  bet: TicketBet;
  settings_version: number;
}

/**
 * Règlement des tickets d'un tirage, par lots dans des transactions courtes.
 * Chaque lot verrouille les portefeuilles dans l'ordre des joueurs ; relancer un règlement est sans risque.
 */
@Injectable()
export class SettlementService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly wallet: WalletService,
    private readonly settings: DrawSettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Gagnant, perdant ou en revue (gros gain) ; les gains ordinaires sont crédités aussitôt. */
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
        await tx.query('UPDATE ticket_entries SET status = $2, payout_cents = $3, settled_at = $4 WHERE id = $1', [
          entry.id,
          status,
          payout,
          this.clock.now(),
        ]);
        if (status === 'won') {
          await this.wallet.lock(tx, entry.user_id);
          await this.wallet.post(tx, entry.user_id, 'win', payout, { type: 'ticket_entry', id: entry.id });
        }
      }
    });
    await this.db.query(`UPDATE draws SET status = 'settled', settled_at = $2 WHERE id = $1 AND status = 'drawn'`, [
      drawId,
      this.clock.now(),
    ]);
  }

  /** Tirage annulé : chaque mise est rendue au portefeuille. */
  async refundDraw(drawId: number): Promise<void> {
    await this.eachPendingChunk(drawId, async (tx, entries) => {
      for (const entry of entries) {
        await tx.query(`UPDATE ticket_entries SET status = 'refunded', settled_at = $2 WHERE id = $1`, [entry.id, this.clock.now()]);
        await this.wallet.lock(tx, entry.user_id);
        await this.wallet.post(tx, entry.user_id, 'bet_refund', entry.stake_cents, { type: 'ticket_entry', id: entry.id });
      }
    });
  }

  async pendingReviews(limit: number) {
    const { rows } = await this.db.query(
      `SELECT e.id AS "entryId", t.code AS "ticketCode", t.game, e.user_id AS "userId", u.phone, e.draw_id AS "drawId",
              t.bet, e.stake_cents AS "stakeCents", e.payout_cents AS "payoutCents", e.settled_at AS "settledAt"
         FROM ticket_entries e JOIN tickets t ON t.id = e.ticket_id JOIN users u ON u.id = e.user_id
        WHERE e.status = 'review' ORDER BY e.id LIMIT $1`,
      [limit],
    );
    return rows;
  }

  /** Gros gain validé : crédité au joueur. */
  approve(staffId: number, entryId: number) {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ user_id: number; payout_cents: number }>(
        `UPDATE ticket_entries SET status = 'won', reviewed_by = $2, reviewed_at = $3
          WHERE id = $1 AND status = 'review' RETURNING user_id, payout_cents`,
        [entryId, staffId, this.clock.now()],
      );
      if (!rows[0]) throw new AppError('ENTRY_NOT_IN_REVIEW', HttpStatus.CONFLICT);
      await this.wallet.lock(tx, rows[0].user_id);
      await this.wallet.post(tx, rows[0].user_id, 'win', rows[0].payout_cents, { type: 'ticket_entry', id: entryId });
      await this.audit.log(staffId, 'ticket.win.approve', { type: 'ticket_entry', id: entryId }, {}, tx);
      return { entryId, status: 'won', payoutCents: rows[0].payout_cents };
    });
  }

  /** Gros gain refusé (fraude, erreur) : pas de gain, la mise est rendue. */
  reject(staffId: number, entryId: number, reason: string) {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ user_id: number; stake_cents: number }>(
        `UPDATE ticket_entries SET status = 'rejected', reviewed_by = $2, reviewed_at = $3, review_note = $4
          WHERE id = $1 AND status = 'review' RETURNING user_id, stake_cents`,
        [entryId, staffId, this.clock.now(), reason],
      );
      if (!rows[0]) throw new AppError('ENTRY_NOT_IN_REVIEW', HttpStatus.CONFLICT);
      await this.wallet.lock(tx, rows[0].user_id);
      await this.wallet.post(tx, rows[0].user_id, 'bet_refund', rows[0].stake_cents, { type: 'ticket_entry', id: entryId });
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
          `SELECT e.id, e.user_id, e.stake_cents, t.bet, t.settings_version
             FROM ticket_entries e JOIN tickets t ON t.id = e.ticket_id
            WHERE e.draw_id = $1 AND e.status = 'pending'
            ORDER BY e.user_id, e.id LIMIT ${CHUNK}
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
