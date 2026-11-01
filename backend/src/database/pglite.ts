import { PGlite, Transaction } from '@electric-sql/pglite';
import { Database, Queryable, toSafeNumber } from './db';

/**
 * PostgreSQL en WebAssembly (PGlite) avec la même interface que PgDatabase, pour les tests et `npm run demo`.
 * Sans `dataDir`, la base est en mémoire ; avec, elle est gardée dans ce dossier. Pas pour la production.
 */
export function createPgliteDatabase(dataDir?: string): Database {
  const pg = new PGlite(dataDir, { parsers: { 20: (value: string) => toSafeNumber(value) } });

  const wrap = (q: PGlite | Transaction): Queryable => ({
    query: async <T>(sql: string, params?: unknown[]) => ({ rows: (await q.query<T>(sql, params)).rows }),
    exec: async (sql: string) => {
      await q.exec(sql);
    },
  });

  return {
    ...wrap(pg),
    transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))),
    close: () => pg.close(),
  };
}
