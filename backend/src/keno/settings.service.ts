import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { AppError } from '../common/errors';
import { DATABASE, Database, Queryable } from '../database/db';
import { Paytable, validatePaytable } from './paytable';

export interface KenoSettings {
  version: number;
  minStakeCents: number;
  maxStakeCents: number;
  maxPicks: number;
  maxPayoutCents: number;
  paytable: Paytable;
  createdAt: Date;
}

export type KenoSettingsInput = Omit<KenoSettings, 'version' | 'createdAt'>;

const COLUMNS = `version, min_stake_cents AS "minStakeCents", max_stake_cents AS "maxStakeCents",
  max_picks AS "maxPicks", max_payout_cents AS "maxPayoutCents", paytable, created_at AS "createdAt"`;

/** Paramètres versionnés : chaque modification ajoute une version, la plus récente s'applique. */
@Injectable()
export class KenoSettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async current(q: Queryable = this.db): Promise<KenoSettings> {
    const { rows } = await q.query<KenoSettings>(`SELECT ${COLUMNS} FROM game_settings ORDER BY version DESC LIMIT 1`);
    return rows[0];
  }

  async history(): Promise<KenoSettings[]> {
    const { rows } = await this.db.query<KenoSettings>(`SELECT ${COLUMNS} FROM game_settings ORDER BY version DESC`);
    return rows;
  }

  update(staffId: number, input: KenoSettingsInput): Promise<KenoSettings> {
    const errors = validatePaytable(input.paytable, input.maxPicks);
    if (input.maxStakeCents < input.minStakeCents) errors.push('mise maximum inférieure à la mise minimum');
    if (errors.length > 0) throw new AppError('INVALID_SETTINGS', 400, { errors });

    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<KenoSettings>(
        `INSERT INTO game_settings (min_stake_cents, max_stake_cents, max_picks, max_payout_cents, paytable, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
        [
          input.minStakeCents,
          input.maxStakeCents,
          input.maxPicks,
          input.maxPayoutCents,
          JSON.stringify(input.paytable),
          staffId,
        ],
      );
      await this.audit.log(staffId, 'settings.update', { type: 'game_settings', id: rows[0].version }, {}, tx);
      return rows[0];
    });
  }
}
