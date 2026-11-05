import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { AuditService } from '../common/audit.service';
import { StaffRole } from '../common/auth';
import { AppError } from '../common/errors';
import { HAITI_TIME_ZONE } from '../common/haiti';
import { DATABASE, Database, isUniqueViolation } from '../database/db';
import { roundWindow } from './clock';
import {
  LineSelection,
  NUMBER_GAMES,
  NumberGame,
  ShopGame,
  TicketLine,
  checkPicks,
  numbersLine,
  rouletteLine,
} from './games';
import { RoundsService } from './rounds.service';
import { ShopSettings, ShopSettingsService } from './settings.service';

const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ID_LENGTH = 9;

export type TicketStatus = 'pending' | 'won' | 'lost' | 'paid' | 'voided';

export interface TicketView {
  id: string;
  game: ShopGame;
  day: string;
  round: number;
  terminal: string;
  issuedAt: number;
  lines: TicketLine[];
  stakeCents: number;
  status: TicketStatus;
  /** Connu une fois le tirage terminé. */
  winCents?: number;
  paidAt?: number;
  paidTerminal?: string;
}

interface TicketRow {
  id: string;
  game: ShopGame;
  day: string;
  round: number;
  terminal: string;
  lines: TicketLine[];
  stakeCents: number;
  createdAt: Date;
  winCents: number | null;
  paidAt: Date | null;
  paidTerminal: string | null;
  voidedAt: Date | null;
}

const SELECT_TICKET = `
  SELECT t.id, t.game, t.day::text AS day, t.round_no AS round, t.terminal, t.lines, t.stake_cents AS "stakeCents",
         t.created_at AS "createdAt", r.win_cents AS "winCents", p.created_at AS "paidAt", p.terminal AS "paidTerminal",
         v.created_at AS "voidedAt"
    FROM shop_tickets t
    LEFT JOIN shop_ticket_results r ON r.ticket_id = t.id
    LEFT JOIN shop_payouts p ON p.ticket_id = t.id
    LEFT JOIN shop_ticket_voids v ON v.ticket_id = t.id`;

/** Condition « ticket non annulé » (a = alias ou nom de la table des tickets). */
const LIVE = (a: string) => `NOT EXISTS (SELECT 1 FROM shop_ticket_voids vv WHERE vv.ticket_id = ${a}.id)`;

const DAY_RANGE = (column: string, param: string) =>
  `${column} >= (${param}::date::timestamp AT TIME ZONE '${HAITI_TIME_ZONE}')
   AND ${column} < ((${param}::date + 1)::timestamp AT TIME ZONE '${HAITI_TIME_ZONE}')`;

export interface Seller {
  id: number;
  role: StaffRole;
  /** Caisse du compte : un caissier lié à une caisse ne peut vendre et payer que sur celle-là. */
  terminal: string | null;
}

function checkTerminal(staff: Seller, terminal: string): void {
  if (staff.terminal && staff.terminal !== terminal) throw new AppError('TERMINAL_NOT_ALLOWED', HttpStatus.FORBIDDEN, { terminal: staff.terminal });
}

