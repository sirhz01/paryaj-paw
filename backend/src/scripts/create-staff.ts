import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createStaff } from '../admin/staff';
import { otpauthUrl } from '../admin/totp';
import { STAFF_ROLES, StaffRole } from '../common/auth';
import { loadConfig } from '../config';
import { PgDatabase } from '../database/db';
import { loadEnvFile } from './env';

/**
 * npm run staff:create -- --email chef@exemple.ht --role super_admin
 * Mot de passe : variable STAFF_PASSWORD, sinon généré et affiché une seule fois.
 */
async function main() {
  const { values } = parseArgs({ options: { email: { type: 'string' }, role: { type: 'string' } } });
  if (!values.email || !STAFF_ROLES.includes(values.role as StaffRole)) {
    throw new Error(`Usage : --email <adresse> --role <${STAFF_ROLES.join('|')}>`);
  }
  loadEnvFile();
  const password = process.env.STAFF_PASSWORD ?? randomBytes(12).toString('base64url');
  const db = new PgDatabase(loadConfig().databaseUrl);
  try {
    const { id, totpSecret } = await createStaff(db, {
      email: values.email,
      role: values.role as StaffRole,
      password,
    });
    console.log(`Compte ${id} créé (${values.role})`);
    if (!process.env.STAFF_PASSWORD) console.log(`Mot de passe : ${password}`);
    console.log(`Secret TOTP : ${totpSecret}`);
    console.log(`Lien pour l'application d'authentification : ${otpauthUrl(totpSecret, values.email)}`);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
