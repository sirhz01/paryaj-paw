import { parseArgs } from 'node:util';
import { loadConfig } from '../config';
import { PgDatabase } from '../database/db';
import { loadEnvFile } from './env';

/**
 * npm run staff:access -- --email caissier@exemple.ht --off   désactive le compte et coupe ses sessions
 * npm run staff:access -- --email caissier@exemple.ht --on    le réactive
 * Le serveur applique le changement en moins de 10 secondes, sans redémarrage.
 */
async function main() {
  const { values } = parseArgs({ options: { email: { type: 'string' }, on: { type: 'boolean' }, off: { type: 'boolean' } } });
  if (!values.email || values.on === values.off) throw new Error('Usage : --email <adresse> (--on | --off)');
  loadEnvFile();
  const db = new PgDatabase(loadConfig().databaseUrl);
  try {
    const { rows } = await db.query<{ id: number }>(
      'UPDATE staff SET active = $2, token_version = token_version + 1, failed_logins = 0, locked_until = NULL WHERE email = $1 RETURNING id',
      [values.email.trim().toLowerCase(), values.on === true],
    );
    if (!rows[0]) throw new Error('Compte introuvable');
    console.log(`Compte ${rows[0].id} ${values.on ? 'réactivé' : 'désactivé, sessions révoquées'}`);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
