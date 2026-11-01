import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { AppError } from '../common/errors';
import { DATABASE, Database, Queryable } from '../database/db';
import { RtpLine, ShopPaytables, rtpReport, validatePaytables } from './games';

export interface ShopSettings {
  version: number;
  pointOfSale: string;
  issuer: string;
  terminals: string[];
  stakesCents: number[];
  minStakeCents: number;
  maxStakeCents: number;
  maxTicketCents: number;
  maxPayoutCents: number;
  approvalThresholdCents: number;
  topLineEnabled: boolean;
  paytables: ShopPaytables;
  createdAt: Date;
}

/** Nom d'une caisse : imprimé sur les tickets et affiché dans la caisse, donc sans balisage. */
const TERMINAL_NAME = /^[\p{L}\p{N} #._-]{1,32}$/u;

export type ShopSettingsInput = Omit<ShopSettings, 'version' | 'createdAt'>;

const COLUMNS = `version, point_of_sale AS "pointOfSale", issuer, terminals, stakes_cents AS "stakesCents",
  min_stake_cents AS "minStakeCents", max_stake_cents AS "maxStakeCents", max_ticket_cents AS "maxTicketCents",
  max_payout_cents AS "maxPayoutCents", approval_threshold_cents AS "approvalThresholdCents",
  top_line_enabled AS "topLineEnabled", paytables, created_at AS "createdAt"`;

/** Paramètres versionnés : chaque modification ajoute une version, la plus récente s'applique. */
@Injectable()
export class ShopSettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async current(q: Queryable = this.db): Promise<ShopSettings> {
    const { rows } = await q.query<ShopSettings>(`SELECT ${COLUMNS} FROM shop_settings ORDER BY version DESC LIMIT 1`);
    return rows[0];
  }

  async byVersion(version: number, q: Queryable = this.db): Promise<ShopSettings> {
    const { rows } = await q.query<ShopSettings>(`SELECT ${COLUMNS} FROM shop_settings WHERE version = $1`, [version]);
    return rows[0];
  }

  async history(): Promise<ShopSettings[]> {
    const { rows } = await this.db.query<ShopSettings>(`SELECT ${COLUMNS} FROM shop_settings ORDER BY version DESC`);
    return rows;
  }

  /** RTP de chaque ligne de gains : à comparer à la cible de 90-95 % du cahier des charges. */
  rtp(settings: ShopSettings): RtpLine[] {
    return rtpReport(settings.paytables, settings.topLineEnabled);
  }

  update(staffId: number, input: ShopSettingsInput): Promise<ShopSettings> {
    const errors = validatePaytables(input.paytables);
    const ints = (list: unknown[]) => list.every((v) => Number.isSafeInteger(v) && (v as number) > 0);
    if (!input.terminals.length || input.terminals.some((t) => !TERMINAL_NAME.test(t))) errors.push('caisses invalides (lettres, chiffres, espace, # . _ - seulement, 32 caractères au plus)');
    if (new Set(input.terminals).size !== input.terminals.length) errors.push('deux caisses portent le même nom');
    if (/[<>]/.test(input.pointOfSale + input.issuer)) errors.push('nom du point de vente ou émetteur : caractères < et > interdits');
    if (!input.stakesCents.length || !ints(input.stakesCents)) errors.push('mises rapides invalides');
    if (input.stakesCents.some((s) => s < input.minStakeCents || s > input.maxStakeCents)) {
      errors.push('mise rapide hors des limites');
    }
    if (input.maxStakeCents < input.minStakeCents) errors.push('mise maximum inférieure à la mise minimum');
    if (input.maxTicketCents < input.maxStakeCents) errors.push('total du ticket inférieur à la mise maximum');
    if (errors.length > 0) throw new AppError('INVALID_SETTINGS', 400, { errors });

    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<ShopSettings>(
        `INSERT INTO shop_settings (point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
                                    max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled,
                                    paytables, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING ${COLUMNS}`,
        [
          input.pointOfSale,
          input.issuer,
          JSON.stringify(input.terminals),
          JSON.stringify(input.stakesCents),
          input.minStakeCents,
          input.maxStakeCents,
          input.maxTicketCents,
          input.maxPayoutCents,
          input.approvalThresholdCents,
          input.topLineEnabled,
          JSON.stringify(input.paytables),
          staffId,
        ],
      );
      await this.audit.log(staffId, 'shop_settings.update', { type: 'shop_settings', id: rows[0].version }, {}, tx);
      return rows[0];
    });
  }
}
