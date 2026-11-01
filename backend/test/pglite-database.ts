import { PGlite, Transaction } from '@electric-sql/pglite';
import { Database, Queryable, toSafeNumber } from '../src/database/db';

/** PostgreSQL en mémoire (WebAssembly) avec la même interface que PgDatabase. */
export function createTestDatabase(): Database {
  const pg = new PGlite({ parsers: { 20: (value: string) => toSafeNumber(value) } });

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
