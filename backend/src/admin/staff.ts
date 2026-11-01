import * as argon2 from 'argon2';
import { StaffRole } from '../common/auth';
import { Queryable } from '../database/db';
import { newTotpSecret } from './totp';

/** Crée un compte du back-office ; le secret TOTP est à enregistrer dans l'application d'authentification. */
export async function createStaff(
  db: Queryable,
  input: { email: string; role: StaffRole; password: string },
): Promise<{ id: number; totpSecret: string }> {
  const totpSecret = newTotpSecret();
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const { rows } = await db.query<{ id: number }>(
    'INSERT INTO staff (email, password_hash, role, totp_secret) VALUES ($1, $2, $3, $4) RETURNING id',
    [input.email.trim().toLowerCase(), passwordHash, input.role, totpSecret],
  );
  return { id: rows[0].id, totpSecret };
}
