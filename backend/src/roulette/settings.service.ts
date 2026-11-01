import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { AppError } from '../common/errors';
import { DATABASE, Database, Queryable } from '../database/db';
import { BET_TYPES, BetType } from './rules';

export interface BetLimit {
  minCents: number;
  maxCents: number;
}

export interface RouletteSettings {
  version: number;
  chipValuesCents: number[];
  betLimits: Record<BetType, BetLimit>;
  maxTotalStakeCents: number;
  maxPayoutCents: number;
  /** La top line (0, 00, 1, 2, 3) a un avantage maison de 7,89 % : l'exploitant peut la retirer du tapis. */
  topLineEnabled: boolean;
  createdAt: Date;
}

export type RouletteSettingsInput = Omit<RouletteSettings, 'version' | 'createdAt'>;

// La colonne `variant` garde la trace des anciennes versions européennes, désormais ignorées.
const COLUMNS = `version, chip_values AS "chipValuesCents", bet_limits AS "betLimits",
  max_total_stake_cents AS "maxTotalStakeCents", max_payout_cents AS "maxPayoutCents",
  top_line_enabled AS "topLineEnabled", created_at AS "createdAt"`;

const isPositiveInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

/** Liste des problèmes ; vide si les paramètres sont utilisables. */
export function validateRouletteSettings(input: RouletteSettingsInput): string[] {
  const errors: string[] = [];
  const chips = input.chipValuesCents;
  if (!Array.isArray(chips) || chips.length === 0 || chips.length > 10 || !chips.every(isPositiveInt)) {
    errors.push('jetons : 1 à 10 montants entiers positifs');
  } else if (chips.some((c, i) => i > 0 && c <= chips[i - 1])) {
    errors.push('jetons : montants strictement croissants');
  }

  const limits = (input.betLimits ?? {}) as Record<string, BetLimit>;
  for (const key of Object.keys(limits)) {
    if (!(BET_TYPES as string[]).includes(key)) errors.push(`limite inconnue : ${key}`);
  }
  for (const type of BET_TYPES) {
    const limit = limits[type];
    if (!limit || !isPositiveInt(limit.minCents) || !isPositiveInt(limit.maxCents) || limit.maxCents < limit.minCents) {
      errors.push(`${type} : minCents et maxCents entiers, 0 < min ≤ max`);
    }
  }
  if (!isPositiveInt(input.maxTotalStakeCents)) errors.push('maxTotalStakeCents : entier positif');
  if (!isPositiveInt(input.maxPayoutCents)) errors.push('maxPayoutCents : entier positif');
  if (typeof input.topLineEnabled !== 'boolean') errors.push('topLineEnabled : vrai ou faux');
  return errors;
}

/** Paramètres versionnés : chaque modification ajoute une version, la plus récente s'applique. */
@Injectable()
export class RouletteSettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async current(q: Queryable = this.db): Promise<RouletteSettings> {
    const { rows } = await q.query<RouletteSettings>(
      `SELECT ${COLUMNS} FROM roulette_settings WHERE variant = 'american' ORDER BY version DESC LIMIT 1`,
    );
    return rows[0];
  }

  async history(): Promise<RouletteSettings[]> {
    const { rows } = await this.db.query<RouletteSettings>(
      `SELECT ${COLUMNS} FROM roulette_settings WHERE variant = 'american' ORDER BY version DESC`,
    );
    return rows;
  }

  update(staffId: number, input: RouletteSettingsInput): Promise<RouletteSettings> {
    const errors = validateRouletteSettings(input);
    if (errors.length > 0) throw new AppError('INVALID_SETTINGS', HttpStatus.BAD_REQUEST, { errors });

    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<RouletteSettings>(
        `INSERT INTO roulette_settings (variant, chip_values, bet_limits, max_total_stake_cents, max_payout_cents,
                                        la_partage, top_line_enabled, created_by)
         VALUES ('american', $1, $2, $3, $4, false, $5, $6) RETURNING ${COLUMNS}`,
        [
          JSON.stringify(input.chipValuesCents),
          JSON.stringify(input.betLimits),
          input.maxTotalStakeCents,
          input.maxPayoutCents,
          input.topLineEnabled,
          staffId,
        ],
      );
      await this.audit.log(staffId, 'roulette.settings.update', { type: 'roulette_settings', id: rows[0].version }, {}, tx);
      return rows[0];
    });
  }
}
