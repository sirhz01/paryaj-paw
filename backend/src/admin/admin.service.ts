import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { AppError } from '../common/errors';
import { HAITI_TIME_ZONE } from '../common/haiti';
import { DATABASE, Database } from '../database/db';

export type ExportKind = 'bets' | 'spins' | 'ledger' | 'payments' | 'tickets' | 'shop_rounds';
export const EXPORT_KINDS: ExportKind[] = ['bets', 'spins', 'ledger', 'payments', 'tickets', 'shop_rounds'];

const MAX_RANGE_DAYS = 92;
const MAX_EXPORT_ROWS = 200_000;

/** `created_at` compris dans les jours $1 à $2 inclus, heure d'Haïti. */
const IN_RANGE = `created_at >= ($1::date::timestamp AT TIME ZONE '${HAITI_TIME_ZONE}')
  AND created_at < (($2::date + 1)::timestamp AT TIME ZONE '${HAITI_TIME_ZONE}')`;

const EXPORT_QUERIES: Record<ExportKind, string> = {
  bets: `SELECT id, user_id, created_at, picks, drawn, hits, stake_cents, multiplier, payout_cents, seed_id, nonce, settings_version
           FROM keno_bets WHERE ${IN_RANGE} ORDER BY id LIMIT ${MAX_EXPORT_ROWS + 1}`,
  spins: `SELECT id, user_id, created_at, number, total_stake_cents, total_payout_cents, covers_all, bets, seed_id, nonce, settings_version
            FROM roulette_spins WHERE ${IN_RANGE} ORDER BY id LIMIT ${MAX_EXPORT_ROWS + 1}`,
  ledger: `SELECT id, user_id, created_at, kind, amount_cents, balance_after_cents, ref_type, ref_id
             FROM ledger_entries WHERE ${IN_RANGE} ORDER BY id LIMIT ${MAX_EXPORT_ROWS + 1}`,
  payments: `SELECT id, user_id, created_at, updated_at, direction, provider, amount_cents, status, provider_ref, failure_reason, reviewed_by
               FROM payments WHERE ${IN_RANGE} ORDER BY id LIMIT ${MAX_EXPORT_ROWS + 1}`,
  // Tickets de la boutique, avec leur gain et leur décaissement.
  tickets: `SELECT id, created_at, terminal, staff_id, game, day, round_no, lines::text AS lines, stake_cents, settings_version,
                   (SELECT win_cents FROM shop_ticket_results r WHERE r.ticket_id = id) AS win_cents,
                   (SELECT created_at FROM shop_payouts p WHERE p.ticket_id = id) AS paid_at
              FROM shop_tickets WHERE ${IN_RANGE} ORDER BY created_at, id LIMIT ${MAX_EXPORT_ROWS + 1}`,
  // Tours de la boutique : le résultat ne sort qu'une fois le tirage commencé, la graine jamais.
  shop_rounds: `SELECT game, day, round_no, server_seed_hash, draw_starts_at, created_at,
                       CASE WHEN draw_starts_at <= now() THEN result::text END AS result
                  FROM shop_rounds WHERE ${IN_RANGE} ORDER BY created_at, game LIMIT ${MAX_EXPORT_ROWS + 1}`,
};

export interface PlayerUpdate {
  status?: 'active' | 'blocked';
  kycStatus?: 'none' | 'pending' | 'verified' | 'rejected';
  dailyLossLimitCents?: number;
}

