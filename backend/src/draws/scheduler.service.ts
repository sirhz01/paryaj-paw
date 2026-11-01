import { HttpStatus, Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { CLOCK, Clock } from '../common/clock';
import { AppError } from '../common/errors';
import { AppConfig, CONFIG } from '../config';
import { DATABASE, Database } from '../database/db';
import { hashServerSeed, newServerSeed } from '../fairness/provably-fair';
import { DrawEventsService } from './events.service';
import { DRAW_GAMES, DrawGame, drawBalls } from './games';
import { SettlementService } from './settlement.service';
import { DrawSettingsService } from './settings.service';

/** Au-delà de ce retard (serveur arrêté, panne), le tirage n'est plus « à l'heure » : il est annulé et remboursé. */
export const MISSED_DRAW_GRACE_MS = 60_000;
const TICK_MS = 1000;

/**
 * Planificateur des tirages programmés. Chaque seconde : crée les prochains créneaux (graine tirée,
 * hash publié), tire les tirages arrivés à l'heure et règle les tickets. Plusieurs instances peuvent
 * tourner : un tirage n'est pris que par une seule (FOR UPDATE SKIP LOCKED), un créneau n'est créé qu'une fois.
 */
@Injectable()
export class DrawScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DrawScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly settings: DrawSettingsService,
    private readonly settlement: SettlementService,
    private readonly events: DrawEventsService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    // En test, les tirages avancent à la main avec `tick()`.
    if (this.config.env !== 'test') this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const game of DRAW_GAMES) {
        await this.ensureUpcoming(game);
        await this.runDue(game);
        await this.recover(game);
      }
    } catch (error) {
      this.logger.error('Tirages programmés : échec du cycle', error as Error);
    } finally {
      this.running = false;
    }
  }

  /** Crée les tirages des prochains créneaux, assez pour le ticket le plus long. */
  async ensureUpcoming(game: DrawGame): Promise<void> {
    const { config } = await this.settings.current(game);
    const step = config.intervalMinutes * 60_000;
    const first = Math.ceil(this.clock.now().getTime() / step) * step;
    const slots = Array.from({ length: config.maxDrawsPerTicket + 2 }, (_, i) => first + i * step);

    const { rows } = await this.db.query<{ scheduled_at: Date }>(
      'SELECT scheduled_at FROM draws WHERE game = $1 AND scheduled_at >= $2 AND scheduled_at <= $3',
      [game, new Date(slots[0]), new Date(slots[slots.length - 1])],
    );
    const existing = new Set(rows.map((r) => r.scheduled_at.getTime()));
    for (const slot of slots.filter((s) => !existing.has(s))) {
      const seed = newServerSeed();
      await this.db.query(
        `INSERT INTO draws (game, scheduled_at, closes_at, server_seed, server_seed_hash)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (game, scheduled_at) DO NOTHING`,
        [game, new Date(slot), new Date(slot - config.closeBeforeSeconds * 1000), seed, hashServerSeed(seed)],
      );
    }
  }

  /** Tire chaque tirage arrivé à l'heure, puis règle ses tickets ; annule ceux qui ont trop de retard. */
  async runDue(game: DrawGame): Promise<void> {
    for (;;) {
      const now = this.clock.now();
      const due = await this.db.transaction(async (tx) => {
        const { rows } = await tx.query<{ id: number; server_seed: string; scheduled_at: Date }>(
          `SELECT id, server_seed, scheduled_at FROM draws
            WHERE game = $1 AND status = 'scheduled' AND scheduled_at <= $2
            ORDER BY scheduled_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [game, now],
        );
        const draw = rows[0];
        if (!draw) return null;
        if (now.getTime() - draw.scheduled_at.getTime() > MISSED_DRAW_GRACE_MS) {
          await tx.query(`UPDATE draws SET status = 'cancelled', cancel_reason = 'missed' WHERE id = $1`, [draw.id]);
          return { id: draw.id, scheduledAt: draw.scheduled_at, balls: null };
        }
        const balls = drawBalls(game, draw.server_seed, draw.id);
        await tx.query(`UPDATE draws SET status = 'drawn', balls = $2::smallint[], drawn_at = $3 WHERE id = $1`, [
          draw.id,
          balls,
          now,
        ]);
        return { id: draw.id, scheduledAt: draw.scheduled_at, balls, serverSeed: draw.server_seed };
      });
      if (!due) return;

      if (due.balls === null) {
        this.logger.warn(`${game} : tirage ${due.id} manqué, mises remboursées`);
        this.events.publish('draw.cancelled', { game, drawId: due.id, scheduledAt: due.scheduledAt, reason: 'missed' });
        await this.settlement.refundDraw(due.id);
      } else {
        this.events.publish('draw.result', { game, drawId: due.id, scheduledAt: due.scheduledAt, balls: due.balls, serverSeed: due.serverSeed });
        await this.settlement.settleDraw(due.id);
      }
    }
  }

  /** Annulation par le back-office (incident) d'un tirage pas encore tiré : les mises sont rendues. */
  async cancel(staffId: number, drawId: number, reason: string): Promise<void> {
    const game = await this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ game: DrawGame }>(
        `UPDATE draws SET status = 'cancelled', cancel_reason = $2 WHERE id = $1 AND status = 'scheduled' RETURNING game`,
        [drawId, reason],
      );
      if (!rows[0]) throw new AppError('DRAW_NOT_SCHEDULED', HttpStatus.CONFLICT);
      await this.audit.log(staffId, 'draw.cancel', { type: 'draw', id: drawId }, { reason }, tx);
      return rows[0].game;
    });
    this.events.publish('draw.cancelled', { game, drawId, reason });
    await this.settlement.refundDraw(drawId);
  }

  /** Reprend un règlement ou un remboursement interrompu (redémarrage pendant le traitement). */
  async recover(game: DrawGame): Promise<void> {
    const { rows } = await this.db.query<{ id: number; status: string }>(
      `SELECT d.id, d.status FROM draws d
        WHERE d.game = $1 AND (d.status = 'drawn'
          OR (d.status = 'cancelled' AND EXISTS (SELECT 1 FROM ticket_entries e WHERE e.draw_id = d.id AND e.status = 'pending')))`,
      [game],
    );
    for (const draw of rows) {
      if (draw.status === 'drawn') await this.settlement.settleDraw(draw.id);
      else await this.settlement.refundDraw(draw.id);
    }
  }
}
