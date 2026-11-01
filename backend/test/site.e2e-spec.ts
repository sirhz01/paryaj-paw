import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule, configureApp } from '../src/app.module';
import { loadConfig } from '../src/config';
import { DATABASE, Database } from '../src/database/db';
import { migrate } from '../src/database/migrate';
import { createPgliteDatabase } from '../src/database/pglite';

describe('site public : contact anti-spam et audience (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  const post = (path: string, body: object) => request(app.getHttpServer()).post(`/api/v1/site/${path}`).send(body);
  const valid = { name: 'Marie', email: 'Marie@Exemple.ht', message: 'Bonjour, une question sur mon ticket.', elapsedMs: 8000 };
  const count = async (sql: string) => (await db.query<{ n: number }>(sql)).rows[0].n;

  beforeAll(async () => {
    db = createPgliteDatabase();
    await migrate(db);
    const config = loadConfig({ NODE_ENV: 'test' });
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

  it('enregistre un message légitime (e-mail en minuscules)', async () => {
    await post('contact', valid).expect(202);
    const { rows } = await db.query<{ email: string }>('SELECT email FROM contact_messages');
    expect(rows).toEqual([{ email: 'marie@exemple.ht' }]);
  });

  it('écarte sans le dire le champ piège rempli et l’envoi trop rapide', async () => {
    await post('contact', { ...valid, website: 'http://spam.example' }).expect(202);
    await post('contact', { ...valid, elapsedMs: 200 }).expect(202);
    expect(await count('SELECT count(*)::int AS n FROM contact_messages')).toBe(1);
  });

  it('refuse un message invalide', async () => {
    await post('contact', { ...valid, email: 'pas-un-email' }).expect(400);
    await post('contact', { ...valid, message: 'court' }).expect(400);
  });

  it('compte les pages suivies et ignore tout autre chemin', async () => {
    await post('pageview', { path: '/' }).expect(204);
    await post('pageview', { path: '/' }).expect(204);
    await post('pageview', { path: '/<script>' }).expect(204);
    const { rows } = await db.query<{ path: string; views: number }>('SELECT path, views FROM site_pageviews');
    expect(rows).toEqual([{ path: '/', views: 2 }]);
  });

  it('réserve la lecture au back-office', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/site/overview?from=2026-01-01&to=2026-12-31').expect(401);
  });
});