@Injectable()
export class AdminService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Une ligne par jour, tous jeux confondus et par jeu : mises, gains versés, GGR, joueurs actifs, dépôts et retraits. */
  async dashboard(from: string, to: string) {
    this.checkRange(from, to);
    const { rows } = await this.db.query(
      `WITH days AS (SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day),
            plays AS (
              SELECT 'keno' AS game, user_id, stake_cents AS stake, payout_cents AS payout, created_at
                FROM keno_bets WHERE ${IN_RANGE}
              UNION ALL
              SELECT 'roulette', user_id, total_stake_cents, total_payout_cents, created_at
                FROM roulette_spins WHERE ${IN_RANGE}),
            bets AS (
              SELECT (created_at AT TIME ZONE '${HAITI_TIME_ZONE}')::date AS day,
                     count(*)::int AS bets, count(DISTINCT user_id)::int AS players,
                     sum(stake)::bigint AS stakes, sum(payout)::bigint AS payouts,
                     (sum(stake - payout) FILTER (WHERE game = 'keno'))::bigint AS keno_ggr,
                     (sum(stake - payout) FILTER (WHERE game = 'roulette'))::bigint AS roulette_ggr
                FROM plays GROUP BY 1),
            pay AS (
              SELECT (created_at AT TIME ZONE '${HAITI_TIME_ZONE}')::date AS day,
                     (sum(amount_cents) FILTER (WHERE direction = 'deposit'))::bigint AS deposits,
                     (sum(amount_cents) FILTER (WHERE direction = 'withdrawal'))::bigint AS withdrawals
                FROM payments WHERE status = 'completed' AND ${IN_RANGE} GROUP BY 1)
       SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              COALESCE(b.bets, 0) AS bets,
              COALESCE(b.players, 0) AS "activePlayers",
              COALESCE(b.stakes, 0) AS "stakesCents",
              COALESCE(b.payouts, 0) AS "payoutsCents",
              COALESCE(b.stakes, 0) - COALESCE(b.payouts, 0) AS "ggrCents",
              COALESCE(b.keno_ggr, 0) AS "kenoGgrCents",
              COALESCE(b.roulette_ggr, 0) AS "rouletteGgrCents",
              COALESCE(p.deposits, 0) AS "depositsCents",
              COALESCE(p.withdrawals, 0) AS "withdrawalsCents"
         FROM days d LEFT JOIN bets b USING (day) LEFT JOIN pay p USING (day)
        ORDER BY d.day`,
      [from, to],
    );
    return rows;
  }

  /** Tours de roulette dont les mises couvraient les 37 cases (signal anti-blanchiment). */
  async rouletteAlerts(from: string, to: string) {
    this.checkRange(from, to);
    const { rows } = await this.db.query(
      `SELECT r.id AS "spinId", r.user_id AS "userId", u.phone, r.number,
              r.total_stake_cents AS "totalStakeCents", r.total_payout_cents AS "totalPayoutCents", r.created_at AS "createdAt"
         FROM (SELECT * FROM roulette_spins WHERE covers_all AND ${IN_RANGE}) r
         JOIN users u ON u.id = r.user_id
        ORDER BY r.id DESC LIMIT 500`,
      [from, to],
    );
    return rows;
  }

  async players(search: string | undefined, limit: number) {
    const { rows } = await this.db.query(
      `SELECT u.id, u.phone, u.full_name AS "fullName", u.status, u.kyc_status AS "kycStatus",
              w.balance_cents AS "balanceCents", u.daily_loss_limit_cents AS "dailyLossLimitCents",
              u.self_excluded_until AS "selfExcludedUntil", u.created_at AS "createdAt"
         FROM users u JOIN wallets w ON w.user_id = u.id
        WHERE $1::text IS NULL OR u.id::text = $1 OR u.phone LIKE '%' || $1 || '%' OR u.full_name ILIKE '%' || $1 || '%'
        ORDER BY u.id DESC LIMIT $2`,
      [search ?? null, limit],
    );
    return rows;
  }

  /** Blocage (les sessions sont fermées), statut KYC, limite de perte imposée. */
  updatePlayer(staffId: number, userId: number, changes: PlayerUpdate) {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query(
        `UPDATE users
            SET status = COALESCE($2, status),
                kyc_status = COALESCE($3, kyc_status),
                daily_loss_limit_cents = COALESCE($4, daily_loss_limit_cents)
          WHERE id = $1
          RETURNING id, status, kyc_status AS "kycStatus", daily_loss_limit_cents AS "dailyLossLimitCents"`,
        [userId, changes.status ?? null, changes.kycStatus ?? null, changes.dailyLossLimitCents ?? null],
      );
      if (!rows[0]) throw new AppError('USER_NOT_FOUND', HttpStatus.NOT_FOUND);
      if (changes.status === 'blocked') {
        await tx.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      }
      await this.audit.log(staffId, 'player.update', { type: 'user', id: userId }, { ...changes }, tx);
      return rows[0];
    });
  }

  async exportCsv(staffId: number, kind: ExportKind, from: string, to: string): Promise<string> {
    this.checkRange(from, to);
    const { rows } = await this.db.query<Record<string, unknown>>(EXPORT_QUERIES[kind], [from, to]);
    if (rows.length > MAX_EXPORT_ROWS) {
      throw new AppError('EXPORT_TOO_LARGE', HttpStatus.BAD_REQUEST, { maxRows: MAX_EXPORT_ROWS });
    }
    await this.audit.log(staffId, 'export', { type: kind, id: `${from}..${to}` }, { rows: rows.length });
    return toCsv(rows);
  }

  private checkRange(from: string, to: string): void {
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (!(days >= 0 && days < MAX_RANGE_DAYS)) {
      throw new AppError('INVALID_DATE_RANGE', HttpStatus.BAD_REQUEST, { maxDays: MAX_RANGE_DAYS });
    }
  }
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const columns = Object.keys(rows[0]);
  const cell = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text = value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.join(' ') : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.join(','), ...rows.map((row) => columns.map((c) => cell(row[c])).join(','))].join('\n') + '\n';
}
