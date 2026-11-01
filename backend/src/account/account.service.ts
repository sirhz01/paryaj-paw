import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Language } from '../auth/dto';
import { AppError } from '../common/errors';
import { DATABASE, Database } from '../database/db';

export interface Profile {
  id: number;
  phone: string;
  fullName: string | null;
  birthDate: string;
  language: Language;
  status: 'active' | 'blocked';
  kycStatus: 'none' | 'pending' | 'verified' | 'rejected';
  selfExcludedUntil: Date | null;
  dailyLossLimitCents: number | null;
  dailyDepositLimitCents: number | null;
}

@Injectable()
export class AccountService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async profile(userId: number): Promise<Profile> {
    const { rows } = await this.db.query<Profile>(
      `SELECT id, phone, full_name AS "fullName", to_char(birth_date, 'YYYY-MM-DD') AS "birthDate", language,
              status, kyc_status AS "kycStatus", self_excluded_until AS "selfExcludedUntil",
              daily_loss_limit_cents AS "dailyLossLimitCents", daily_deposit_limit_cents AS "dailyDepositLimitCents"
         FROM users WHERE id = $1`,
      [userId],
    );
    if (!rows[0]) throw new AppError('USER_NOT_FOUND', HttpStatus.NOT_FOUND);
    return rows[0];
  }

  async update(userId: number, changes: { fullName?: string; language?: Language }): Promise<Profile> {
    await this.db.query(
      'UPDATE users SET full_name = COALESCE($2, full_name), language = COALESCE($3, language) WHERE id = $1',
      [userId, changes.fullName ?? null, changes.language ?? null],
    );
    return this.profile(userId);
  }

  /** `null` retire la limite. */
  async setLimits(
    userId: number,
    limits: { dailyLossLimitCents: number | null; dailyDepositLimitCents: number | null },
  ): Promise<Profile> {
    await this.db.query(
      'UPDATE users SET daily_loss_limit_cents = $2, daily_deposit_limit_cents = $3 WHERE id = $1',
      [userId, limits.dailyLossLimitCents, limits.dailyDepositLimitCents],
    );
    return this.profile(userId);
  }

  /** Auto-exclusion de 7 à 365 jours ; une période en cours ne peut qu'être prolongée. */
  async selfExclude(userId: number, days: number): Promise<Profile> {
    await this.db.query(
      `UPDATE users
          SET self_excluded_until = GREATEST(COALESCE(self_excluded_until, now()), now() + make_interval(days => $2::int))
        WHERE id = $1`,
      [userId, days],
    );
    return this.profile(userId);
  }
}
