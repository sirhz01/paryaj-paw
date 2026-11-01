import { loadConfig } from '../config';
import { PgDatabase } from '../database/db';
import { migrate } from '../database/migrate';
import { loadEnvFile } from './env';

async function main() {
  loadEnvFile();
  const db = new PgDatabase(loadConfig().databaseUrl);
  try {
    const applied = await migrate(db);
    console.log(applied.length ? `Migrations appliquées : ${applied.join(', ')}` : 'Base déjà à jour');
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
