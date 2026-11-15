import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStaff } from '../src/admin/staff';
import { Database } from '../src/database/db';
import { MIGRATIONS_DIR, migrate } from '../src/database/migrate';
import { createPgliteDatabase } from '../src/database/pglite';

jest.setTimeout(120_000);

const MIGRATION = '028_cashier_terminal_follow.sql';

describe('Migration 028 : caissiers liés à une caisse renommée ou supprimée', () => {
  let db: Database;
  let before: string;

  beforeAll(async () => {
    // Base telle qu'avant la migration : toutes les précédentes, sans la 028.
    before = mkdtempSync(join(tmpdir(), 'pp-migrations-'));
    for (const f of readdirSync(MIGRATIONS_DIR)) if (f < MIGRATION) cpSync(join(MIGRATIONS_DIR, f), join(before, f));
    db = createPgliteDatabase();
    await migrate(db, before);
  });

  afterAll(async () => {
    await db.close();
    rmSync(before, { recursive: true, force: true });
  });

  it('suit les renommages de l’historique et retire les liens sans caisse', async () => {
    const setTerminals = (terminals: string[]) =>
      db.query(
        `INSERT INTO shop_settings (point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
                                    max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled, paytables, timings)
         SELECT point_of_sale, issuer, $1::jsonb, stakes_cents, min_stake_cents, max_stake_cents,
                max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled, paytables, timings
           FROM shop_settings ORDER BY version DESC LIMIT 1`,
        [JSON.stringify(terminals)],
      );
    const cashier = async (email: string, terminal?: string) =>
      (await createStaff(db, { email, role: 'cashier', password: 'motdepasse-solide', terminal })).id;

    await setTerminals(['CAISSE #1', 'CAISSE #2', 'CAISSE #3', 'CAISSE #4']);
    const renamed = await cashier('renomme@paryajpaw.test', 'CAISSE #1');
    const twice = await cashier('deux-fois@paryajpaw.test', 'CAISSE #2');
    const removed = await cashier('supprime@paryajpaw.test', 'CAISSE #4');
    const kept = await cashier('garde@paryajpaw.test', 'CAISSE #3');
    const free = await cashier('libre@paryajpaw.test');
    await setTerminals(['CARLINE#1', 'CAISSE #2', 'CAISSE #3', 'CAISSE #4']);
    await setTerminals(['CARLINE#1', 'LOURDE', 'CAISSE #3', 'CAISSE #4']);
    await setTerminals(['CARLINE#1', 'LOURDE#2', 'CAISSE #3', 'CAISSE #4']);
    const lower = await cashier('minuscules@paryajpaw.test', 'Lourde#2');
    await setTerminals(['CARLINE#1', 'LOURDE#2', 'CAISSE #3']);

    expect(await migrate(db)).toContain(MIGRATION);

    const { rows } = await db.query<{ id: number; terminal: string | null }>('SELECT id, terminal FROM staff');
    const terminalOf = (id: number) => rows.find((r) => Number(r.id) === Number(id))?.terminal;
    expect(terminalOf(renamed)).toBe('CARLINE#1');
    expect(terminalOf(twice)).toBe('LOURDE#2');
    expect(terminalOf(lower)).toBe('LOURDE#2');
    expect(terminalOf(kept)).toBe('CAISSE #3');
    expect(terminalOf(removed)).toBeNull();
    expect(terminalOf(free)).toBeNull();
  });
});
