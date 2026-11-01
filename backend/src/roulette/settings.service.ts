import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { AppError } from '../common/errors';
import { DATABASE, Database, Queryable } from '../database/db';
import { BetType, Variant, betTypesOf } from './rules';

export interface BetLimit {
  minCents: number;
  maxCents: number;
}

export interface RouletteSettings {
  version: number;
  variant: Variant;
  chipValuesCents: number[];
  /** Une limite par type de mise du tapis de la variante (pas de `top_line` en européenne). */
  betLimits: Partial<Record<BetType, BetLimit>>;
  maxTotalStakeCents: number;
  maxPayoutCents: number;
  laPartage: boolean;
  topLineEnabled: boolean;
  createdAt: Date;
}

export type RouletteSettingsInput = Omit<RouletteSettings, 'version' | 'variant' | 'createdAt'>;

const COLUMNS = `version, variant, chip_values AS "chipValuesCents", bet_limits AS "betLimits",
  max_total_stake_cents AS "maxTotalStakeCents", max_payout_cents AS "maxPayoutCents",
  la_partage AS "laPartage", top_line_enabled AS "topLineEnabled", created_at AS "createdAt"`;

const isPositiveInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

/** Liste des problèmes ; vide si les paramètres sont utilisables pour cette variante. */
export function validateRouletteSettings(input: RouletteSettingsInput, variant: Variant = 'european'): string[] {
  const errors: string[] = [];
  const chips = input.chipValuesCents;
  if (!Array.isArray(chips) || chips.length === 0 || chips.length > 10 || !chips.every(isPositiveInt)) {
    errors.push('jetons : 1 à 10 montants entiers positifs');
  } else if (chips.some((c, i) => i > 0 && c <= chips[i - 1])) {
    errors.push('jetons : montants strictement croissants');
  }

  const types = betTypesOf(variant);
  const limits = (input.betLimits ?? {}) as Record<string, BetLimit>;
  for (const key of Object.keys(limits)) {
    if (!(types as string[]).includes(key)) errors.push(`limite inconnue : ${key}`);
  }
  for (const type of types) {
    const limit = limits[type];
    if (!limit || !isPositiveInt(limit.minCents) || !isPositiveInt(limit.maxCents) || limit.maxCents < limit.minCents) {
      errors.push(`${type} : minCents et maxCents entiers, 0 < min ≤ max`);
    }
  }
  if (!isPositiveInt(input.maxTotalStakeCents)) errors.push('maxTotalStakeCents : entier positif');
  if (!isPositiveInt(input.maxPayoutCents)) errors.push('maxPayoutCents : entier positif');
  if (typeof input.laPartage !== 'boolean') errors.push('laPartage : vrai ou faux');
  if (typeof input.topLineEnabled !== 'boolean') errors.push('topLineEnabled : vrai ou faux');
  if (variant === 'american' && input.laPartage === true) errors.push('La Partage n’existe pas en roulette américaine');
  if (variant === 'european' && input.topLineEnabled === true) errors.push('la top line n’existe qu’en roulette américaine');
  return errors;
}

/** Paramètres versionnés par variante : chaque modification ajoute une version, la plus récente s'applique. */
@Injectable()
export class RouletteSettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async current(variant: Variant, q: Queryable = this.db): Promise<RouletteSettings> {
    const { rows } = await q.query<RouletteSettings>(
      `SELECT ${COLUMNS} FROM roulette_settings WHERE variant = $1 ORDER BY version DESC LIMIT 1`,
      [variant],
    );
    return rows[0];
  }

  async history(variant: Variant): Promise<RouletteSettings[]> {
    const { rows } = await this.db.query<RouletteSettings>(
      `SELECT ${COLUMNS} FROM roulette_settings WHERE variant = $1 ORDER BY version DESC`,
      [variant],
    );
    return rows;
  }

  update(staffId: number, variant: Variant, input: RouletteSettingsInput): Promise<RouletteSettings> {
    const errors = validateRouletteSettings(input, variant);
    if (errors.length > 0) throw new AppError('INVALID_SETTINGS', HttpStatus.BAD_REQUEST, { errors });

    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<RouletteSettings>(
        `INSERT INTO roulette_settings (variant, chip_values, bet_limits, max_total_stake_cents, max_payout_cents,
                                        la_partage, top_line_enabled, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLUMNS}`,
        [
          variant,
          JSON.stringify(input.chipValuesCents),
          JSON.stringify(input.betLimits),
          input.maxTotalStakeCents,
          input.maxPayoutCents,
          input.laPartage,
          input.topLineEnabled,
          staffId,
        ],
      );
      await this.audit.log(staffId, 'roulette.settings.update', { type: 'roulette_settings', id: rows[0].version }, { variant }, tx);
      return rows[0];
    });
  }
}
