import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createStaff } from '../src/admin/staff';
import { AppModule, configureApp } from '../src/app.module';
import { loadConfig } from '../src/config';
import { DATABASE, Database } from '../src/database/db';
import { migrate } from '../src/database/migrate';
import { createPgliteDatabase } from '../src/database/pglite';

jest.setTimeout(120_000);

const PASSWORD = 'motdepasse-solide';
const PLATFORM = 'editeur@plateforme.test';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('compte de l’éditeur de la plateforme (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let owner: string;
  let platformId: number;

  beforeAll(async () => {
    db = createPgliteDatabase();
    await migrate(db);
    // Adresse donnée avec des majuscules : la configuration la normalise comme le fait la table staff.
    const config = loadConfig({ NODE_ENV: 'test', STAFF_TOTP: 'off', PLATFORM_ADMIN_EMAIL: ' Editeur@Plateforme.test ' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
      .overrideProvider(DATABASE)
      .useValue(db)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app, config);
    await app.init();
    platformId = (await createStaff(db, { email: PLATFORM, role: 'super_admin', password: PASSWORD })).id;
    await createStaff(db, { email: 'proprio@exploitant.test', role: 'super_admin', password: PASSWORD });
    owner = await login('proprio@exploitant.test');
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  async function login(email: string): Promise<string> {
    const res = await api().post('/api/v1/admin/auth/login').send({ email, password: PASSWORD }).expect(200);
    return res.body.accessToken as string;
  }

  it('n’apparaît pas dans la liste des administrateurs de l’exploitant', async () => {
    const res = await api().get('/api/v1/admin/admins').set(auth(owner)).expect(200);
    expect((res.body as { email: string }[]).map((a) => a.email)).toEqual(['proprio@exploitant.test']);
  });

  it('ne peut être ni bloqué, ni modifié, ni supprimé par l’exploitant, et se connecte toujours', async () => {
    await api().patch(`/api/v1/admin/admins/${platformId}/access`).set(auth(owner)).send({ active: false }).expect(404);
    await api().patch(`/api/v1/admin/admins/${platformId}/password`).set(auth(owner)).send({ password: 'autre-motdepasse-solide' }).expect(404);
    await api().delete(`/api/v1/admin/admins/${platformId}`).set(auth(owner)).expect(404);

    const { rows } = await db.query<{ email: string; active: boolean; deleted_at: Date | null }>(
      'SELECT email, active, deleted_at FROM staff WHERE id = $1',
      [platformId],
    );
    expect(rows[0]).toEqual({ email: PLATFORM, active: true, deleted_at: null });
    await login(PLATFORM);
  });

  it('gère, lui, les administrateurs de l’exploitant', async () => {
    const platform = await login(PLATFORM);
    const list = await api().get('/api/v1/admin/admins').set(auth(platform)).expect(200);
    const target = (list.body as { id: number; email: string }[]).find((a) => a.email === 'proprio@exploitant.test');
    await api().patch(`/api/v1/admin/admins/${target!.id}/access`).set(auth(platform)).send({ active: false }).expect(200);
    await api().post('/api/v1/admin/auth/login').send({ email: 'proprio@exploitant.test', password: PASSWORD }).expect(403);
    await api().patch(`/api/v1/admin/admins/${target!.id}/access`).set(auth(platform)).send({ active: true }).expect(200);
  });
});
