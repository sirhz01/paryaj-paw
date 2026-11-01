import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createStaff } from '../src/admin/staff';
import { AppModule, configureApp } from '../src/app.module';
import { loadConfig } from '../src/config';
import { DATABASE, Database } from '../src/database/db';
import { migrate } from '../src/database/migrate';
import { createPgliteDatabase } from '../src/database/pglite';

const PASSWORD = 'motdepasse-solide';

jest.setTimeout(120_000);

describe('sécurité du back-office : blocage, révocation, caisse liée (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  const api = () => request(app.getHttpServer());
  const login = (email: string, password = PASSWORD) => api().post('/api/v1/admin/auth/login').send({ email, password });

  beforeAll(async () => {
    db = createPgliteDatabase();
    await migrate(db);
    const config = loadConfig({ NODE_ENV: 'test', STAFF_TOTP: 'off' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
      .overrideProvider(DATABASE)
      .useValue(db)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app, config);
    await app.init();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('bloque le compte après 10 échecs, même avec le bon mot de passe, et le note dans le journal', async () => {
    await createStaff(db, { email: 'bloque@test.local', role: 'cashier', password: PASSWORD });
    await login('bloque@test.local', 'mauvais').expect(401);
    await db.query(`UPDATE staff SET failed_logins = 9 WHERE email = 'bloque@test.local'`); // 10e échec de suite
    await login('bloque@test.local', 'mauvais').expect(401);
    const res = await login('bloque@test.local').expect(429);
    expect(res.body.code).toBe('ACCOUNT_LOCKED');
    const { rows } = await db.query<{ details: { locked: boolean } }>(`SELECT details FROM audit_log WHERE action = 'staff.login_failed' ORDER BY id`);
    expect(rows).toHaveLength(2);
    expect(rows[0].details.locked).toBe(false);
    expect(rows[1].details.locked).toBe(true);
    await db.query(`UPDATE staff SET locked_until = now() - interval '1 minute' WHERE email = 'bloque@test.local'`);
    await login('bloque@test.local').expect(200);
  });

  it('un succès remet le compteur d’échecs à zéro', async () => {
    await createStaff(db, { email: 'zero@test.local', role: 'cashier', password: PASSWORD });
    await login('zero@test.local', 'mauvais').expect(401);
    await login('zero@test.local', 'mauvais').expect(401);
    await login('zero@test.local').expect(200);
    const { rows } = await db.query<{ failed_logins: number }>(`SELECT failed_logins FROM staff WHERE email = 'zero@test.local'`);
    expect(rows[0].failed_logins).toBe(0);
  });

  it('un compte désactivé ou révoqué perd l’accès avec son ancien jeton', async () => {
    await createStaff(db, { email: 'revoque@test.local', role: 'cashier', password: PASSWORD });
    const token = (await login('revoque@test.local').expect(200)).body.accessToken;
    const get = () => api().get('/api/v1/shop/report').set({ Authorization: `Bearer ${token}` });
    await get().expect(200);

    const realNow = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(realNow + 60_000); // le cache d'état expire
    await db.query(`UPDATE staff SET active = false, token_version = token_version + 1 WHERE email = 'revoque@test.local'`);
    await get().expect(401);
    await db.query(`UPDATE staff SET active = true WHERE email = 'revoque@test.local'`);
    jest.spyOn(Date, 'now').mockReturnValue(realNow + 120_000);
    await get().expect(401); // la version de session a changé : il faut se reconnecter
    jest.restoreAllMocks();
    const fresh = (await login('revoque@test.local').expect(200)).body.accessToken;
    await api().get('/api/v1/shop/report').set({ Authorization: `Bearer ${fresh}` }).expect(200);
  });

  it('un caissier lié à une caisse ne peut ni vendre ni payer sur une autre', async () => {
    await createStaff(db, { email: 'liee@test.local', role: 'cashier', password: PASSWORD, terminal: 'CAISSE #1' });
    const res = await login('liee@test.local').expect(200);
    expect(res.body.terminal).toBe('CAISSE #1');
    const auth = { Authorization: `Bearer ${res.body.accessToken}` };
    const other = await api().post('/api/v1/shop/tickets/ABCDEFGH/pay').set(auth).send({ terminal: 'CAISSE #2' }).expect(403);
    expect(other.body.code).toBe('TERMINAL_NOT_ALLOWED');
    const own = await api().post('/api/v1/shop/tickets/ABCDEFGH/pay').set(auth).send({ terminal: 'CAISSE #1' });
    expect(own.status).toBe(404);
    const sell = await api()
      .post('/api/v1/shop/tickets')
      .set(auth)
      .send({ game: 'roulette', terminal: 'CAISSE #3', idempotencyKey: 'cle-de-test-0001', lines: [{ key: 'n:7', stakeCents: 2500 }] })
      .expect(403);
    expect(sell.body.code).toBe('TERMINAL_NOT_ALLOWED');
  });
});
