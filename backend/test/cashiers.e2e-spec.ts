import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createStaff } from '../src/admin/staff';
import { totpAt, totpCounter } from '../src/admin/totp';
import { AppModule, configureApp } from '../src/app.module';
import { SMS_SENDER, SmsSender } from '../src/auth/sms';
import { StaffRole } from '../src/common/auth';
import { loadConfig } from '../src/config';
import { DATABASE, Database } from '../src/database/db';
import { migrate } from '../src/database/migrate';
import { SHOP_CLOCK } from '../src/shop/clock';
import { createPgliteDatabase } from '../src/database/pglite';

jest.setTimeout(120_000); // la base de test applique toutes les migrations avant chaque suite

const PASSWORD = 'motdepasse-solide';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Caissiers (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let seq = 0;
  let admin: string;

  beforeAll(async () => {
    db = createPgliteDatabase();
    await migrate(db);
    const config = loadConfig({ NODE_ENV: 'test' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
      .overrideProvider(DATABASE)
      .useValue(db)
      .overrideProvider(SMS_SENDER)
      .useValue({ send: async () => undefined } satisfies SmsSender)
      .overrideProvider(SHOP_CLOCK)
      .useValue({ now: () => Date.now() })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app, config);
    await app.init();
    admin = await login('super_admin');
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  async function login(role: StaffRole): Promise<string> {
    const email = `${role}-${++seq}@paryajpaw.test`;
    const { totpSecret } = await createStaff(db, { email, role, password: PASSWORD });
    const res = await api()
      .post('/api/v1/admin/auth/login')
      .send({ email, password: PASSWORD, totp: totpAt(totpSecret, totpCounter()) })
      .expect(200);
    return res.body.accessToken as string;
  }

  const tryLogin = (email: string, secret: string) =>
    api().post('/api/v1/admin/auth/login').send({ email, password: PASSWORD, totp: totpAt(secret, totpCounter()) });

  it('le propriétaire crée un caissier bloqué, l’autorise, puis le re-bloque', async () => {
    const created = await api()
      .post('/api/v1/admin/cashiers')
      .set(auth(admin))
      .send({ email: 'caissier1@paryajpaw.test', password: PASSWORD, terminal: 'CAISSE #1' })
      .expect(201);
    const id = created.body.id as number;
    const secret = created.body.totpSecret as string;
    expect(id).toBeGreaterThan(0);

    // Bloqué à la création : identifiants corrects mais accès non autorisé (403, message clair).
    const blocked = await tryLogin('caissier1@paryajpaw.test', secret).expect(403);
    expect(blocked.body.code).toBe('ACCOUNT_NOT_AUTHORIZED');

    const list = await api().get('/api/v1/admin/cashiers').set(auth(admin)).expect(200);
    expect(list.body.find((c: { id: number }) => c.id === id)).toMatchObject({
      email: 'caissier1@paryajpaw.test',
      terminal: 'CAISSE #1',
      active: false,
    });

    // Autorisé : il peut se connecter.
    const up = await api().patch(`/api/v1/admin/cashiers/${id}/access`).set(auth(admin)).send({ active: true }).expect(200);
    expect(up.body.active).toBe(true);
    const ok = await tryLogin('caissier1@paryajpaw.test', secret).expect(200);
    expect(ok.body.accessToken).toBeTruthy();

    // Re-bloqué : il ne peut plus se connecter (accès non autorisé).
    await api().patch(`/api/v1/admin/cashiers/${id}/access`).set(auth(admin)).send({ active: false }).expect(200);
    await tryLogin('caissier1@paryajpaw.test', secret).expect(403);
  });

  it('refuse un mot de passe faible et un e-mail déjà pris', async () => {
    await api().post('/api/v1/admin/cashiers').set(auth(admin)).send({ email: 'faible@paryajpaw.test', password: 'court' }).expect(400);
    await api().post('/api/v1/admin/cashiers').set(auth(admin)).send({ email: 'dup@paryajpaw.test', password: PASSWORD }).expect(201);
    await api().post('/api/v1/admin/cashiers').set(auth(admin)).send({ email: 'dup@paryajpaw.test', password: PASSWORD }).expect(409);
  });

  it('la caisse attribuée existe toujours : nom exact, renommage suivi, suppression déliée', async () => {
    const terminalOf = async (id: number) =>
      (await api().get('/api/v1/admin/cashiers').set(auth(admin)).expect(200)).body.find((c: { id: number }) => c.id === id).terminal;
    const create = (email: string, terminal: string) =>
      api().post('/api/v1/admin/cashiers').set(auth(admin)).send({ email, password: PASSWORD, terminal });

    // Caisse inconnue refusée ; minuscules ramenées au nom enregistré.
    expect((await create('fantome@paryajpaw.test', 'CAISSE #99').expect(400)).body.code).toBe('UNKNOWN_TERMINAL');
    const a = (await create('suivi-a@paryajpaw.test', 'caisse #1').expect(201)).body.id as number;
    const b = (await create('suivi-b@paryajpaw.test', 'CAISSE #2').expect(201)).body.id as number;
    expect(await terminalOf(a)).toBe('CAISSE #1');

    const current = (await api().get('/api/v1/admin/shop/settings').set(auth(admin)).expect(200)).body.settings;
    const { version: _v, createdAt: _c, ...input } = current;
    const setTerminals = (terminals: string[]) =>
      api().put('/api/v1/admin/shop/settings').set(auth(admin)).send({ ...input, terminals }).expect(200);

    // Renommée : le compte suit ; l'autre caisse ne bouge pas.
    await setTerminals(['CARLINE#1', ...current.terminals.slice(1)]);
    expect(await terminalOf(a)).toBe('CARLINE#1');
    expect(await terminalOf(b)).toBe('CAISSE #2');

    // Supprimée : le lien est retiré (le caissier choisit sa caisse) ; le propriétaire peut en attribuer une autre.
    await setTerminals(['CARLINE#1']);
    expect(await terminalOf(a)).toBe('CARLINE#1');
    expect(await terminalOf(b)).toBeNull();
    const patch = (terminal: string | null) => api().patch(`/api/v1/admin/cashiers/${b}/terminal`).set(auth(admin)).send({ terminal });
    expect((await patch('CAISSE #2').expect(400)).body.code).toBe('UNKNOWN_TERMINAL');
    expect((await patch('carline#1').expect(200)).body.terminal).toBe('CARLINE#1');
    expect((await patch(null).expect(200)).body.terminal).toBeNull();
    await setTerminals(current.terminals);
  });

  it('le rapport caissier se filtre par caissier et par période (jours d’Haïti)', async () => {
    const a = (await createStaff(db, { email: 'rapport-a@paryajpaw.test', role: 'cashier', password: PASSWORD })).id;
    const b = (await createStaff(db, { email: 'rapport-b@paryajpaw.test', role: 'cashier', password: PASSWORD })).id;
    const report = (staff: number, start: string, end: string, tickets: number) =>
      db.query(
        `INSERT INTO cashier_reports (staff_id, terminal, started_at, ended_at, tickets, stakes_cents, payouts, payouts_cents)
         VALUES ($1, 'CAISSE #1', $2, $3, $4, $4 * 1000, 0, 0)`,
        [staff, start, end, tickets],
      );
    // Janvier : heure d'Haïti = UTC−5. La 2e session finit à 23 h 30 le 10 (04:30Z le 11), la 3e à 00 h 30 le 11.
    await report(a, '2026-01-10T13:00:00Z', '2026-01-10T15:00:00Z', 1);
    await report(a, '2026-01-11T02:00:00Z', '2026-01-11T04:30:00Z', 2);
    await report(a, '2026-01-11T05:00:00Z', '2026-01-11T05:30:00Z', 4);
    await report(b, '2026-01-10T14:00:00Z', '2026-01-10T16:00:00Z', 8);
    const get = (qs: string, token = admin) => api().get(`/api/v1/admin/shop/cashier-reports${qs}`).set(auth(token));
    const tickets = (rows: { tickets: number }[]) => rows.map((r) => r.tickets).sort((x, y) => x - y);

    expect(tickets((await get(`?staffId=${a}&from=2026-01-10&to=2026-01-10`).expect(200)).body)).toEqual([1, 2]);
    expect(tickets((await get(`?staffId=${a}&from=2026-01-11&to=2026-01-11`).expect(200)).body)).toEqual([4]);
    expect(tickets((await get(`?staffId=${a}&from=2026-01-10&to=2026-01-11`).expect(200)).body)).toEqual([1, 2, 4]);
    expect(tickets((await get('?from=2026-01-10&to=2026-01-10').expect(200)).body)).toEqual([1, 2, 8]);
    expect(tickets((await get(`?staffId=${b}`).expect(200)).body)).toEqual([8]);
    expect(tickets((await get(`?staffId=${a}&from=2026-01-12`).expect(200)).body)).toEqual([]);
    expect((await get(`?staffId=${a}`).expect(200)).body[0]).toMatchObject({ staffId: String(a), email: 'rapport-a@paryajpaw.test', tickets: 4 });

    await get('?from=pas-une-date').expect(400);
    await get('?staffId=abc').expect(400);
    const finance = await login('finance');
    await get(`?staffId=${a}`, finance).expect(200);
    const cashierToken = await login('cashier');
    await get('', cashierToken).expect(403);

    const list = (await api().get('/api/v1/admin/shop/cashiers').set(auth(finance)).expect(200)).body as { id: string; email: string; deleted: boolean }[];
    expect(list.find((c) => c.id === String(a))).toMatchObject({ email: 'rapport-a@paryajpaw.test', deleted: false });
    expect(list.find((c) => c.id === String(b))).toBeDefined();
    await api().get('/api/v1/admin/shop/cashiers').set(auth(cashierToken)).expect(403);

    // Un caissier supprimé reste sélectionnable : ses rapports existent encore.
    await api().delete(`/api/v1/admin/cashiers/${b}`).set(auth(admin)).expect(200);
    const after = (await api().get('/api/v1/admin/shop/cashiers').set(auth(admin)).expect(200)).body as { id: string; email: string; deleted: boolean }[];
    expect(after.find((c) => c.id === String(b))).toMatchObject({ email: 'rapport-b@paryajpaw.test', deleted: true });
  });

  it('seul le propriétaire gère les caissiers', async () => {
    const finance = await login('finance');
    await api().get('/api/v1/admin/cashiers').set(auth(finance)).expect(403);
    await api().post('/api/v1/admin/cashiers').set(auth(finance)).send({ email: 'x@paryajpaw.test', password: PASSWORD }).expect(403);
  });
});
