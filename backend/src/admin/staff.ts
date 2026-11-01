import * as argon2 from 'argon2';
import { StaffRole } from '../common/auth';
import { Queryable } from '../database/db';
import { newTotpSecret } from './totp';

/**
 * Crée un compte du back-office ; le secret TOTP est à enregistrer dans l'application d'authentification.
 * `active` à false crée un compte bloqué, qui ne peut pas se connecter tant qu'il n'est pas autorisé.
 */
export async function createStaff(
  db: Queryable,
  input: { email: string; role: StaffRole; password: string; terminal?: string; active?: boolean },
): Promise<{ id: number; totpSecret: string }> {
  const totpSecret = newTotpSecret();
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const { rows } = await db.query<{ id: number }>(
    'INSERT INTO staff (email, password_hash, role, totp_secret, terminal, active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [input.email.trim().toLowerCase(), passwordHash, input.role, totpSecret, input.terminal?.trim() || null, input.active ?? true],
  );
  return { id: rows[0].id, totpSecret };
}
