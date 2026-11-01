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

@Injectable()
export class AdminAuthService {
  private dummyHash?: Promise<string>;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  /** Mot de passe + code TOTP ; un code déjà utilisé est refusé. */
  async login(email: string, password: string, code: string) {
    const { rows } = await this.db.query<{
      id: number;
      password_hash: string;
      role: StaffRole;
      totp_secret: string;
      totp_last_counter: number;
      active: boolean;
    }>(
      'SELECT id, password_hash, role, totp_secret, totp_last_counter, active FROM staff WHERE email = $1',
      [email.trim().toLowerCase()],
    );
    const staff = rows[0];
    this.dummyHash ??= argon2.hash('dummy-password', { type: argon2.argon2id });
    const valid = await argon2.verify(staff?.password_hash ?? (await this.dummyHash), password);
    if (!staff || !valid || !staff.active) throw new AppError('INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED);

    const counter = matchTotp(staff.totp_secret, code);
    const accepted =
      counter !== null &&
      (
        await this.db.query(
          'UPDATE staff SET totp_last_counter = $2 WHERE id = $1 AND totp_last_counter < $2 RETURNING id',
          [staff.id, counter],
        )
      ).rows.length === 1;
    if (!accepted) throw new AppError('INVALID_TOTP', HttpStatus.UNAUTHORIZED);

    await this.audit.log(staff.id, 'staff.login', { type: 'staff', id: staff.id });
    const accessToken = await this.jwt.signAsync(
      { sub: String(staff.id), typ: 'staff', role: staff.role },
      { secret: this.config.staffJwtSecret, expiresIn: STAFF_TOKEN_TTL_SECONDS },
    );
    return { accessToken, expiresIn: STAFF_TOKEN_TTL_SECONDS, role: staff.role };
  }
}
