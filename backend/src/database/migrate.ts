import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from './db';

/** `backend/migrations`, que le code tourne depuis `src/` ou `dist/`. */
export const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

/** Applique dans l'ordre les fichiers .sql pas encore enregistrés ; renvoie leurs noms. */
export async function migrate(db: Database, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
  );
  const { rows } = await db.query<{ name: string }>('SELECT name FROM schema_migrations');
  const done = new Set(rows.map((r) => r.name));

  const applied: string[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    const sql = readFileSync(join(dir, name), 'utf8');
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    });
    applied.push(name);
  }
  return applied;
}
