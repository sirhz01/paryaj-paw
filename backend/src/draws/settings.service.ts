import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { AppError } from '../common/errors';
import { DATABASE, Database, Queryable } from '../database/db';
import { DrawConfig, DrawGame, validateDrawConfig } from './games';

export interface DrawSettings<C extends DrawConfig = DrawConfig> {
  version: number;
  game: DrawGame;
  config: C;
  createdAt: Date;
}

const COLUMNS = `version, game, config, created_at AS "createdAt"`;

/** Paramètres versionnés par jeu. Un ticket est réglé avec la version en vigueur à son achat. */
@Injectable()
export class DrawSettingsService {
  /** Les versions ne changent jamais (table append-only) : on peut les garder en mémoire. */
  private readonly byVersionCache = new Map<number, DrawSettings>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async current(game: DrawGame, q: Queryable = this.db): Promise<DrawSettings> {
    const { rows } = await q.query<DrawSettings>(
      `SELECT ${COLUMNS} FROM draw_game_settings WHERE game = $1 ORDER BY version DESC LIMIT 1`,
      [game],
    );
    return rows[0];
  }

  /** `q` : la transaction en cours, pour ne pas ouvrir une deuxième connexion pendant un règlement. */
  async byVersion(version: number, q: Queryable = this.db): Promise<DrawSettings> {
    const cached = this.byVersionCache.get(version);
    if (cached) return cached;
    const { rows } = await q.query<DrawSettings>(`SELECT ${COLUMNS} FROM draw_game_settings WHERE version = $1`, [version]);
    this.byVersionCache.set(version, rows[0]);
    return rows[0];
  }

  async history(game: DrawGame): Promise<DrawSettings[]> {
    const { rows } = await this.db.query<DrawSettings>(
      `SELECT ${COLUMNS} FROM draw_game_settings WHERE game = $1 ORDER BY version DESC`,
      [game],
    );
    return rows;
  }

  /** Les tirages déjà programmés gardent leur horaire ; le nouvel intervalle s'applique aux suivants. */
  update(staffId: number, game: DrawGame, config: DrawConfig): Promise<DrawSettings> {
    const errors = validateDrawConfig(game, config);
    if (errors.length > 0) throw new AppError('INVALID_SETTINGS', HttpStatus.BAD_REQUEST, { errors });
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<DrawSettings>(
        `INSERT INTO draw_game_settings (game, config, created_by) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
        [game, JSON.stringify(config), staffId],
      );
      await this.audit.log(staffId, 'draws.settings.update', { type: 'draw_game_settings', id: rows[0].version }, { game }, tx);
      return rows[0];
    });
  }
}
