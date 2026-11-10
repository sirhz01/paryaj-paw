import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuditService } from '../common/audit.service';
import { AppError } from '../common/errors';
import { AppConfig, CONFIG } from '../config';
import { DATABASE, Database } from '../database/db';
import { createStaff } from './staff';

/** Rôles proposés à la création : accès complet ou consultation seulement. */
export const ADMIN_ROLES = ['super_admin', 'auditor'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export interface AdminView {
  id: number;
  email: string;
  role: string;
  active: boolean;
  locked: boolean;
  createdAt: Date;
}

const VIEW = `id, email, role, active,
  (locked_until IS NOT NULL AND locked_until > now()) AS locked, created_at AS "createdAt"`;

/** Comptes d'administration (tous les rôles sauf caissier), gérés par le propriétaire. */
@Injectable()
export class AdminsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Compte de l'éditeur de la plateforme : absent de la liste, et ni blocable, ni modifiable, ni supprimable d'ici.
   * Vide quand il n'y en a pas : aucune adresse ne vaut '', les filtres `email <> …` ne retirent alors rien.
   */
  private get platformEmail(): string {
    return this.config.platformAdminEmail;
  }

  list(): Promise<AdminView[]> {
    return this.db
      .query<AdminView>(
        `SELECT ${VIEW} FROM staff WHERE role <> 'cashier' AND deleted_at IS NULL AND email <> $1 ORDER BY created_at`,
        [this.platformEmail],
      )
      .then((r) => r.rows);
  }

  /** Crée un administrateur actif : il peut se connecter tout de suite avec son e-mail et son mot de passe. */
  async create(adminId: number, input: { email: string; password: string; role: AdminRole }): Promise<{ id: number; totpSecret: string }> {
    let created: { id: number; totpSecret: string };
    try {
      created = await createStaff(this.db, { ...input, active: true });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new AppError('EMAIL_TAKEN', 409);
      throw error;
    }
    await this.audit.log(adminId, 'admin.create', { type: 'staff', id: created.id }, { email: input.email, role: input.role });
    return created;
  }

  /** Autorise ou bloque un administrateur ; un blocage coupe ses sessions. On ne se bloque pas soi-même. */
  async setAccess(adminId: number, id: number, active: boolean): Promise<AdminView> {
    if (id === adminId && !active) throw new AppError('CANNOT_BLOCK_SELF', 400);
    const { rows } = await this.db.query<AdminView>(
      `UPDATE staff SET active = $2, token_version = token_version + 1, failed_logins = 0, locked_until = NULL
         WHERE id = $1 AND role <> 'cashier' AND email <> $3 RETURNING ${VIEW}`,
      [id, active, this.platformEmail],
    );
    if (!rows[0]) throw new AppError('ADMIN_NOT_FOUND', 404);
    await this.audit.log(adminId, active ? 'admin.authorize' : 'admin.block', { type: 'staff', id }, {});
    return rows[0];
  }

  /** Change le mot de passe d'un autre administrateur et coupe ses sessions (le sien se change dans « Mon mot de passe »). */
  async resetPassword(adminId: number, id: number, password: string): Promise<void> {
    if (id === adminId) throw new AppError('USE_OWN_PASSWORD_FORM', 400);
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const { rows } = await this.db.query<{ id: number }>(
      `UPDATE staff SET password_hash = $2, token_version = token_version + 1, failed_logins = 0, locked_until = NULL
         WHERE id = $1 AND role <> 'cashier' AND email <> $3 RETURNING id`,
      [id, passwordHash, this.platformEmail],
    );
    if (!rows[0]) throw new AppError('ADMIN_NOT_FOUND', 404);
    await this.audit.log(adminId, 'admin.reset_password', { type: 'staff', id }, {});
  }

  /** Supprime un administrateur (jamais soi-même) : retiré des listes, bloqué, e-mail libéré ; l'historique est conservé. */
  async remove(adminId: number, id: number): Promise<void> {
    if (id === adminId) throw new AppError('CANNOT_DELETE_SELF', 400);
    const { rows } = await this.db.query<{ email: string }>(
      `UPDATE staff SET deleted_at = now(), active = false, token_version = token_version + 1,
                email = email || '#supprime-' || id
          WHERE id = $1 AND role <> 'cashier' AND deleted_at IS NULL AND email <> $2
          RETURNING regexp_replace(email, '#supprime-[0-9]+$', '') AS email`,
      [id, this.platformEmail],
    );
    if (!rows[0]) throw new AppError('ADMIN_NOT_FOUND', 404);
    await this.audit.log(adminId, 'admin.delete', { type: 'staff', id }, { email: rows[0].email });
  }
}