@Injectable()
export class TicketsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly rounds: RoundsService,
    private readonly settings: ShopSettingsService,
    private readonly audit: AuditService,
  ) {}

  // Vente ---------------------------------------------------------------------

  /** Valide les lignes, calcule les cotes et le gain possible côté serveur, et enregistre le ticket. */
  private buildLines(game: ShopGame, selections: LineSelection[], s: ShopSettings): TicketLine[] {
    const lines: TicketLine[] = [];
    const bad = (code: string, details: Record<string, unknown> = {}) => new AppError(code, HttpStatus.BAD_REQUEST, details);

    if (game === 'roulette') {
      const stakes = new Map<string, number>();
      for (const sel of selections) {
        if (!sel.key || sel.picks) throw bad('INVALID_BET', { reason: 'clé de mise attendue' });
        stakes.set(sel.key, (stakes.get(sel.key) ?? 0) + sel.stakeCents);
      }
      for (const [key, stakeCents] of stakes) {
        const line = rouletteLine(key, stakeCents, s.topLineEnabled, s.paytables.roulette?.odds);
        if (!line) throw bad('INVALID_BET', { reason: `mise inconnue : ${key}` });
        lines.push(line);
      }
    } else {
      for (const sel of selections) {
        if (sel.key || !sel.picks) throw bad('INVALID_BET', { reason: 'numéros attendus' });
        const problem = checkPicks(game as NumberGame, sel.picks);
        if (problem) throw bad('INVALID_BET', { reason: problem });
        const line = numbersLine(game as NumberGame, sel.picks, sel.stakeCents, s.paytables);
        if (!line) throw bad('INVALID_BET', { reason: `pas de gain pour ${sel.picks.length} numéros` });
        lines.push(line);
      }
    }

    for (const line of lines) {
      if (line.stakeCents < s.minStakeCents) throw bad('STAKE_TOO_LOW', { minCents: s.minStakeCents });
      if (line.stakeCents > s.maxStakeCents) throw bad('STAKE_TOO_HIGH', { maxCents: s.maxStakeCents });
    }
    const total = lines.reduce((sum, l) => sum + l.stakeCents, 0);
    if (total > s.maxTicketCents) throw bad('TICKET_TOO_HIGH', { maxCents: s.maxTicketCents });
    const possible = lines.reduce((sum, l) => sum + l.possibleCents, 0);
    if (possible > s.maxPayoutCents) throw bad('PAYOUT_LIMIT', { maxCents: s.maxPayoutCents });
    return lines;
  }

  async sell(
    staff: Seller,
    input: { game: ShopGame; terminal: string; idempotencyKey: string; lines: LineSelection[] },
  ): Promise<TicketView> {
    const replay = await this.byIdempotencyKey(staff.id, input.idempotencyKey);
    if (replay) return replay;

    const s = await this.settings.current();
    if (!s.terminals.includes(input.terminal)) throw new AppError('UNKNOWN_TERMINAL', HttpStatus.BAD_REQUEST);
    checkTerminal(staff, input.terminal);
    const lines = this.buildLines(input.game, input.lines, s);

    const { day, round } = this.rounds.targetRound(input.game);
    const row = await this.rounds.ensure(input.game, day, round);
    if (!row) throw new AppError('ROUND_CLOSED', HttpStatus.CONFLICT);

    const stakeCents = lines.reduce((sum, l) => sum + l.stakeCents, 0);
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = Array.from({ length: ID_LENGTH }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join('');
      try {
        await this.db.query(
          `INSERT INTO shop_tickets (id, staff_id, terminal, idempotency_key, game, day, round_no, lines, stake_cents, settings_version, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, to_timestamp($11::double precision / 1000))`,
          [id, staff.id, input.terminal, input.idempotencyKey, input.game, day, round, JSON.stringify(lines), stakeCents, s.version, this.rounds.now()],
        );
        return (await this.find(id))!;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const raced = await this.byIdempotencyKey(staff.id, input.idempotencyKey);
        if (raced) return raced;
      }
    }
    throw new AppError('TICKET_ID_COLLISION', HttpStatus.INTERNAL_SERVER_ERROR);
  }

  // Consultation --------------------------------------------------------------

  private toView(row: TicketRow, now = this.rounds.now()): TicketView {
    const complete = now >= roundWindow(row.game, row.day, row.round).drawEndMs;
    const status: TicketStatus = row.voidedAt
      ? 'voided'
      : row.paidAt
      ? 'paid'
      : !complete || row.winCents === null
        ? 'pending'
        : row.winCents > 0
          ? 'won'
          : 'lost';
    return {
      id: row.id,
      game: row.game,
      day: row.day,
      round: row.round,
      terminal: row.terminal,
      issuedAt: row.createdAt.getTime(),
      lines: row.lines,
      stakeCents: row.stakeCents,
      status,
      ...(complete && row.winCents !== null ? { winCents: row.winCents } : {}),
      ...(row.paidAt ? { paidAt: row.paidAt.getTime(), paidTerminal: row.paidTerminal ?? undefined } : {}),
    };
  }

  private async find(id: string): Promise<TicketView | undefined> {
    let { rows } = await this.db.query<TicketRow>(`${SELECT_TICKET} WHERE t.id = $1`, [id]);
    if (rows[0] && rows[0].winCents === null) {
      // Tirage terminé mais gain pas encore écrit : on règle le tour tout de suite.
      if ((await this.rounds.settleRound(rows[0].game, rows[0].day, rows[0].round)) > 0) {
        rows = (await this.db.query<TicketRow>(`${SELECT_TICKET} WHERE t.id = $1`, [id])).rows;
      }
    }
    return rows[0] ? this.toView(rows[0]) : undefined;
  }

  private async byIdempotencyKey(staffId: number, key: string): Promise<TicketView | undefined> {
    const { rows } = await this.db.query<{ id: string }>(
      'SELECT id FROM shop_tickets WHERE staff_id = $1 AND idempotency_key = $2',
      [staffId, key],
    );
    return rows[0] ? this.find(rows[0].id) : undefined;
  }

  async get(id: string): Promise<TicketView> {
    const ticket = await this.find(id.trim().toUpperCase());
    if (!ticket) throw new AppError('TICKET_NOT_FOUND', HttpStatus.NOT_FOUND);
    return ticket;
  }

  async list(day: string | undefined, terminal: string | undefined, limit: number): Promise<TicketView[]> {
    const { rows } = await this.db.query<TicketRow>(
      `${SELECT_TICKET}
        WHERE ($1::text IS NULL OR ${DAY_RANGE('t.created_at', '$1')}) AND ($2::text IS NULL OR t.terminal = $2)
        ORDER BY t.created_at DESC, t.id LIMIT $3`,
      [day ?? null, terminal ?? null, limit],
    );
    return rows.map((r) => this.toView(r));
  }

  // Annulation ----------------------------------------------------------------

  /**
   * Annule un ticket vendu (impression annulée, erreur) : seulement par son caissier, tant que le tirage du tour n'a pas commencé
   * et que le ticket n'est pas payé. Le ticket n'est plus compté dans la caisse ni les rapports. Un second appel ne fait rien.
   */
  async voidTicket(staff: Seller, id: string): Promise<TicketView> {
    const ticketId = id.trim().toUpperCase();
    const { rows } = await this.db.query<{ staffId: number; game: ShopGame; day: string; round: number; terminal: string }>(
      'SELECT staff_id AS "staffId", game, day::text AS day, round_no AS round, terminal FROM shop_tickets WHERE id = $1',
      [ticketId],
    );
    const t = rows[0];
    if (!t) throw new AppError('TICKET_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (staff.role === 'cashier' && t.staffId !== staff.id) throw new AppError('NOT_YOUR_TICKET', HttpStatus.FORBIDDEN);
    const current = await this.get(ticketId);
    if (current.status === 'voided') return current;
    if (current.status === 'paid') throw new AppError('ALREADY_PAID', HttpStatus.CONFLICT);
    if (this.rounds.now() >= roundWindow(t.game, t.day, t.round).drawStartMs) throw new AppError('VOID_TOO_LATE', HttpStatus.CONFLICT);
    try {
      await this.db.transaction(async (tx) => {
        await tx.query(
          'INSERT INTO shop_ticket_voids (ticket_id, staff_id, terminal, created_at) VALUES ($1, $2, $3, to_timestamp($4::double precision / 1000))',
          [ticketId, staff.id, t.terminal, this.rounds.now()],
        );
        await this.audit.log(staff.id, 'shop.void', { type: 'shop_ticket', id: ticketId }, { stakeCents: current.stakeCents, terminal: t.terminal }, tx);
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
    return this.get(ticketId);
  }

  // Décaissement --------------------------------------------------------------

  async pay(staff: Seller, id: string, terminal: string): Promise<TicketView & { payoutCents: number }> {
    const s = await this.settings.current();
    if (!s.terminals.includes(terminal)) throw new AppError('UNKNOWN_TERMINAL', HttpStatus.BAD_REQUEST);
    checkTerminal(staff, terminal);

    const ticket = await this.get(id);
    if (ticket.status === 'voided') throw new AppError('TICKET_VOIDED', HttpStatus.CONFLICT);
    if (ticket.status === 'paid') {
      throw new AppError('ALREADY_PAID', HttpStatus.CONFLICT, { paidAt: ticket.paidAt, terminal: ticket.paidTerminal });
    }
    if (ticket.status === 'pending') throw new AppError('ROUND_PENDING', HttpStatus.CONFLICT);
    if (ticket.status === 'lost') throw new AppError('TICKET_LOST', HttpStatus.CONFLICT);

    const amount = ticket.winCents!;
    if (amount >= s.approvalThresholdCents && staff.role === 'cashier') {
      throw new AppError('APPROVAL_REQUIRED', HttpStatus.FORBIDDEN, { amountCents: amount });
    }
    try {
      await this.db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO shop_payouts (ticket_id, amount_cents, staff_id, terminal, created_at)
           VALUES ($1, $2, $3, $4, to_timestamp($5::double precision / 1000))`,
          [ticket.id, amount, staff.id, terminal, this.rounds.now()],
        );
        await this.audit.log(staff.id, 'shop.payout', { type: 'shop_ticket', id: ticket.id }, { amountCents: amount, terminal }, tx);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('ALREADY_PAID', HttpStatus.CONFLICT);
      throw error;
    }
    return { ...(await this.get(ticket.id)), payoutCents: amount };
  }

  /**
   * Déconnexion d'un caissier : enregistre le rapport de sa session (ventes et paiements depuis sa dernière connexion)
   * et coupe ses jetons. Sans effet pour les autres rôles. Un second appel ne crée pas de doublon.
   */
  /** Début de service : le caissier déclare l'argent qu'il a en caisse. Gardé dans le journal d'audit. */
  async openShift(staff: Seller, openingCents: number): Promise<{ openingCents: number }> {
    await this.audit.log(staff.id, 'shift.open', { type: 'staff', id: staff.id }, { openingCents });
    return { openingCents };
  }

  async closeShift(staff: Seller, closingCents?: number): Promise<{ closed: boolean }> {
    if (staff.role !== 'cashier') return { closed: false };
    return this.db.transaction(async (tx) => {
      const login = await tx.query<{ at: Date }>(
        "SELECT max(created_at) AS at FROM audit_log WHERE staff_id = $1 AND action = 'staff.login'",
        [staff.id],
      );
      const startedAt = login.rows[0]?.at;
      if (!startedAt) return { closed: false };
      // Compter depuis la fin du rapport précédent : les ventes d'une connexion jamais fermée ne sont pas perdues.
      const prev = await tx.query<{ at: Date | null }>('SELECT max(ended_at) AS at FROM cashier_reports WHERE staff_id = $1', [staff.id]);
      const countFrom = prev.rows[0]?.at && prev.rows[0].at < startedAt ? prev.rows[0].at : startedAt;
      const inserted = await tx.query(
        `INSERT INTO cashier_reports (staff_id, terminal, started_at, tickets, stakes_cents, payouts, payouts_cents, opening_cents, closing_cents)
         SELECT $1,
                COALESCE($3, (SELECT terminal FROM shop_tickets WHERE staff_id = $1 AND created_at >= $4 ORDER BY created_at DESC LIMIT 1)),
                $2,
                (SELECT count(*) FROM shop_tickets WHERE staff_id = $1 AND created_at >= $4 AND ${LIVE('shop_tickets')}),
                (SELECT COALESCE(sum(stake_cents), 0) FROM shop_tickets WHERE staff_id = $1 AND created_at >= $4 AND ${LIVE('shop_tickets')}),
                (SELECT count(*) FROM shop_payouts WHERE staff_id = $1 AND created_at >= $4),
                (SELECT COALESCE(sum(amount_cents), 0) FROM shop_payouts WHERE staff_id = $1 AND created_at >= $4),
                (SELECT (details->>'openingCents')::bigint FROM audit_log WHERE staff_id = $1 AND action = 'shift.open' AND created_at >= $2 ORDER BY id DESC LIMIT 1),
                $5::bigint
         ON CONFLICT (staff_id, started_at) DO NOTHING RETURNING id`,
        [staff.id, startedAt, staff.terminal, countFrom, closingCents ?? null],
      );
      await tx.query('UPDATE staff SET token_version = token_version + 1 WHERE id = $1', [staff.id]);
      return { closed: inserted.rows.length === 1 };
    });
  }

  /**
   * Argent attendu dans la caisse pour la session en cours du caissier : ouverture déclarée + ventes − décaissements
   * depuis le début du service. Permet d'afficher en temps réel le montant qui doit se trouver dans le tiroir.
   */
  async currentShift(staff: Seller): Promise<{
    openingCents: number;
    stakesCents: number;
    payoutsCents: number;
    tickets: number;
    payouts: number;
    cashCents: number;
    open: boolean;
  }> {
    const empty = { openingCents: 0, stakesCents: 0, payoutsCents: 0, tickets: 0, payouts: 0, cashCents: 0, open: false };
    if (staff.role !== 'cashier') return empty;
    const login = await this.db.query<{ at: Date }>(
      "SELECT max(created_at) AS at FROM audit_log WHERE staff_id = $1 AND action = 'staff.login'",
      [staff.id],
    );
    const startedAt = login.rows[0]?.at;
    if (!startedAt) return empty;
    // Comme à la fermeture : compter depuis la fin du rapport précédent si une session est restée ouverte.
    const prev = await this.db.query<{ at: Date | null }>('SELECT max(ended_at) AS at FROM cashier_reports WHERE staff_id = $1', [staff.id]);
    const countFrom = prev.rows[0]?.at && prev.rows[0].at < startedAt ? prev.rows[0].at : startedAt;
    const { rows } = await this.db.query<{
      tickets: number;
      stakes: number;
      payouts: number;
      payoutsCents: number;
      opening: number | null;
    }>(
      `SELECT (SELECT count(*) FROM shop_tickets WHERE staff_id = $1 AND created_at >= $2 AND ${LIVE('shop_tickets')})::int AS tickets,
              (SELECT COALESCE(sum(stake_cents), 0) FROM shop_tickets WHERE staff_id = $1 AND created_at >= $2 AND ${LIVE('shop_tickets')})::bigint AS stakes,
              (SELECT count(*) FROM shop_payouts WHERE staff_id = $1 AND created_at >= $2)::int AS payouts,
              (SELECT COALESCE(sum(amount_cents), 0) FROM shop_payouts WHERE staff_id = $1 AND created_at >= $2)::bigint AS "payoutsCents",
              (SELECT (details->>'openingCents')::bigint FROM audit_log
                 WHERE staff_id = $1 AND action = 'shift.open' AND created_at >= $3 ORDER BY id DESC LIMIT 1) AS opening`,
      [staff.id, countFrom, startedAt],
    );
    const r = rows[0];
    const opening = r.opening === null || r.opening === undefined;
    const openingCents = Number(r.opening ?? 0);
    const stakesCents = Number(r.stakes);
    const payoutsCents = Number(r.payoutsCents);
    return {
      openingCents,
      stakesCents,
      payoutsCents,
      tickets: Number(r.tickets),
      payouts: Number(r.payouts),
      cashCents: openingCents + stakesCents - payoutsCents,
      open: !opening,
    };
  }

  /** Derniers rapports de caissier, du plus récent au plus ancien. */
  async cashierReports(limit: number) {
    const { rows } = await this.db.query(
      `SELECT r.id, regexp_replace(s.email, '#supprime-[0-9]+$', '') AS email, r.terminal, r.started_at AS "startedAt", r.ended_at AS "endedAt", r.tickets,
              r.stakes_cents::bigint AS "stakesCents", r.payouts, r.payouts_cents::bigint AS "payoutsCents",
              r.opening_cents::bigint AS "openingCents", r.closing_cents::bigint AS "closingCents"
         FROM cashier_reports r JOIN staff s ON s.id = r.staff_id
        ORDER BY r.ended_at DESC LIMIT $1`,
      [limit],
    );
    return rows;
  }

  // Rapports ------------------------------------------------------------------

  /** Fin de journée d'une caisse : ventes et décaissements par caisse, gagnants non réclamés. */
  async report(day: string) {
    const sales = await this.db.query<{ terminal: string; tickets: number; stakesCents: number }>(
      `SELECT terminal, count(*)::int AS tickets, sum(stake_cents)::bigint AS "stakesCents"
         FROM shop_tickets WHERE ${DAY_RANGE('created_at', '$1')} AND ${LIVE('shop_tickets')} GROUP BY terminal`,
      [day],
    );
    const payouts = await this.db.query<{ terminal: string; payouts: number; payoutsCents: number }>(
      `SELECT terminal, count(*)::int AS payouts, sum(amount_cents)::bigint AS "payoutsCents"
         FROM shop_payouts WHERE ${DAY_RANGE('created_at', '$1')} GROUP BY terminal`,
      [day],
    );
    const unclaimed = await this.db.query<{ count: number; cents: number }>(
      `SELECT count(*)::int AS count, COALESCE(sum(r.win_cents), 0)::bigint AS cents
         FROM shop_tickets t JOIN shop_ticket_results r ON r.ticket_id = t.id
         LEFT JOIN shop_payouts p ON p.ticket_id = t.id
        WHERE t.day = $1 AND r.win_cents > 0 AND p.ticket_id IS NULL`,
      [day],
    );

    // Détail par jeu pour les tickets du jour (jour du tirage) : mêmes définitions que le rapport de période.
    const games = await this.db.query(
      `SELECT t.game, count(*)::int AS tickets, sum(t.stake_cents)::bigint AS "stakesCents",
              COALESCE(sum(r.win_cents), 0)::bigint AS "winsCents", COALESCE(sum(p.amount_cents), 0)::bigint AS "paidCents",
              count(*) FILTER (WHERE r.ticket_id IS NULL)::int AS "pendingTickets"
         FROM shop_tickets t
         LEFT JOIN shop_ticket_results r ON r.ticket_id = t.id
         LEFT JOIN shop_payouts p ON p.ticket_id = t.id
        WHERE t.day = $1::date AND ${LIVE('t')} GROUP BY t.game ORDER BY t.game`,
      [day],
    );
    // Sessions de caissier terminées ce jour-là : argent déclaré au début et à la fin, écart avec l'attendu.
    const shifts = await this.db.query(
      `SELECT regexp_replace(s.email, '#supprime-[0-9]+$', '') AS email, r.terminal, r.started_at AS "startedAt", r.ended_at AS "endedAt", r.tickets,
              r.stakes_cents::bigint AS "stakesCents", r.payouts, r.payouts_cents::bigint AS "payoutsCents",
              r.opening_cents::bigint AS "openingCents", r.closing_cents::bigint AS "closingCents"
         FROM cashier_reports r JOIN staff s ON s.id = r.staff_id
        WHERE ${DAY_RANGE('r.ended_at', '$1')} ORDER BY r.ended_at`,
      [day],
    );

    const terminals = new Map<string, { terminal: string; tickets: number; stakesCents: number; payouts: number; payoutsCents: number }>();
    const row = (terminal: string) => {
      if (!terminals.has(terminal)) terminals.set(terminal, { terminal, tickets: 0, stakesCents: 0, payouts: 0, payoutsCents: 0 });
      return terminals.get(terminal)!;
    };
    for (const r of sales.rows) Object.assign(row(r.terminal), { tickets: r.tickets, stakesCents: r.stakesCents });
    for (const r of payouts.rows) Object.assign(row(r.terminal), { payouts: r.payouts, payoutsCents: r.payoutsCents });
    const list = [...terminals.values()].sort((a, b) => a.terminal.localeCompare(b.terminal));
    return {
      day,
      terminals: list,
      totals: {
        tickets: list.reduce((n, t) => n + t.tickets, 0),
        stakesCents: list.reduce((n, t) => n + t.stakesCents, 0),
        payouts: list.reduce((n, t) => n + t.payouts, 0),
        payoutsCents: list.reduce((n, t) => n + t.payoutsCents, 0),
      },
      unclaimedWinners: unclaimed.rows[0],
      games: games.rows,
      shifts: shifts.rows,
    };
  }

  /** Une ligne par jour de tirage et par jeu : tickets, mises, gains dus, gains décaissés, GGR. */
  async dashboard(from: string, to: string) {
    const { rows } = await this.db.query(
      `SELECT t.day::text AS day, t.game, count(*)::int AS tickets, sum(t.stake_cents)::bigint AS "stakesCents",
              COALESCE(sum(r.win_cents), 0)::bigint AS "winsCents", COALESCE(sum(p.amount_cents), 0)::bigint AS "paidCents",
              (sum(t.stake_cents) - COALESCE(sum(r.win_cents), 0))::bigint AS "ggrCents",
              COALESCE(sum(t.stake_cents) FILTER (WHERE r.ticket_id IS NOT NULL), 0)::bigint AS "settledStakesCents"
         FROM shop_tickets t
         LEFT JOIN shop_ticket_results r ON r.ticket_id = t.id
         LEFT JOIN shop_payouts p ON p.ticket_id = t.id
        WHERE t.day BETWEEN $1::date AND $2::date AND ${LIVE('t')}
        GROUP BY t.day, t.game ORDER BY t.day, t.game`,
      [from, to],
    );
    return rows;
  }

  /**
   * Ventilation d'une période (jours de tirage) par caissier et par heure d'émission (heure d'Haïti).
   * Mêmes définitions que dashboard : gains dus = résultats réglés, bénéfice = mises − gains dus, tickets annulés exclus.
   * settledStakesCents = mises des tickets dont le tirage est réglé : base du RTP constaté (un ticket en attente n'a pas encore de gain).
   */
  async breakdown(from: string, to: string) {
    const cashiers = await this.db.query(
      `SELECT t.staff_id::text AS "staffId", s.email, t.terminal, count(*)::int AS tickets, sum(t.stake_cents)::bigint AS "stakesCents",
              COALESCE(sum(r.win_cents), 0)::bigint AS "winsCents", COALESCE(sum(p.amount_cents), 0)::bigint AS "paidCents",
              (sum(t.stake_cents) - COALESCE(sum(r.win_cents), 0))::bigint AS "ggrCents",
              COALESCE(sum(t.stake_cents) FILTER (WHERE r.ticket_id IS NOT NULL), 0)::bigint AS "settledStakesCents",
              (SELECT count(*) FROM shop_ticket_voids vv JOIN shop_tickets vt ON vt.id = vv.ticket_id
                WHERE vt.staff_id = t.staff_id AND vt.terminal = t.terminal AND vt.day BETWEEN $1::date AND $2::date)::int AS voids
         FROM shop_tickets t
         JOIN staff s ON s.id = t.staff_id
         LEFT JOIN shop_ticket_results r ON r.ticket_id = t.id
         LEFT JOIN shop_payouts p ON p.ticket_id = t.id
        WHERE t.day BETWEEN $1::date AND $2::date AND ${LIVE('t')}
        GROUP BY t.staff_id, s.email, t.terminal ORDER BY sum(t.stake_cents) DESC`,
      [from, to],
    );
    const hours = await this.db.query(
      `SELECT EXTRACT(HOUR FROM t.created_at AT TIME ZONE '${HAITI_TIME_ZONE}')::int AS hour, count(*)::int AS tickets,
              sum(t.stake_cents)::bigint AS "stakesCents", COALESCE(sum(r.win_cents), 0)::bigint AS "winsCents",
              (sum(t.stake_cents) - COALESCE(sum(r.win_cents), 0))::bigint AS "ggrCents",
              COALESCE(sum(t.stake_cents) FILTER (WHERE r.ticket_id IS NOT NULL), 0)::bigint AS "settledStakesCents"
         FROM shop_tickets t
         LEFT JOIN shop_ticket_results r ON r.ticket_id = t.id
        WHERE t.day BETWEEN $1::date AND $2::date AND ${LIVE('t')}
        GROUP BY 1 ORDER BY 1`,
      [from, to],
    );
    return { cashiers: cashiers.rows, hours: hours.rows };
  }
}

export { NUMBER_GAMES };
