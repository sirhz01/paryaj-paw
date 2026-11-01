import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PGlite, Transaction } from '@electric-sql/pglite';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { createStaff } from '../admin/staff';
import { otpauthUrl } from '../admin/totp';
import { StaffRole } from '../common/auth';
import { AppModule, configureApp } from '../app.module';
import { loadConfig } from '../config';
import { Database, Queryable, toSafeNumber } from '../database/db';
import { migrate } from '../database/migrate';
import { serveFront } from '../front';

/**
 * npm run dev:local : API + front-end sur http://localhost:3000/ avec une base PGlite persistante (`.dev-data/`),
 * sans PostgreSQL à installer. Les comptes du back-office sont créés au premier lancement
 * et leurs identifiants écrits dans `.dev-data/credentials.txt` (ignoré par git). Développement uniquement.
 */
const DATA_DIR = resolve(__dirname, '..', '..', '.dev-data');
const ACCOUNTS: { email: string; role: StaffRole }[] = [
  { email: 'admin@paryajpaw.local', role: 'super_admin' },
  { email: 'caisse@paryajpaw.local', role: 'cashier' },
];

function localDatabase(): Database {
  const pg = new PGlite(join(DATA_DIR, 'pg'), { parsers: { 20: (value: string) => toSafeNumber(value) } });
  const wrap = (q: PGlite | Transaction): Queryable => ({
    query: async <T>(sql: string, params?: unknown[]) => ({ rows: (await q.query<T>(sql, params)).rows }),
    exec: async (sql: string) => {
      await q.exec(sql);
    },
  });
  return { ...wrap(pg), transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))), close: () => pg.close() };
}

async function ensureAccounts(db: Database): Promise<void> {
  const file = join(DATA_DIR, 'credentials.txt');
  const lines: string[] = [];
  for (const { email, role } of ACCOUNTS) {
    const { rows } = await db.query('SELECT 1 FROM staff WHERE email = $1', [email]);
    if (rows.length) continue;
    const password = randomBytes(9).toString('base64url');
    const { totpSecret } = await createStaff(db, { email, role, password });
    lines.push(`${role}\n  email : ${email}\n  mot de passe : ${password}\n  secret TOTP : ${totpSecret}\n  ${otpauthUrl(totpSecret, email)}\n`);
  }
  if (!lines.length) return;
  const previous = existsSync(file) ? readFileSync(file, 'utf8') : '';
  writeFileSync(file, previous + lines.join('\n'));
  Logger.log(`Comptes créés : identifiants dans ${file}`, 'DevLocal');
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const config = loadConfig({ ...process.env, NODE_ENV: 'development', PAYMENTS_FAKE: 'true', FRONT_DIR: resolve(__dirname, '..', '..', '..') });
  const db = localDatabase();
  await migrate(db);
  await ensureAccounts(db);
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config, db), { logger: ['error', 'warn', 'log'] });
  configureApp(app, config);
  serveFront(app, config.frontDir);
  await app.listen(config.port);
  Logger.log(`Front + API : http://localhost:${config.port}/  (API /api/v1)`, 'DevLocal');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
