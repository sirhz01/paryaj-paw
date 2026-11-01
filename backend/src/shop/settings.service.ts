import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { AppError } from '../common/errors';
import { DATABASE, Database, Queryable } from '../database/db';
import { dayStartMs, nextDayKey, setTimingsProvider } from './clock';
import { RtpLine, ShopPaytables, TIMINGS, Timings, rtpReport, validatePaytables, validateTimings } from './games';

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
  /** Durées des tours : elles s'appliquent à partir du jour suivant la création de cette version. */
  timings: Timings;
  createdAt: Date;
}

/** Nom d'une caisse : imprimé sur les tickets et affiché dans la caisse, donc sans balisage. */
const TERMINAL_NAME = /^[\p{L}\p{N} #._-]{1,32}$/u;

export type ShopSettingsInput = Omit<ShopSettings, 'version' | 'createdAt' | 'timings'> & { timings?: Timings };

const COLUMNS = `version, point_of_sale AS "pointOfSale", issuer, terminals, stakes_cents AS "stakesCents",
  min_stake_cents AS "minStakeCents", max_stake_cents AS "maxStakeCents", max_ticket_cents AS "maxTicketCents",
  max_payout_cents AS "maxPayoutCents", approval_threshold_cents AS "approvalThresholdCents",
  top_line_enabled AS "topLineEnabled", paytables, timings, created_at AS "createdAt"`;

/** Une version créée avant l'ajout des durées (colonne NULL) garde les valeurs par défaut. */
const withTimings = (s: ShopSettings | undefined): ShopSettings => (s ? { ...s, timings: s.timings ?? TIMINGS } : (s as unknown as ShopSettings));

/** Paramètres versionnés : chaque modification ajoute une version, la plus récente s'applique. */
@Injectable()
export class ShopSettingsService implements OnModuleInit, OnApplicationShutdown {
  /** Durées par version (instant de création → durées), pour savoir quelles durées s'appliquent à un jour donné. */
  private timingVersions: { at: number; timings: Timings }[] = [];
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    setTimingsProvider((day) => this.timingsOn(day));
    await this.loadTimings();
    // Rechargé régulièrement : une modification faite ailleurs ou le passage à minuit sont pris en compte sans redémarrage.
    this.timer = setInterval(() => void this.loadTimings().catch(() => undefined), 10_000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async loadTimings(): Promise<void> {
    const { rows } = await this.db.query<{ at: Date; timings: Timings | null }>(
      'SELECT created_at AS at, timings FROM shop_settings ORDER BY version',
    );
    this.timingVersions = rows.map((r) => ({ at: new Date(r.at).getTime(), timings: r.timings ?? TIMINGS }));
  }

  /** Durées applicables au jour `day` : celles de la dernière version créée avant le début de ce jour. */
  timingsOn(day: string): Timings {
    const start = dayStartMs(day);
    let found: Timings = TIMINGS;
    for (const v of this.timingVersions) if (v.at < start) found = v.timings;
    return found;
  }

  /** Durées du jour et de demain, pour l'écran d'administration. */
  timingsPlan(today: string): { today: Timings; tomorrow: Timings } {
    return { today: this.timingsOn(today), tomorrow: this.timingsOn(nextDayKey(today)) };
  }

  async current(q: Queryable = this.db): Promise<ShopSettings> {
    const { rows } = await q.query<ShopSettings>(`SELECT ${COLUMNS} FROM shop_settings ORDER BY version DESC LIMIT 1`);
    return withTimings(rows[0]);
  }

  async byVersion(version: number, q: Queryable = this.db): Promise<ShopSettings> {
    const { rows } = await q.query<ShopSettings>(`SELECT ${COLUMNS} FROM shop_settings WHERE version = $1`, [version]);
    return withTimings(rows[0]);
  }

  async history(): Promise<ShopSettings[]> {
    const { rows } = await this.db.query<ShopSettings>(`SELECT ${COLUMNS} FROM shop_settings ORDER BY version DESC`);
    return rows.map((r) => withTimings(r));
  }

  /** RTP de chaque ligne de gains : à comparer à la cible de 90-95 % du cahier des charges. */
  rtp(settings: ShopSettings): RtpLine[] {
    return rtpReport(settings.paytables, settings.topLineEnabled);
  }

  async update(staffId: number, input: ShopSettingsInput): Promise<ShopSettings> {
    const errors = validatePaytables(input.paytables);
    const timings = input.timings ?? (await this.current()).timings;
    errors.push(...validateTimings(timings));
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

    const saved = await this.db.transaction(async (tx) => {
      const { rows } = await tx.query<ShopSettings>(
        `INSERT INTO shop_settings (point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
                                    max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled,
                                    paytables, created_by, timings)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING ${COLUMNS}`,
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
          JSON.stringify(timings),
        ],
      );
      await this.audit.log(staffId, 'shop_settings.update', { type: 'shop_settings', id: rows[0].version }, {}, tx);
      return rows[0];
    });
    await this.loadTimings();
    return withTimings(saved);
  }
}
