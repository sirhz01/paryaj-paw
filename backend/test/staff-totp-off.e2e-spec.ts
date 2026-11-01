import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createStaff } from '../src/admin/staff';
import { AppModule, configureApp } from '../src/app.module';
import { loadConfig } from '../src/config';
import { DATABASE, Database } from '../src/database/db';
import { migrate } from '../src/database/migrate';
import { createPgliteDatabase } from '../src/database/pglite';

describe('connexion du back-office avec STAFF_TOTP=off (e2e)', () => {
  let app: INestApplication;
  let db: Database;

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
    await app.close();
  });

  it('accepte e-mail et mot de passe sans code, le dit à la caisse et le note dans le journal', async () => {
    await createStaff(db, { email: 'caisse@test.local', role: 'cashier', password: 'motdepasse-solide' });
    const api = request(app.getHttpServer());
    const res = await api.post('/api/v1/admin/auth/login').send({ email: 'caisse@test.local', password: 'motdepasse-solide' }).expect(200);
    expect(res.body).toMatchObject({ role: 'cashier' });
    await request(app.getHttpServer())
      .post('/api/v1/admin/auth/login')
      .send({ email: 'caisse@test.local', password: 'mauvais-mdp' })
      .expect(401);
    expect((await request(app.getHttpServer()).get('/api/v1/shop/config').expect(200)).body.staffTotpRequired).toBe(false);
    const { rows } = await db.query<{ details: { totp: boolean } }>(`SELECT details FROM audit_log WHERE action = 'staff.login'`);
    expect(rows[0].details).toEqual({ totp: false });
  });
});
