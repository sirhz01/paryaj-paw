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

  it('seul le propriétaire gère les caissiers', async () => {
    const finance = await login('finance');
    await api().get('/api/v1/admin/cashiers').set(auth(finance)).expect(403);
    await api().post('/api/v1/admin/cashiers').set(auth(finance)).send({ email: 'x@paryajpaw.test', password: PASSWORD }).expect(403);
  });
});
