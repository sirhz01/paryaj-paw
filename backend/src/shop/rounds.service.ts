import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { DATABASE, Database, Queryable } from '../database/db';
import { hashServerSeed, newServerSeed } from '../fairness/provably-fair';
import { SHOP_CLOCK, ShopClock, RoundState, dayKeyOf, roundWindow, roundsInDay, stateAt } from './clock';
import { drawRound } from './draw';
import { CLOSE_MARGIN_SECONDS, SHOP_GAMES, ShopGame, ShopResult, TicketLine, ticketWin } from './games';
import { ShopSettings, ShopSettingsService } from './settings.service';

export const DAY_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

interface RoundRow {
  game: ShopGame;
  day: string;
  round: number;
  serverSeed: string;
  serverSeedHash: string;
  result: ShopResult;
}

export interface RoundView {
  game: ShopGame;
  day: string;
  round: number;
  serverSeedHash: string;
  startMs: number;
  drawStartMs: number;
  drawEndMs: number;
  /** Connu dès le début du tirage : l'écran l'anime, il ne le décide jamais. */
  result?: ShopResult;
  /** Publiée à la fin du tirage, pour recalculer le résultat. */
  serverSeed?: string;
}

const ROUND_COLUMNS = `game, day::text AS day, round_no AS round, server_seed AS "serverSeed",
  server_seed_hash AS "serverSeedHash", result`;

