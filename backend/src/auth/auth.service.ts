import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../common/errors';
import { isAdult, normalizeHaitiPhone } from '../common/haiti';
import { AppConfig, CONFIG } from '../config';
import { DATABASE, Database, Queryable, isUniqueViolation } from '../database/db';
import { LoginDto, RegisterDto, ResetPasswordDto } from './dto';
import { OtpPurpose, OtpService } from './otp.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  /** Hash factice : un numéro inconnu coûte autant qu'un mauvais mot de passe. */
  private dummyHash?: Promise<string>;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly otp: OtpService,
    private readonly jwt: JwtService,
  ) {}

  async requestOtp(rawPhone: string, purpose: OtpPurpose): Promise<void> {
    const phone = this.phone(rawPhone);
    const exists = (await this.findUser(phone)) !== undefined;
    if (purpose === 'register' && exists) throw new AppError('PHONE_ALREADY_REGISTERED', HttpStatus.CONFLICT);
    // Pas de SMS pour un numéro inconnu, sans le signaler.
    if (purpose === 'reset_password' && !exists) return;
    await this.otp.send(phone, purpose);
  }

  async register(dto: RegisterDto): Promise<TokenPair> {
    const phone = this.phone(dto.phone);
    if (!isAdult(dto.birthDate)) throw new AppError('UNDERAGE', HttpStatus.FORBIDDEN);
    if (await this.findUser(phone)) throw new AppError('PHONE_ALREADY_REGISTERED', HttpStatus.CONFLICT);
    await this.otp.verify(phone, 'register', dto.otp);

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    try {
      return await this.db.transaction(async (tx) => {
        const { rows } = await tx.query<{ id: number }>(
          `INSERT INTO users (phone, password_hash, full_name, birth_date, language)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [phone, passwordHash, dto.fullName ?? null, dto.birthDate, dto.language ?? 'ht'],
        );
        await tx.query('INSERT INTO wallets (user_id) VALUES ($1)', [rows[0].id]);
        return this.issueTokens(tx, rows[0].id);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('PHONE_ALREADY_REGISTERED', HttpStatus.CONFLICT);
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    const phone = normalizeHaitiPhone(dto.phone);
    const user = phone ? await this.findUser(phone) : undefined;
    this.dummyHash ??= argon2.hash('dummy-password', { type: argon2.argon2id });
    const valid = await argon2.verify(user?.password_hash ?? (await this.dummyHash), dto.password);
    if (!user || !valid) throw new AppError('INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED);
    if (user.status === 'blocked') throw new AppError('ACCOUNT_BLOCKED', HttpStatus.FORBIDDEN);
    return this.issueTokens(this.db, user.id);
  }

  /** Rotation : l'ancien jeton est révoqué, un jeton déjà utilisé est refusé. */
  refresh(refreshToken: string): Promise<TokenPair> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: number; user_id: number; status: string }>(
        `SELECT t.id, t.user_id, u.status FROM refresh_tokens t JOIN users u ON u.id = t.user_id
          WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND t.expires_at > now()
          FOR UPDATE OF t`,
        [sha256(refreshToken)],
      );
      const token = rows[0];
      if (!token) throw new AppError('INVALID_REFRESH_TOKEN', HttpStatus.UNAUTHORIZED);
      if (token.status === 'blocked') throw new AppError('ACCOUNT_BLOCKED', HttpStatus.FORBIDDEN);
      await tx.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [token.id]);
      return this.issueTokens(tx, token.user_id);
    });
  }

  async logout(refreshToken: string): Promise<void> {
    await this.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [
      sha256(refreshToken),
    ]);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const phone = this.phone(dto.phone);
    const user = await this.findUser(phone);
    if (!user) throw new AppError('OTP_INVALID');
    await this.otp.verify(phone, 'reset_password', dto.otp);
    const passwordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });
    await this.db.transaction(async (tx) => {
      await tx.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, passwordHash]);
      await tx.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [user.id]);
    });
  }

  private async issueTokens(tx: Queryable, userId: number): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      { sub: String(userId), typ: 'player' },
      { secret: this.config.jwtSecret, expiresIn: this.config.accessTokenTtlSeconds, algorithm: 'HS256' },
    );
    const refreshToken = randomBytes(32).toString('base64url');
    await tx.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + make_interval(days => $3::int))`,
      [userId, sha256(refreshToken), this.config.refreshTokenTtlDays],
    );
    return { accessToken, refreshToken, expiresIn: this.config.accessTokenTtlSeconds };
  }

  private async findUser(phone: string) {
    const { rows } = await this.db.query<{ id: number; password_hash: string; status: string }>(
      'SELECT id, password_hash, status FROM users WHERE phone = $1',
      [phone],
    );
    return rows[0];
  }

  private phone(raw: string): string {
    const phone = normalizeHaitiPhone(raw);
    if (!phone) throw new AppError('INVALID_PHONE');
    return phone;
  }
}
