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
import { DEFAULT_PAYTABLE } from '../src/keno/paytable';
import { hashServerSeed } from '../src/keno/provably-fair';
import { createTestDatabase } from './pglite-database';

class CapturingSms implements SmsSender {
  readonly codes = new Map<string, string>();

  async send(phone: string, message: string): Promise<void> {
    this.codes.set(phone, /\d{6}/.exec(message)![0]);
  }
}

const PASSWORD = 'motdepasse-solide';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('API (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  const sms = new CapturingSms();
  let seq = 0;

  beforeAll(async () => {
    db = createTestDatabase();
    await migrate(db);
    const config = loadConfig({ NODE_ENV: 'test', PAYMENTS_FAKE: 'true', WITHDRAWAL_APPROVAL_THRESHOLD_CENTS: '1000000' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
      .overrideProvider(DATABASE)
      .useValue(db)
      .overrideProvider(SMS_SENDER)
      .useValue(sms)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app, config);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  async function registerPlayer() {
    const phone = `+5093${7_000_000 + ++seq}`;
    await api().post('/api/v1/auth/otp').send({ phone, purpose: 'register' }).expect(204);
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ phone, otp: sms.codes.get(phone), password: PASSWORD, birthDate: '1990-05-12' })
      .expect(201);
    const me = await api().get('/api/v1/me').set(auth(res.body.accessToken)).expect(200);
    return { id: me.body.id as number, phone, token: res.body.accessToken as string, refreshToken: res.body.refreshToken as string };
  }

  async function deposit(token: string, amountCents: number) {
    const started = await api()
      .post('/api/v1/payments/deposits')
      .set(auth(token))
      .send({ provider: 'fake', amountCents, idempotencyKey: `depot-${++seq}-xyz` })
      .expect(201);
    const checked = await api().post(`/api/v1/payments/deposits/${started.body.id}/check`).set(auth(token)).expect(200);
    expect(checked.body.status).toBe('completed');
  }

  async function staffLogin(role: StaffRole) {
    const email = `${role}-${++seq}@paryajpaw.test`;
    const { totpSecret } = await createStaff(db, { email, role, password: PASSWORD });
    const code = totpAt(totpSecret, totpCounter());
    const res = await api().post('/api/v1/admin/auth/login').send({ email, password: PASSWORD, totp: code }).expect(200);
    return { token: res.body.accessToken as string, email, code };
  }

  const bet = (token: string, body: object) => api().post('/api/v1/keno/bets').set(auth(token)).send(body);
  const balance = async (token: string) =>
    (await api().get('/api/v1/wallet').set(auth(token)).expect(200)).body.balanceCents as number;

  describe('comptes', () => {
    it('refuse un joueur de moins de 18 ans et un code OTP faux', async () => {
      const phone = '+50948000001';
      await api().post('/api/v1/auth/otp').send({ phone, purpose: 'register' }).expect(204);
      const young = new Date();
      young.setFullYear(young.getFullYear() - 17);
      const underage = await api()
        .post('/api/v1/auth/register')
        .send({ phone, otp: sms.codes.get(phone), password: PASSWORD, birthDate: young.toISOString().slice(0, 10) })
        .expect(403);
      expect(underage.body.code).toBe('UNDERAGE');

      const wrong = sms.codes.get(phone) === '000000' ? '111111' : '000000';
      const invalid = await api()
        .post('/api/v1/auth/register')
        .send({ phone, otp: wrong, password: PASSWORD, birthDate: '1990-01-01' })
        .expect(400);
      expect(invalid.body.code).toBe('OTP_INVALID');
    });

    it('inscrit, connecte et fait tourner le jeton de rafraîchissement', async () => {
      const player = await registerPlayer();
      const me = await api().get('/api/v1/me').set(auth(player.token)).expect(200);
      expect(me.body).toMatchObject({ phone: player.phone, kycStatus: 'none', language: 'ht', status: 'active' });

      await api().post('/api/v1/auth/login').send({ phone: player.phone, password: PASSWORD }).expect(200);
      const bad = await api().post('/api/v1/auth/login').send({ phone: player.phone, password: 'mauvais-mdp' }).expect(401);
      expect(bad.body.code).toBe('INVALID_CREDENTIALS');

      const refreshed = await api().post('/api/v1/auth/refresh').send({ refreshToken: player.refreshToken }).expect(200);
      expect(refreshed.body.refreshToken).not.toBe(player.refreshToken);
      await api().post('/api/v1/auth/refresh').send({ refreshToken: player.refreshToken }).expect(401);
    });

    it('refuse un deuxième compte sur le même numéro', async () => {
      const player = await registerPlayer();
      const res = await api().post('/api/v1/auth/otp').send({ phone: player.phone, purpose: 'register' }).expect(409);
      expect(res.body.code).toBe('PHONE_ALREADY_REGISTERED');
    });
  });

  describe('keno', () => {
    it('publie la table de gains par défaut et son RTP', async () => {
      const res = await api().get('/api/v1/keno/config').expect(200);
      expect(res.body.paytable).toEqual(DEFAULT_PAYTABLE);
      expect(res.body.rtpPercent['1']).toBeCloseTo(92.5, 6);
    });

    it('débite la mise, crédite le gain et garde le solde égal à la somme du journal', async () => {
      const player = await registerPlayer();
      await deposit(player.token, 100_000);
      const numbers = [1, 7, 13, 22, 40, 41, 55, 60, 72, 80];
      let expected = 100_000;
      for (let i = 0; i < 20; i++) {
        const res = await bet(player.token, {
          picks: numbers.slice(0, (i % 10) + 1),
          stakeCents: 1000,
          idempotencyKey: `mise-${i}-abcdef`,
        }).expect(201);
        const b = res.body;
        expect(b.drawn).toHaveLength(20);
        expect(new Set(b.drawn).size).toBe(20);
        expect(b.hits).toBe(b.picks.filter((n: number) => b.drawn.includes(n)).length);
        expect(b.multiplier).toBe(DEFAULT_PAYTABLE[String(b.picks.length)][b.hits]);
        expected += b.payoutCents - 1000;
        expect(b.balanceCents).toBe(expected);
      }
      expect(await balance(player.token)).toBe(expected);
      const { rows } = await db.query<{ total: number }>(
        'SELECT sum(amount_cents)::bigint AS total FROM ledger_entries WHERE user_id = $1',
        [player.id],
      );
      expect(rows[0].total).toBe(expected);
    });

    it('rejoue une mise envoyée deux fois au lieu de la doubler', async () => {
      const player = await registerPlayer();
      await deposit(player.token, 10_000);
      const body = { picks: [5, 10, 15], stakeCents: 1000, idempotencyKey: 'meme-cle-0001' };
      const [first, second] = await Promise.all([bet(player.token, body), bet(player.token, body)]);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.betId).toBe(first.body.betId);
      expect(await balance(player.token)).toBe(10_000 - 1000 + first.body.payoutCents);
      const history = await api().get('/api/v1/keno/bets').set(auth(player.token)).expect(200);
      expect(history.body).toHaveLength(1);
    });

    it('refuse des numéros ou une mise invalides et un solde insuffisant', async () => {
      const player = await registerPlayer();
      await deposit(player.token, 1500);
      for (const picks of [[], [0], [81], [3, 3], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]]) {
        await bet(player.token, { picks, stakeCents: 1000, idempotencyKey: 'invalide-0001' }).expect(400);
      }
      const low = await bet(player.token, { picks: [1], stakeCents: 999, idempotencyKey: 'trop-bas-01' }).expect(400);
      expect(low.body).toMatchObject({ code: 'STAKE_OUT_OF_RANGE', minStakeCents: 1000 });
      const poor = await bet(player.token, { picks: [1], stakeCents: 2000, idempotencyKey: 'trop-cher-01' }).expect(400);
      expect(poor.body.code).toBe('INSUFFICIENT_FUNDS');
      expect(await balance(player.token)).toBe(1500);
    });

    it('permet de vérifier un tirage après la rotation des graines', async () => {
      const player = await registerPlayer();
      await deposit(player.token, 10_000);
      const seed = await api().get('/api/v1/keno/seeds').set(auth(player.token)).expect(200);
      const placed = (await bet(player.token, { picks: [1, 2, 3], stakeCents: 1000, idempotencyKey: 'verif-0001' }).expect(201)).body;
      expect(placed.serverSeedHash).toBe(seed.body.serverSeedHash);

      const rotated = await api()
        .post('/api/v1/keno/seeds/rotate')
        .set(auth(player.token))
        .send({ clientSeed: 'ma-graine' })
        .expect(200);
      const revealed = rotated.body.previous.serverSeed as string;
      expect(hashServerSeed(revealed)).toBe(placed.serverSeedHash);
      expect(rotated.body.current).toMatchObject({ clientSeed: 'ma-graine', nextNonce: 0 });

      const verified = await api()
        .post('/api/v1/keno/verify')
        .send({ serverSeed: revealed, clientSeed: placed.clientSeed, nonce: placed.nonce })
        .expect(200);
      expect(verified.body.drawn).toEqual(placed.drawn);
    });

    it("joue en mode automatique jusqu'à la perte fixée", async () => {
      const player = await registerPlayer();
      await deposit(player.token, 200_000);
      const res = await api()
        .post('/api/v1/keno/autoplay')
        .set(auth(player.token))
        .send({ picks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], stakeCents: 1000, rounds: 100, stopOnLossCents: 3000, idempotencyKey: 'auto-0001' })
        .expect(201);
      const { bets, netCents, stoppedBy } = res.body as {
        bets: { stakeCents: number; payoutCents: number }[];
        netCents: number;
        stoppedBy: string;
      };
      expect(netCents).toBe(bets.reduce((sum, b) => sum + b.payoutCents - b.stakeCents, 0));
      expect(['loss', 'rounds']).toContain(stoppedBy);
      if (stoppedBy === 'loss') {
        expect(-netCents).toBeGreaterThanOrEqual(3000);
        const last = bets[bets.length - 1];
        expect(-(netCents - (last.payoutCents - last.stakeCents))).toBeLessThan(3000);
      } else {
        expect(bets).toHaveLength(100);
      }
      expect(await balance(player.token)).toBe(200_000 + netCents);
    });

    it("applique la limite de perte et l'auto-exclusion", async () => {
      const player = await registerPlayer();
      await deposit(player.token, 10_000);
      await api()
        .put('/api/v1/me/limits')
        .set(auth(player.token))
        .send({ dailyLossLimitCents: 900, dailyDepositLimitCents: null })
        .expect(200);
      const limited = await bet(player.token, { picks: [1], stakeCents: 1000, idempotencyKey: 'limite-0001' }).expect(403);
      expect(limited.body.code).toBe('LOSS_LIMIT_REACHED');

      await api()
        .put('/api/v1/me/limits')
        .set(auth(player.token))
        .send({ dailyLossLimitCents: null, dailyDepositLimitCents: null })
        .expect(200);
      await api().post('/api/v1/me/self-exclusion').set(auth(player.token)).send({ days: 7 }).expect(200);
      const excluded = await bet(player.token, { picks: [1], stakeCents: 1000, idempotencyKey: 'exclu-0001' }).expect(403);
      expect(excluded.body.code).toBe('SELF_EXCLUDED');
      const noDeposit = await api()
        .post('/api/v1/payments/deposits')
        .set(auth(player.token))
        .send({ provider: 'fake', amountCents: 1000, idempotencyKey: 'depot-exclu-01' })
        .expect(403);
      expect(noDeposit.body.code).toBe('SELF_EXCLUDED');
    });
  });

  describe('paiements et back-office', () => {
    it('exige le KYC puis traite les retraits selon le seuil de validation', async () => {
      const player = await registerPlayer();
      await deposit(player.token, 3_000_000);
      const withdraw = (amountCents: number, idempotencyKey: string) =>
        api().post('/api/v1/payments/withdrawals').set(auth(player.token)).send({ provider: 'fake', amountCents, idempotencyKey });

      expect((await withdraw(10_000, 'retrait-0001').expect(403)).body.code).toBe('KYC_REQUIRED');

      const support = await staffLogin('support');
      await api()
        .patch(`/api/v1/admin/players/${player.id}`)
        .set(auth(support.token))
        .send({ kycStatus: 'verified' })
        .expect(200);

      expect((await withdraw(10_000, 'retrait-0002').expect(201)).body.status).toBe('completed');
      const big = await withdraw(1_500_000, 'retrait-0003').expect(201);
      expect(big.body.status).toBe('awaiting_approval');
      const other = await withdraw(1_200_000, 'retrait-0004').expect(201);
      expect(await balance(player.token)).toBe(3_000_000 - 10_000 - 1_500_000 - 1_200_000);

      await api().post(`/api/v1/admin/withdrawals/${big.body.id}/approve`).set(auth(support.token)).expect(403);

      const finance = await staffLogin('finance');
      const queue = await api().get('/api/v1/admin/withdrawals').set(auth(finance.token)).expect(200);
      expect(queue.body.map((p: { id: number }) => p.id)).toEqual(expect.arrayContaining([big.body.id, other.body.id]));
      const approved = await api().post(`/api/v1/admin/withdrawals/${big.body.id}/approve`).set(auth(finance.token)).expect(200);
      expect(approved.body.status).toBe('completed');
      await api()
        .post(`/api/v1/admin/withdrawals/${other.body.id}/reject`)
        .set(auth(finance.token))
        .send({ reason: 'pièce illisible' })
        .expect(200);
      await api().post(`/api/v1/admin/withdrawals/${other.body.id}/approve`).set(auth(finance.token)).expect(409);

      expect(await balance(player.token)).toBe(3_000_000 - 10_000 - 1_500_000);
      const { rows } = await db.query<{ action: string }>('SELECT action FROM audit_log');
      expect(rows.map((r) => r.action)).toEqual(
        expect.arrayContaining(['player.update', 'withdrawal.approve', 'withdrawal.reject']),
      );
    });

    it('refuse un code TOTP déjà utilisé', async () => {
      const staff = await staffLogin('auditor');
      const replay = await api()
        .post('/api/v1/admin/auth/login')
        .send({ email: staff.email, password: PASSWORD, totp: staff.code })
        .expect(401);
      expect(replay.body.code).toBe('INVALID_TOTP');
    });

    it('réserve les paramètres au super-admin et refuse un RTP hors plage', async () => {
      const auditor = await staffLogin('auditor');
      const admin = await staffLogin('super_admin');
      const current = (await api().get('/api/v1/admin/settings').set(auth(auditor.token)).expect(200)).body.current;
      const input = {
        minStakeCents: current.minStakeCents,
        maxStakeCents: current.maxStakeCents,
        maxPicks: current.maxPicks,
        maxPayoutCents: current.maxPayoutCents,
        paytable: current.paytable,
      };

      await api().put('/api/v1/admin/settings').set(auth(auditor.token)).send(input).expect(403);
      const invalid = await api()
        .put('/api/v1/admin/settings')
        .set(auth(admin.token))
        .send({ ...input, paytable: { ...input.paytable, '1': [0, 3] } })
        .expect(400);
      expect(invalid.body.code).toBe('INVALID_SETTINGS');

      const updated = await api()
        .put('/api/v1/admin/settings')
        .set(auth(admin.token))
        .send({ ...input, minStakeCents: 500 })
        .expect(200);
      expect(updated.body).toMatchObject({ version: current.version + 1, minStakeCents: 500 });
      expect((await api().get('/api/v1/keno/config').expect(200)).body.minStakeCents).toBe(500);
    });

    it('produit le tableau de bord du jour et les exports CSV', async () => {
      const auditor = await staffLogin('auditor');
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Port-au-Prince' });
      const dashboard = await api()
        .get(`/api/v1/admin/dashboard?from=${today}&to=${today}`)
        .set(auth(auditor.token))
        .expect(200);
      expect(dashboard.body).toHaveLength(1);
      const day = dashboard.body[0];
      expect(day.bets).toBeGreaterThan(0);
      expect(day.ggrCents).toBe(day.stakesCents - day.payoutsCents);

      const csv = await api()
        .get(`/api/v1/admin/exports/bets?from=${today}&to=${today}`)
        .set(auth(auditor.token))
        .expect(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.text.split('\n')[0]).toBe(
        'id,user_id,created_at,picks,drawn,hits,stake_cents,multiplier,payout_cents,seed_id,nonce,settings_version',
      );

      const support = await staffLogin('support');
      await api().get(`/api/v1/admin/exports/bets?from=${today}&to=${today}`).set(auth(support.token)).expect(403);
    });

    it('interdit de modifier le journal, les mises et les paramètres passés', async () => {
      await expect(db.query('UPDATE ledger_entries SET amount_cents = 1')).rejects.toThrow(/append-only/);
      await expect(db.query('DELETE FROM keno_bets')).rejects.toThrow(/append-only/);
      await expect(db.query('UPDATE game_settings SET min_stake_cents = 1')).rejects.toThrow(/append-only/);
    });
  });
});