@Injectable()
export class RoundsService {
  /** Paramètres par version : ils ne changent jamais. */
  private readonly settingsCache = new Map<number, ShopSettings>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(SHOP_CLOCK) private readonly clock: ShopClock,
    private readonly settings: ShopSettingsService,
  ) {}

  now(): number {
    return this.clock.now();
  }

  private async find(game: ShopGame, day: string, round: number, q: Queryable = this.db): Promise<RoundRow | undefined> {
    const { rows } = await q.query<RoundRow>(
      `SELECT ${ROUND_COLUMNS} FROM shop_rounds WHERE game = $1 AND day = $2 AND round_no = $3`,
      [game, day, round],
    );
    return rows[0];
  }

  /**
   * Crée le tour (graine, hash, résultat) tant que son tirage n'a pas commencé et qu'il ne démarre pas
   * dans plus de `horizonCycles` cycles (1 par défaut ; une fiche multi-tours crée à l'avance les tours qu'elle joue).
   * Renvoie undefined si le tour a été manqué : aucun ticket ne peut alors exister.
   */
  async ensure(game: ShopGame, day: string, round: number, q: Queryable = this.db, horizonCycles = 1): Promise<RoundRow | undefined> {
    if (!DAY_FORMAT.test(day) || round < 1 || round > roundsInDay(game, day)) {
      throw new AppError('ROUND_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    const existing = await this.find(game, day, round, q);
    if (existing) return existing;

    const w = roundWindow(game, day, round);
    const now = this.now();
    if (now >= w.drawStartMs || w.startMs > now + horizonCycles * (w.nextStartMs - w.startMs)) return undefined;

    const serverSeed = newServerSeed();
    await q.query(
      `INSERT INTO shop_rounds (game, day, round_no, server_seed, server_seed_hash, result, draw_starts_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7::double precision / 1000), to_timestamp($8::double precision / 1000))
       ON CONFLICT DO NOTHING`,
      [game, day, round, serverSeed, hashServerSeed(serverSeed), JSON.stringify(drawRound(game, serverSeed, day, round)), w.drawStartMs, now],
    );
    return this.find(game, day, round, q);
  }

  /** Vue publique : le résultat et la graine n'apparaissent qu'aux moments prévus. */
  private view(row: RoundRow, now = this.now()): RoundView {
    const w = roundWindow(row.game, row.day, row.round);
    return {
      game: row.game,
      day: row.day,
      round: row.round,
      serverSeedHash: row.serverSeedHash,
      startMs: w.startMs,
      drawStartMs: w.drawStartMs,
      drawEndMs: w.drawEndMs,
      ...(now >= w.drawStartMs ? { result: row.result } : {}),
      ...(now >= w.drawEndMs ? { serverSeed: row.serverSeed } : {}),
    };
  }

  /** État de chaque jeu à l'instant présent, avec le hash du tour en cours. */
  async states(): Promise<{ serverTime: number; games: Record<string, RoundState & { serverSeedHash: string | null }> }> {
    const now = this.now();
    const games: Record<string, RoundState & { serverSeedHash: string | null }> = {};
    for (const game of SHOP_GAMES) {
      const s = stateAt(game, now);
      const row = await this.ensure(game, s.day, s.round);
      games[game] = { ...s, serverSeedHash: row?.serverSeedHash ?? null };
    }
    return { serverTime: now, games };
  }

  async get(game: ShopGame, day: string, round: number): Promise<RoundView> {
    if (!DAY_FORMAT.test(day) || round < 1 || round > roundsInDay(game, day)) {
      throw new AppError('ROUND_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    const row = await this.find(game, day, round);
    if (!row) throw new AppError('ROUND_NOT_FOUND', HttpStatus.NOT_FOUND);
    return this.view(row);
  }

  /** Derniers tours dont le tirage est terminé, du plus récent au plus ancien. */
  async latest(game: ShopGame, limit: number): Promise<RoundView[]> {
    const now = this.now();
    const { rows } = await this.db.query<RoundRow>(
      `SELECT ${ROUND_COLUMNS} FROM shop_rounds WHERE game = $1 AND draw_starts_at <= to_timestamp($2::double precision / 1000)
        ORDER BY day DESC, round_no DESC LIMIT $3`,
      [game, now, limit + 2],
    );
    return rows
      .map((r) => this.view(r, now))
      .filter((v) => v.serverSeed !== undefined)
      .slice(0, limit);
  }

  /** Recalcule un tirage à partir de la graine publiée. */
  verify(game: ShopGame, serverSeed: string, day: string, round: number) {
    return { serverSeedHash: hashServerSeed(serverSeed), result: drawRound(game, serverSeed, day, round) };
  }

  /** Crée les tours en cours et le suivant de chaque jeu : leur hash est publié avant la fermeture des mises. */
  async sealUpcoming(): Promise<void> {
    const now = this.now();
    for (const game of SHOP_GAMES) {
      const s = stateAt(game, now);
      await this.ensure(game, s.day, s.round);
      const next = stateAt(game, s.nextStartMs);
      if (s.nextStartMs - now <= (s.nextStartMs - s.startMs)) await this.ensure(game, next.day, next.round);
    }
  }

  private async settingsOf(version: number): Promise<ShopSettings> {
    let s = this.settingsCache.get(version);
    if (!s) {
      s = await this.settings.byVersion(version);
      this.settingsCache.set(version, s);
    }
    return s;
  }

  /** Écrit le gain de chaque ticket du tour qui n'a pas encore de résultat. Idempotent. */
  async settleRound(game: ShopGame, day: string, round: number): Promise<number> {
    if (this.now() < roundWindow(game, day, round).drawEndMs) return 0;
    const row = await this.find(game, day, round);
    if (!row) return 0;

    const { rows } = await this.db.query<{ id: string; lines: TicketLine[]; settingsVersion: number }>(
      `SELECT t.id, t.lines, t.settings_version AS "settingsVersion"
         FROM shop_tickets t LEFT JOIN shop_ticket_results r ON r.ticket_id = t.id
        WHERE t.game = $1 AND t.day = $2 AND t.round_no = $3 AND r.ticket_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM shop_ticket_voids v WHERE v.ticket_id = t.id)`,
      [game, day, round],
    );
    if (rows.length === 0) return 0;

    const wins: number[] = [];
    for (const t of rows) {
      const s = await this.settingsOf(t.settingsVersion);
      wins.push(ticketWin(game, t.lines, row.result, s.paytables, s.maxPayoutCents));
    }
    await this.db.query(
      `INSERT INTO shop_ticket_results (ticket_id, win_cents)
       SELECT * FROM unnest($1::text[], $2::bigint[]) ON CONFLICT DO NOTHING`,
      [rows.map((t) => t.id), wins],
    );
    return rows.length;
  }

  /** Règle tous les tours terminés qui ont encore des tickets sans résultat. */
  async settleDue(): Promise<number> {
    const { rows } = await this.db.query<{ game: ShopGame; day: string; round: number }>(
      `SELECT DISTINCT t.game, t.day::text AS day, t.round_no AS round
         FROM shop_tickets t LEFT JOIN shop_ticket_results r ON r.ticket_id = t.id
        WHERE r.ticket_id IS NULL AND NOT EXISTS (SELECT 1 FROM shop_ticket_voids v WHERE v.ticket_id = t.id)`,
    );
    let settled = 0;
    for (const r of rows) settled += await this.settleRound(r.game, r.day, r.round);
    return settled;
  }

  /** Tour sur lequel une vente faite maintenant sera enregistrée : le tour ouvert, ou le suivant. */
  targetRound(game: ShopGame, now = this.now()): { day: string; round: number } {
    const s = stateAt(game, now);
    if (s.phase === 'bet' && s.left > CLOSE_MARGIN_SECONDS) return { day: s.day, round: s.round };
    const next = stateAt(game, s.nextStartMs);
    return { day: next.day, round: next.round };
  }

  today(): string {
    return dayKeyOf(this.now());
  }
}
