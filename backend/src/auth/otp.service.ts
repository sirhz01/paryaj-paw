import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { AppError } from '../common/errors';
import { AppConfig, CONFIG } from '../config';
import { DATABASE, Database } from '../database/db';
import { EMAIL_SENDER, EmailSender } from './email';

export type OtpPurpose = 'register' | 'reset_password';

const MAX_SENDS_PER_10_MIN = 3;
const MAX_ATTEMPTS = 5;

// La colonne otp_codes.phone sert de clé « contact » : elle stocke désormais l'adresse e-mail.
@Injectable()
export class OtpService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async send(contact: string, purpose: OtpPurpose): Promise<void> {
    const { rows } = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM otp_codes WHERE phone = $1 AND created_at > now() - interval '10 minutes'`,
      [contact],
    );
    if (rows[0].n >= MAX_SENDS_PER_10_MIN) throw new AppError('OTP_TOO_MANY_REQUESTS', HttpStatus.TOO_MANY_REQUESTS);

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.db.query(
      `INSERT INTO otp_codes (phone, purpose, code_hash, expires_at) VALUES ($1, $2, $3, now() + interval '5 minutes')`,
      [contact, purpose, this.hash(contact, purpose, code)],
    );
    await this.email.send(
      contact,
      'Paryaj Paw — code de vérification',
      `Votre code de vérification Paryaj Paw est : ${code}. Il est valable 5 minutes.`,
    );
  }

  /** Consomme le dernier code envoyé ; chaque échec compte, même si l'appelant abandonne ensuite. */
  async verify(contact: string, purpose: OtpPurpose, code: string): Promise<void> {
    const valid = await this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: number; code_hash: string; attempts: number }>(
        `SELECT id, code_hash, attempts FROM otp_codes
          WHERE phone = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now()
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [contact, purpose],
      );
      const otp = rows[0];
      if (!otp || otp.attempts >= MAX_ATTEMPTS) return false;

      const expected = Buffer.from(otp.code_hash, 'hex');
      const given = Buffer.from(this.hash(contact, purpose, code), 'hex');
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
        await tx.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id]);
        return false;
      }
      await tx.query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [otp.id]);
      return true;
    });
    if (!valid) throw new AppError('OTP_INVALID');
  }

  private hash(contact: string, purpose: OtpPurpose, code: string): string {
    return createHmac('sha256', this.config.otpPepper).update(`${contact}:${purpose}:${code}`).digest('hex');
  }
}
