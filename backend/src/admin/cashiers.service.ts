import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuditService } from '../common/audit.service';
import { AppError } from '../common/errors';
import { DATABASE, Database } from '../database/db';
import { createStaff } from './staff';

export interface CashierView {
  id: number;
  email: string;
  terminal: string | null;
  active: boolean;
  locked: boolean;
  createdAt: Date;
}

const VIEW = `id, email, terminal, active,
  (locked_until IS NOT NULL AND locked_until > now()) AS locked, created_at AS "createdAt"`;

/** Comptes caissiers (rôle cashier) : création, autorisation d'accès et mot de passe, gérés par le propriétaire. */
@Injectable()
export class CashiersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  list(): Promise<CashierView[]> {
    return this.db
      .query<CashierView>(`SELECT ${VIEW} FROM staff WHERE role = 'cashier' ORDER BY created_at`)
      .then((r) => r.rows);
  }

  /** Crée un caissier bloqué : il ne pourra se connecter qu'une fois autorisé. */
  async create(
    adminId: number,
    input: { email: string; password: string; terminal?: string },
  ): Promise<{ id: number; totpSecret: string }> {
    let created: { id: number; totpSecret: string };
    try {
      created = await createStaff(this.db, { ...input, role: 'cashier', active: false });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new AppError('EMAIL_TAKEN', 409);
      throw error;
    }
    await this.audit.log(adminId, 'cashier.create', { type: 'staff', id: created.id }, { email: input.email, terminal: input.terminal ?? null });
    return created;
  }

  /** Autorise (active) ou bloque un caissier ; un blocage coupe ses sessions en cours (token_version). */
  async setAccess(adminId: number, id: number, active: boolean): Promise<CashierView> {
    const { rows } = await this.db.query<CashierView>(
      `UPDATE staff SET active = $2, token_version = token_version + 1, failed_logins = 0, locked_until = NULL
         WHERE id = $1 AND role = 'cashier' RETURNING ${VIEW}`,
      [id, active],
    );
    if (!rows[0]) throw new AppError('CASHIER_NOT_FOUND', 404);
    await this.audit.log(adminId, active ? 'cashier.authorize' : 'cashier.block', { type: 'staff', id }, {});
    return rows[0];
  }

  /** Change le mot de passe d'un caissier et coupe ses sessions en cours. */
  async resetPassword(adminId: number, id: number, password: string): Promise<void> {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const { rows } = await this.db.query<{ id: number }>(
      `UPDATE staff SET password_hash = $2, token_version = token_version + 1, failed_logins = 0, locked_until = NULL
         WHERE id = $1 AND role = 'cashier' RETURNING id`,
      [id, passwordHash],
    );
    if (!rows[0]) throw new AppError('CASHIER_NOT_FOUND', 404);
    await this.audit.log(adminId, 'cashier.reset_password', { type: 'staff', id }, {});
  }
}
