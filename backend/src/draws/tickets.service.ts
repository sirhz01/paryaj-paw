import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { CLOCK, Clock } from '../common/clock';
import { AppError } from '../common/errors';
import { PlayRulesService } from '../common/play-rules.service';
import { DATABASE, Database, Queryable, isUniqueViolation } from '../database/db';
import { WalletService } from '../wallet/wallet.service';
import { DrawGame, InvalidTicketBetError, TicketBet, normalizeTicketBet } from './games';
import { DrawScheduler } from './scheduler.service';
import { DrawSettingsService } from './settings.service';

export interface TicketRequest {
  game: DrawGame;
  bet: TicketBet;
  stakeCents: number;
  /** Nombre de tirages consécutifs couverts, à partir du prochain encore ouvert. */
  draws: number;
  idempotencyKey: string;
}

export type EntryStatus = 'pending' | 'won' | 'lost' | 'review' | 'rejected' | 'refunded';

export interface TicketView {
  code: string;
  game: DrawGame;
  bet: TicketBet;
  stakePerDrawCents: number;
  totalStakeCents: number;
  /** En attente tant qu'un tirage reste à jouer ou à valider, gagnant dès qu'un tirage paie. */
  status: 'pending' | 'won' | 'lost' | 'refunded';
  payoutCents: number;
  createdAt: Date;
  entries: {
    drawId: number;
    scheduledAt: string;
    status: EntryStatus;
    payoutCents: number;
    balls: number[] | null;
    serverSeedHash: string;
  }[];
}

/** Codes imprimables sans caractères ambigus (pas de 0, O, 1, I). */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function newTicketCode(): string {
  return [...randomBytes(10)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

const VIEW = `SELECT t.code, t.game, t.bet, t.stake_per_draw_cents AS "stakePerDrawCents",
         t.total_stake_cents AS "totalStakeCents", t.created_at AS "createdAt",
         json_agg(json_build_object(
           'drawId', d.id, 'scheduledAt', d.scheduled_at, 'status', e.status, 'payoutCents', e.payout_cents,
           'balls', d.balls, 'serverSeedHash', d.server_seed_hash) ORDER BY d.scheduled_at) AS entries
    FROM tickets t JOIN ticket_entries e ON e.ticket_id = t.id JOIN draws d ON d.id = e.draw_id`;

function toView(row: Omit<TicketView, 'status' | 'payoutCents'>): TicketView {
  const statuses = row.entries.map((e) => e.status);
  const status = statuses.some((s) => s === 'pending' || s === 'review')
    ? 'pending'
    : statuses.includes('won')
      ? 'won'
      : statuses.every((s) => s === 'refunded')
        ? 'refunded'
        : 'lost';
  const payoutCents = row.entries.filter((e) => e.status === 'won').reduce((sum, e) => sum + e.payoutCents, 0);
  return { ...row, status, payoutCents };
}

@Injectable()
export class TicketsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly wallet: WalletService,
    private readonly settings: DrawSettingsService,
    private readonly scheduler: DrawScheduler,
    private readonly playRules: PlayRulesService,
  ) {}

  /** Débite toute la mise d'avance et inscrit le ticket aux prochains tirages encore ouverts. */
  async buy(userId: number, req: TicketRequest): Promise<TicketView> {
    const { version, config } = await this.settings.current(req.game);
    let bet: TicketBet;
    try {
      bet = normalizeTicketBet(req.game, req.bet, config);
    } catch (error) {
      if (error instanceof InvalidTicketBetError) throw new AppError('INVALID_BET', HttpStatus.BAD_REQUEST, { type: error.message });
      throw error;
    }
    if (req.stakeCents < config.minStakeCents || req.stakeCents > config.maxStakeCents) {
      throw new AppError('STAKE_OUT_OF_RANGE', HttpStatus.BAD_REQUEST, {
        minStakeCents: config.minStakeCents,
        maxStakeCents: config.maxStakeCents,
      });
    }
    if (req.draws < 1 || req.draws > config.maxDrawsPerTicket) {
      throw new AppError('INVALID_DRAW_COUNT', HttpStatus.BAD_REQUEST, { maxDrawsPerTicket: config.maxDrawsPerTicket });
    }
    const total = req.stakeCents * req.draws;

    const replay = await this.findByKey(this.db, userId, req.idempotencyKey);
    if (replay) return replay;
    await this.scheduler.ensureUpcoming(req.game);

    try {
      return await this.db.transaction(async (tx) => {
        const balance = await this.wallet.lock(tx, userId);
        const again = await this.findByKey(tx, userId, req.idempotencyKey);
        if (again) return again;
        await this.playRules.check(tx, userId, total);
        if (balance < total) throw new AppError('INSUFFICIENT_FUNDS');

        // FOR SHARE : le planificateur ne peut pas tirer ces tirages tant que le ticket n'est pas inscrit.
        const { rows: draws } = await tx.query<{ id: number }>(
          `SELECT id FROM draws WHERE game = $1 AND status = 'scheduled' AND closes_at > $2
            ORDER BY scheduled_at LIMIT $3 FOR SHARE`,
          [req.game, this.clock.now(), req.draws],
        );
        if (draws.length < req.draws) throw new AppError('DRAWS_NOT_AVAILABLE', HttpStatus.CONFLICT);

        const { rows } = await tx.query<{ id: number }>(
          `INSERT INTO tickets (code, user_id, game, idempotency_key, bet, stake_per_draw_cents, total_stake_cents, settings_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [newTicketCode(), userId, req.game, req.idempotencyKey, JSON.stringify(bet), req.stakeCents, total, version],
        );
        const ticketId = rows[0].id;
        for (const draw of draws) {
          await tx.query('INSERT INTO ticket_entries (ticket_id, draw_id, user_id, stake_cents) VALUES ($1, $2, $3, $4)', [
            ticketId,
            draw.id,
            userId,
            req.stakeCents,
          ]);
        }
        await this.wallet.post(tx, userId, 'bet', -total, { type: 'ticket', id: ticketId });
        return (await this.findByKey(tx, userId, req.idempotencyKey))!;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const replay = await this.findByKey(this.db, userId, req.idempotencyKey);
        if (replay) return replay;
      }
      throw error;
    }
  }

  async list(userId: number, game: DrawGame | undefined, limit: number): Promise<TicketView[]> {
    const { rows } = await this.db.query<Omit<TicketView, 'status' | 'payoutCents'>>(
      `${VIEW} WHERE t.user_id = $1 AND ($2::text IS NULL OR t.game = $2)
        GROUP BY t.id ORDER BY t.id DESC LIMIT $3`,
      [userId, game ?? null, limit],
    );
    return rows.map(toView);
  }

  async byCode(userId: number, code: string): Promise<TicketView> {
    const { rows } = await this.db.query<Omit<TicketView, 'status' | 'payoutCents'>>(
      `${VIEW} WHERE t.user_id = $1 AND t.code = $2 GROUP BY t.id`,
      [userId, code.toUpperCase()],
    );
    if (!rows[0]) throw new AppError('TICKET_NOT_FOUND', HttpStatus.NOT_FOUND);
    return toView(rows[0]);
  }

  private async findByKey(q: Queryable, userId: number, key: string): Promise<TicketView | undefined> {
    const { rows } = await q.query<Omit<TicketView, 'status' | 'payoutCents'>>(
      `${VIEW} WHERE t.user_id = $1 AND t.idempotency_key = $2 GROUP BY t.id`,
      [userId, key],
    );
    return rows[0] && toView(rows[0]);
  }
}
