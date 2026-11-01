import { HttpStatus, Injectable } from '@nestjs/common';
import { Queryable } from '../database/db';
import { AppError } from './errors';
import { SQL_HAITI_DAY_START } from './haiti';

/** Règles communes à tous les jeux avant une mise. */
@Injectable()
export class PlayRulesService {
  /**
   * Compte bloqué, auto-exclusion et limite de perte du jour, tous jeux confondus.
   * La perte du jour vient du journal (mises moins gains) ; la nouvelle mise compte comme perte possible.
   */
  async check(tx: Queryable, userId: number, stakeCents: number): Promise<void> {
    const { rows } = await tx.query<{ status: string; excluded: boolean; limit: number | null; lost_today: number }>(
      `SELECT u.status,
              COALESCE(u.self_excluded_until > now(), false) AS excluded,
              u.daily_loss_limit_cents AS "limit",
              (SELECT COALESCE(-sum(amount_cents), 0)::bigint FROM ledger_entries
                WHERE user_id = u.id AND kind IN ('bet', 'win') AND created_at >= ${SQL_HAITI_DAY_START}) AS lost_today
         FROM users u WHERE u.id = $1`,
      [userId],
    );
    const user = rows[0];
    if (user.status === 'blocked') throw new AppError('ACCOUNT_BLOCKED', HttpStatus.FORBIDDEN);
    if (user.excluded) throw new AppError('SELF_EXCLUDED', HttpStatus.FORBIDDEN);
    if (user.limit !== null && user.lost_today + stakeCents > user.limit) {
      throw new AppError('LOSS_LIMIT_REACHED', HttpStatus.FORBIDDEN, { dailyLossLimitCents: user.limit });
    }
  }
}
