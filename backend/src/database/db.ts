import { Pool, PoolClient, types } from 'pg';

export const DATABASE = Symbol('DATABASE');

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Plusieurs instructions sans paramètres (migrations). */
  exec(sql: string): Promise<void>;
}

export interface Database extends Queryable {
  /** BEGIN … COMMIT ; ROLLBACK si `fn` lève une erreur. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** BIGINT → number : les montants en centimes restent très en dessous de 2^53. */
export function toSafeNumber(value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`BIGINT hors des entiers sûrs : ${value}`);
  return n;
}

export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}

export class PgDatabase implements Database {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    types.setTypeParser(types.builtins.INT8, toSafeNumber);
    this.pool = new Pool({ connectionString });
  }

  async query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
    return (await this.pool.query(sql, params)) as unknown as { rows: T[] };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(wrapClient(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}

function wrapClient(client: PoolClient): Queryable {
  return {
    query: async <T>(sql: string, params?: unknown[]) =>
      (await client.query(sql, params)) as unknown as { rows: T[] },
    exec: async (sql: string) => {
      await client.query(sql);
    },
  };
}
