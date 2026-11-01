import * as argon2 from 'argon2';
import { StaffRole } from '../common/auth';
import { Queryable } from '../database/db';
import { newTotpSecret } from './totp';

/** Crée un compte du back-office ; le secret TOTP est à enregistrer dans l'application d'authentification. */
export async function createStaff(
  db: Queryable,
  input: { email: string; role: StaffRole; password: string; terminal?: string },
): Promise<{ id: number; totpSecret: string }> {
  const totpSecret = newTotpSecret();
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const { rows } = await db.query<{ id: number }>(
    'INSERT INTO staff (email, password_hash, role, totp_secret, terminal) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [input.email.trim().toLowerCase(), passwordHash, input.role, totpSecret, input.terminal?.trim() || null],
  );
  return { id: rows[0].id, totpSecret };
}
