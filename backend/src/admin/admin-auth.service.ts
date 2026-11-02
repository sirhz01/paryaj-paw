import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuditService } from '../common/audit.service';
import { StaffRole } from '../common/auth';
import { AppError } from '../common/errors';
import { AppConfig, CONFIG } from '../config';
import { DATABASE, Database } from '../database/db';
import { matchTotp } from './totp';

const STAFF_TOKEN_TTL_SECONDS = 3600;
/** Un caissier garde sa session le temps d'un service. */
const CASHIER_TOKEN_TTL_SECONDS = 12 * 3600;
/** Après autant d'échecs de suite sur un compte (mot de passe ou code), il est bloqué pendant LOCK_MINUTES. */
const MAX_FAILED_LOGINS = 10;
const LOCK_MINUTES = 15;

@Injectable()
export class AdminAuthService {
  private dummyHash?: Promise<string>;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  /** Mot de passe + code TOTP (sauf STAFF_TOTP=off, hors production) ; un code déjà utilisé est refusé. */
  async login(email: string, password: string, code?: string) {
    const { rows } = await this.db.query<{
      id: number;
      password_hash: string;
      role: StaffRole;
      totp_secret: string;
      totp_last_counter: number;
      active: boolean;
      token_version: number;
      terminal: string | null;
      locked: boolean;
    }>(
      `SELECT id, password_hash, role, totp_secret, totp_last_counter, active, token_version, terminal,
              (locked_until IS NOT NULL AND locked_until > now()) AS locked
         FROM staff WHERE email = $1`,
      [email.trim().toLowerCase()],
    );
    const staff = rows[0];
    if (staff?.locked) throw new AppError('ACCOUNT_LOCKED', HttpStatus.TOO_MANY_REQUESTS, { minutes: LOCK_MINUTES });
    this.dummyHash ??= argon2.hash('dummy-password', { type: argon2.argon2id });
    const valid = await argon2.verify(staff?.password_hash ?? (await this.dummyHash), password);
    if (!staff || !valid) {
      if (staff) await this.recordFailure(staff.id, 'password');
      throw new AppError('INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED);
    }
    // Identifiants corrects mais compte non autorisé : message clair (sans compter d'échec), pour que
    // le caissier sache qu'il attend l'autorisation du responsable, et non qu'il s'est trompé.
    if (!staff.active) throw new AppError('ACCOUNT_NOT_AUTHORIZED', HttpStatus.FORBIDDEN);

    // Le code à 6 chiffres n'est exigé que pour les comptes du back-office (propriétaire, finance…) ;
    // les caissiers se connectent avec e-mail et mot de passe seulement (connexions fréquentes en service).
    const totpRequired = this.config.staffTotpRequired && staff.role !== 'cashier';
    if (totpRequired) {
      const counter = code === undefined ? null : matchTotp(staff.totp_secret, code);
      const accepted =
        counter !== null &&
        (
          await this.db.query(
            'UPDATE staff SET totp_last_counter = $2 WHERE id = $1 AND totp_last_counter < $2 RETURNING id',
            [staff.id, counter],
          )
        ).rows.length === 1;
      if (!accepted) {
        await this.recordFailure(staff.id, 'totp');
        throw new AppError('INVALID_TOTP', HttpStatus.UNAUTHORIZED);
      }
    }

    await this.db.query('UPDATE staff SET failed_logins = 0, locked_until = NULL WHERE id = $1', [staff.id]);
    await this.audit.log(staff.id, 'staff.login', { type: 'staff', id: staff.id }, { totp: totpRequired });
    const expiresIn = staff.role === 'cashier' ? CASHIER_TOKEN_TTL_SECONDS : STAFF_TOKEN_TTL_SECONDS;
    const accessToken = await this.jwt.signAsync(
      { sub: String(staff.id), typ: 'staff', role: staff.role, tv: staff.token_version },
      { secret: this.config.staffJwtSecret, expiresIn, algorithm: 'HS256' },
    );
    return { accessToken, expiresIn, role: staff.role, terminal: staff.terminal };
  }

  /**
   * Le membre du personnel change son propre mot de passe : l'actuel doit être fourni et correct.
   * Coupe les autres sessions (token_version), donc l'utilisateur se reconnecte avec le nouveau mot de passe.
   */
  async changePassword(staffId: number, currentPassword: string, newPassword: string): Promise<void> {
    const { rows } = await this.db.query<{ password_hash: string }>(
      'SELECT password_hash FROM staff WHERE id = $1',
      [staffId],
    );
    const staff = rows[0];
    if (!staff) throw new AppError('STAFF_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (!(await argon2.verify(staff.password_hash, currentPassword))) {
      throw new AppError('INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED);
    }
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.db.query(
      `UPDATE staff SET password_hash = $2, token_version = token_version + 1, failed_logins = 0, locked_until = NULL
         WHERE id = $1`,
      [staffId, passwordHash],
    );
    await this.audit.log(staffId, 'staff.change_password', { type: 'staff', id: staffId }, {});
  }

  /** Compte l'échec, bloque le compte au seuil, et le note dans le journal d'audit. */
  private async recordFailure(staffId: number, reason: 'password' | 'totp'): Promise<void> {
    const { rows } = await this.db.query<{ locked: boolean }>(
      `UPDATE staff
          SET failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END,
              locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3::int) ELSE locked_until END
        WHERE id = $1 RETURNING (failed_logins = 0) AS locked`,
      [staffId, MAX_FAILED_LOGINS, LOCK_MINUTES],
    );
    await this.audit.log(staffId, 'staff.login_failed', { type: 'staff', id: staffId }, { reason, locked: rows[0]?.locked === true });
  }
}
