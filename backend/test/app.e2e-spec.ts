import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createStaff } from '../src/admin/staff';
import { totpAt, totpCounter } from '../src/admin/totp';
import { AppModule, configureApp } from '../src/app.module';
import { SMS_SENDER, SmsSender } from '../src/auth/sms';
import { StaffRole } from '../src/common/auth';
import { CLOCK } from '../src/common/clock';
import { loadConfig } from '../src/config';
import { DATABASE, Database } from '../src/database/db';
import { migrate } from '../src/database/migrate';
import { DrawEventsService } from '../src/draws/events.service';
import { DEFAULT_LUCKY_SIX_CONFIG, DEFAULT_LUCKY_TEN_CONFIG } from '../src/draws/games';
import { DrawScheduler } from '../src/draws/scheduler.service';
import { hashServerSeed } from '../src/fairness/provably-fair';
import { DEFAULT_PAYTABLE, hitProbability } from '../src/keno/paytable';
import { createTestDatabase } from './pglite-database';

class CapturingSms implements SmsSender {
  readonly codes = new Map<string, string>();

  async send(phone: string, message: string): Promise<void> {
    this.codes.set(phone, /\d{6}/.exec(message)![0]);
  }
}

const PASSWORD = 'motdepasse-solide';

/** Horloge des tirages programmés, avancée à la main par les tests. */
const clock = { current: Date.now(), now: () => new Date(clock.current) };
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
      .overrideProvider(CLOCK)
      .useValue(clock)
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

  describe('roulette américaine', () => {
    type SpinBet = { type: string; numbers: number[]; amountCents: number; returnCents: number };
    const spin = (token: string, body: object) => api().post('/api/v1/american-roulette/spins').set(auth(token)).send(body);
    /** Gain attendu, calculé sans le moteur : 36 / cases couvertes si la mise gagne, 7 fois la mise pour la top line. */
    const expectedReturn = (bet: SpinBet, number: number) =>
      bet.numbers.includes(number) ? bet.amountCents * (bet.type === 'top_line' ? 7 : 36 / bet.numbers.length) : 0;

    it('publie une roue de 38 cases, la top line et un RTP de 94,74 %', async () => {
      const res = await api().get('/api/v1/american-roulette/config').expect(200);
      expect(res.body.wheel).toHaveLength(38);
      expect(res.body.wheel.find((p: { number: number }) => p.number === 37)).toEqual({ number: 37, label: '00', color: 'green' });
      expect(res.body).toMatchObject({ topLineEnabled: true, payouts: { straight: 35, split: 17, top_line: 6, dozen: 2, red: 1 } });
      expect(res.body.rtpPercent.straight).toBeCloseTo(94.737, 3);
      expect(res.body.rtpPercent.top_line).toBeCloseTo(92.105, 3);
      expect(res.body).not.toHaveProperty('laPartage');
    });

    it('n’expose plus la roulette européenne', async () => {
      await api().get('/api/v1/roulette/config').expect(404);
      await api().get('/api/v1/admin/roulette/european/settings').expect(404);
    });

    it('débite toutes les mises, paie le 00, la top line et les extérieures, et garde le solde égal au journal', async () => {
      const player = await registerPlayer();
      await deposit(player.token, 500_000);
      let expected = 500_000;
      for (let i = 0; i < 10; i++) {
        const s = (
          await spin(player.token, {
            bets: [
              { type: 'straight', numbers: [37], amountCents: 1000 },
              { type: 'split', numbers: [0, 37], amountCents: 1000 },
              { type: 'top_line', numbers: [0, 37, 1, 2, 3], amountCents: 1000 },
              { type: 'black', amountCents: 2000 },
              { type: 'dozen', index: 2, amountCents: 1000 },
            ],
            idempotencyKey: `us-tour-${i}-abcdef`,
          }).expect(201)
        ).body;
        expect(s.totalStakeCents).toBe(6000);
        expect(s.label).toBe(s.number === 37 ? '00' : String(s.number));
        for (const bet of s.bets as SpinBet[]) expect(bet.returnCents).toBe(expectedReturn(bet, s.number));
        expect(s.totalPayoutCents).toBe((s.bets as SpinBet[]).reduce((sum, b) => sum + expectedReturn(b, s.number), 0));
        expected += s.netCents;
        expect(s.balanceCents).toBe(expected);
      }
      const { rows } = await db.query<{ total: number }>(
        'SELECT sum(amount_cents)::bigint AS total FROM ledger_entries WHERE user_id = $1',
        [player.id],
      );
      expect(rows[0].total).toBe(expected);
      const stats = (await api().get('/api/v1/american-roulette/stats').set(auth(player.token)).expect(200)).body;
      expect(stats.spins).toBe(10);
      expect(stats.colors.red + stats.colors.black + stats.colors.green).toBe(10);
      expect(stats.frequencies).toHaveLength(38);
      expect((await api().get('/api/v1/american-roulette/spins').set(auth(player.token)).expect(200)).body).toHaveLength(10);
    });

    it('rejoue un tour envoyé deux fois au lieu de le doubler', async () => {
      const player = await registerPlayer();
      await deposit(player.token, 10_000);
      const body = { bets: [{ type: 'odd', amountCents: 2000 }], idempotencyKey: 'meme-tour-0001' };
      const [first, second] = await Promise.all([spin(player.token, body), spin(player.token, body)]);
      expect(first.status).toBe(201);
      expect(second.body.spinId).toBe(first.body.spinId);
      expect(await balance(player.token)).toBe(10_000 + first.body.netCents);
      expect((await api().get('/api/v1/american-roulette/spins').set(auth(player.token)).expect(200)).body).toHaveLength(1);
    });

    it('refuse une position inexistante, une mise hors limites et un total trop élevé', async () => {
      const player = await registerPlayer();
      await deposit(player.token, 100_000);
      const code = async (bets: object[]) =>
        (await spin(player.token, { bets, idempotencyKey: 'refus-0001' }).expect(400)).body.code;

      expect(await code([{ type: 'split', numbers: [1, 5], amountCents: 1000 }])).toBe('INVALID_BET');
      expect(await code([{ type: 'corner', numbers: [0, 1, 2, 3], amountCents: 1000 }])).toBe('INVALID_BET');
      expect(await code([{ type: 'orphelins', amountCents: 1000 }])).toBe('VALIDATION_ERROR');
      expect(await code([{ type: 'straight', numbers: [5], amountCents: 999 }])).toBe('BET_OUT_OF_RANGE');
      expect(
        await code([
          { type: 'straight', numbers: [5], amountCents: 30000 },
          { type: 'straight', numbers: [5], amountCents: 30000 },
        ]),
      ).toBe('BET_OUT_OF_RANGE');
      expect(await code(['red', 'black', 'even', 'odd'].map((type) => ({ type, amountCents: 1_500_000 })))).toBe('TOTAL_STAKE_TOO_HIGH');
      expect(await code([{ type: 'high', amountCents: 200_000 }])).toBe('INSUFFICIENT_FUNDS');
      expect(await balance(player.token)).toBe(100_000);
    });

    it('permet de vérifier un tour après la rotation des graines, séparées de celles du Keno', async () => {
      const player = await registerPlayer();
      await deposit(player.token, 10_000);
      const kenoSeed = (await api().get('/api/v1/keno/seeds').set(auth(player.token)).expect(200)).body;
      const rouletteSeed = (await api().get('/api/v1/american-roulette/seeds').set(auth(player.token)).expect(200)).body;
      expect(rouletteSeed.serverSeedHash).not.toBe(kenoSeed.serverSeedHash);

      const played = (await spin(player.token, { bets: [{ type: 'low', amountCents: 1000 }], idempotencyKey: 'verif-tour-01' }).expect(201)).body;
      expect(played.serverSeedHash).toBe(rouletteSeed.serverSeedHash);
      const rotated = await api().post('/api/v1/american-roulette/seeds/rotate').set(auth(player.token)).send({}).expect(200);
      expect(hashServerSeed(rotated.body.previous.serverSeed)).toBe(played.serverSeedHash);

      const verified = await api()
        .post('/api/v1/american-roulette/verify')
        .send({ serverSeed: rotated.body.previous.serverSeed, clientSeed: played.clientSeed, nonce: played.nonce })
        .expect(200);
      expect(verified.body).toMatchObject({ number: played.number, label: played.label, color: played.color });
    });

    it('joue en mode automatique et applique la limite de perte commune aux jeux', async () => {
      const player = await registerPlayer();
      await deposit(player.token, 100_000);
      const res = await api()
        .post('/api/v1/american-roulette/autoplay')
        .set(auth(player.token))
        .send({ bets: [{ type: 'red', amountCents: 1000 }], rounds: 20, stopOnLossCents: 3000, idempotencyKey: 'auto-tour-01' })
        .expect(201);
      const { spins, netCents } = res.body as { spins: { netCents: number }[]; netCents: number };
      expect(netCents).toBe(spins.reduce((sum, s) => sum + s.netCents, 0));
      expect(await balance(player.token)).toBe(100_000 + netCents);

      // Perte du jour = −netCents ; la mise suivante doit la faire passer au-dessus de la limite, gain ou perte.
      const limit = 500 + Math.max(0, -netCents);
      const stakeCents = Math.max(1000, netCents + 1000);
      await api()
        .put('/api/v1/me/limits')
        .set(auth(player.token))
        .send({ dailyLossLimitCents: limit, dailyDepositLimitCents: null })
        .expect(200);
      const limited = await spin(player.token, { bets: [{ type: 'red', amountCents: stakeCents }], idempotencyKey: 'limite-tour-01' }).expect(403);
      expect(limited.body.code).toBe('LOSS_LIMIT_REACHED');
      const keno = await bet(player.token, { picks: [1], stakeCents, idempotencyKey: 'limite-keno-01' }).expect(403);
      expect(keno.body.code).toBe('LOSS_LIMIT_REACHED');
    });

    it('signale au back-office les tours qui couvrent les 38 cases', async () => {
      const player = await registerPlayer();
      await deposit(player.token, 10_000);
      const covering = (
        await spin(player.token, {
          bets: [
            { type: 'red', amountCents: 1000 },
            { type: 'black', amountCents: 1000 },
            { type: 'split', numbers: [0, 37], amountCents: 1000 },
          ],
          idempotencyKey: 'tout-le-tapis-01',
        }).expect(201)
      ).body;

      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Port-au-Prince' });
      const finance = await staffLogin('finance');
      const alerts = await api().get(`/api/v1/admin/roulette/alerts?from=${today}&to=${today}`).set(auth(finance.token)).expect(200);
      expect(alerts.body).toEqual(
        expect.arrayContaining([expect.objectContaining({ spinId: covering.spinId, userId: player.id, totalStakeCents: 3000 })]),
      );
      const support = await staffLogin('support');
      await api().get(`/api/v1/admin/roulette/alerts?from=${today}&to=${today}`).set(auth(support.token)).expect(403);
    });

    it('laisse le super-admin régler la table et retirer la top line', async () => {
      const player = await registerPlayer();
      await deposit(player.token, 50_000);
      const admin = await staffLogin('super_admin');
      const current = (await api().get('/api/v1/admin/roulette/settings').set(auth(admin.token)).expect(200)).body.current;
      const input = {
        chipValuesCents: current.chipValuesCents,
        betLimits: current.betLimits,
        maxTotalStakeCents: current.maxTotalStakeCents,
        maxPayoutCents: current.maxPayoutCents,
        topLineEnabled: false,
      };
      const finance = await staffLogin('finance');
      await api().put('/api/v1/admin/roulette/settings').set(auth(finance.token)).send(input).expect(403);
      const invalid = await api()
        .put('/api/v1/admin/roulette/settings')
        .set(auth(admin.token))
        .send({ ...input, chipValuesCents: [5000, 1000] })
        .expect(400);
      expect(invalid.body.code).toBe('INVALID_SETTINGS');

      const updated = await api().put('/api/v1/admin/roulette/settings').set(auth(admin.token)).send(input).expect(200);
      expect(updated.body.version).toBeGreaterThan(current.version);
      const topLine = await spin(player.token, { bets: [{ type: 'top_line', numbers: [0, 1, 2, 3, 37], amountCents: 1000 }], idempotencyKey: 'top-line-off' }).expect(400);
      expect(topLine.body.code).toBe('BET_NOT_AVAILABLE');
      expect((await api().get('/api/v1/american-roulette/config').expect(200)).body.payouts.top_line).toBeUndefined();
      await api().put('/api/v1/admin/roulette/settings').set(auth(admin.token)).send({ ...input, topLineEnabled: true }).expect(200);
      expect(await balance(player.token)).toBe(50_000);
    });
  });

  describe('Keno jusqu’à 15 numéros', () => {
    /** Ligne de table calibrée à 92,5 % : rien sous 5 numéros trouvés, puis un coefficient qui double à chaque numéro. */
    const row = (picks: number) => {
      const shape = Array.from({ length: picks + 1 }, (_, h) => (h >= 5 ? 2 ** (h - 5) : 0));
      const rtp = shape.reduce((s, m, h) => s + m * hitProbability(picks, h), 0);
      return shape.map((m) => Math.round(((m * 0.925) / rtp) * 100) / 100);
    };

    it('accepte 12 numéros une fois le plafond et la table étendus par le super-admin', async () => {
      const admin = await staffLogin('super_admin');
      const current = (await api().get('/api/v1/admin/keno/settings').set(auth(admin.token)).expect(200)).body.current;
      await api()
        .put('/api/v1/admin/keno/settings')
        .set(auth(admin.token))
        .send({
          minStakeCents: current.minStakeCents,
          maxStakeCents: current.maxStakeCents,
          maxPicks: 12,
          maxPayoutCents: current.maxPayoutCents,
          paytable: { ...current.paytable, '11': row(11), '12': row(12) },
        })
        .expect(200);

      const player = await registerPlayer();
      await deposit(player.token, 10_000);
      const twelve = Array.from({ length: 12 }, (_, i) => i * 6 + 1);
      const placed = await bet(player.token, { picks: twelve, stakeCents: 1000, idempotencyKey: 'douze-0001' }).expect(201);
      expect(placed.body.picks).toHaveLength(12);
      const thirteen = await bet(player.token, { picks: [...twelve, 80], stakeCents: 1000, idempotencyKey: 'treize-001' }).expect(400);
      expect(thirteen.body).toMatchObject({ code: 'INVALID_PICKS', maxPicks: 12 });
    });
  });

  describe('tirages programmés (Lucky Six, Lucky 10)', () => {
    type Entry = { drawId: number; scheduledAt: string; status: string; payoutCents: number; balls: number[] | null };
    const buy = (token: string, body: object) => api().post('/api/v1/tickets').set(auth(token)).send(body);
    const scheduler = () => app.get(DrawScheduler);
    /** Avance l'horloge à `at` puis lance un cycle du planificateur. */
    const runAt = async (at: number) => {
      clock.current = at;
      await scheduler().tick();
    };
    const ticket = async (token: string, code: string) =>
      (await api().get(`/api/v1/tickets/${code}`).set(auth(token)).expect(200)).body;

    it('publie les règles chiffrées et le prochain tirage de chaque jeu dans le lobby', async () => {
      const six = (await api().get('/api/v1/draws/lucky_six/config').expect(200)).body;
      expect(six).toMatchObject({ balls: 48, drawn: 35, positionCoefficients: DEFAULT_LUCKY_SIX_CONFIG.positionCoefficients });
      expect(six.rtpPercent.six).toBeCloseTo(92.521, 3);
      expect(six.colors.red).toEqual([1, 9, 17, 25, 33, 41]);
      const ten = (await api().get('/api/v1/draws/lucky_ten/config').expect(200)).body;
      expect(ten.paytable).toEqual(DEFAULT_LUCKY_TEN_CONFIG.paytable);

      const lobby = (await api().get('/api/v1/lobby').expect(200)).body;
      expect(lobby.games.map((g: { game: string }) => g.game)).toEqual(['american_roulette', 'keno', 'lucky_six', 'lucky_ten']);
      const next = lobby.games.find((g: { game: string }) => g.game === 'lucky_six').nextDraw;
      expect(Date.parse(next.closesAt)).toBeGreaterThan(clock.current);
      expect(Date.parse(next.scheduledAt) % 300_000).toBe(0);
      expect(next.serverSeedHash).toHaveLength(64);
    });

    it('vend un ticket sur plusieurs tirages, le règle au tirage et publie un résultat vérifiable', async () => {
      const player = await registerPlayer();
      await deposit(player.token, 50_000);
      const numbers = [3, 8, 15, 22, 40, 47];
      const six = (await buy(player.token, { game: 'lucky_six', bet: { type: 'six', numbers }, stakeCents: 1000, draws: 3, idempotencyKey: 'six-3-tirages' }).expect(201)).body;
      expect(six).toMatchObject({ game: 'lucky_six', totalStakeCents: 3000, status: 'pending' });
      expect(six.code).toMatch(/^[2-9A-HJ-NP-Z]{10}$/);
      const slots = (six.entries as Entry[]).map((e) => Date.parse(e.scheduledAt));
      expect(slots[1] - slots[0]).toBe(300_000);
      expect(slots[2] - slots[1]).toBe(300_000);

      const even = (await buy(player.token, { game: 'lucky_six', bet: { type: 'first_even' }, stakeCents: 1000, draws: 1, idempotencyKey: 'six-pair-0001' }).expect(201)).body;
      const odd = (await buy(player.token, { game: 'lucky_six', bet: { type: 'first_odd' }, stakeCents: 1000, draws: 1, idempotencyKey: 'six-impair-01' }).expect(201)).body;
      expect(await balance(player.token)).toBe(50_000 - 5000);

      const events: { type: string; data: { drawId: number } }[] = [];
      const subscription = app.get(DrawEventsService).stream().subscribe((e) => events.push(e as never));
      await runAt(slots[0] + 1000);
      subscription.unsubscribe();

      const draw = (await api().get(`/api/v1/draws/lucky_six/results?drawId=${(six.entries as Entry[])[0].drawId}`).expect(200)).body[0];
      expect(draw.status).toBe('settled');
      expect(draw.balls).toHaveLength(35);
      expect(hashServerSeed(draw.serverSeed)).toBe(draw.serverSeedHash);
      const verified = await api().post('/api/v1/draws/verify').send({ game: 'lucky_six', drawId: draw.id, serverSeed: draw.serverSeed }).expect(200);
      expect(verified.body.balls).toEqual(draw.balls);
      expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'draw.result', data: expect.objectContaining({ drawId: draw.id }) })]));

      // Gain attendu, calculé sans le moteur : position de la boule qui complète les 6 numéros.
      const positions = numbers.map((n) => draw.balls.indexOf(n));
      const coefficient = positions.includes(-1) ? 0 : DEFAULT_LUCKY_SIX_CONFIG.positionCoefficients[Math.max(...positions) + 1 - 6];
      const sixAfter = await ticket(player.token, six.code);
      expect(sixAfter.entries[0]).toMatchObject({ status: coefficient > 0 ? 'won' : 'lost', payoutCents: Math.floor(1000 * coefficient) });
      expect(sixAfter.entries[1].status).toBe('pending');
      expect(sixAfter.status).toBe('pending');

      const firstIsEven = draw.balls[0] % 2 === 0;
      expect((await ticket(player.token, even.code)).status).toBe(firstIsEven ? 'won' : 'lost');
      expect((await ticket(player.token, odd.code)).status).toBe(firstIsEven ? 'lost' : 'won');
      expect(await balance(player.token)).toBe(50_000 - 5000 + 1850 + Math.floor(1000 * coefficient));

      const list = (await api().get('/api/v1/tickets?game=lucky_six').set(auth(player.token)).expect(200)).body;
      expect(list.map((t: { code: string }) => t.code)).toEqual([odd.code, even.code, six.code]);
    });

    it('rend le même ticket quand la demande est renvoyée, refuse les paris et mises invalides', async () => {
      const player = await registerPlayer();
      await deposit(player.token, 20_000);
      const body = { game: 'lucky_ten', bet: { type: 'numbers', numbers: [7, 77, 40] }, stakeCents: 500, draws: 4, idempotencyKey: 'dix-meme-cle' };
      const [first, second] = await Promise.all([buy(player.token, body), buy(player.token, body)]);
      expect(first.status).toBe(201);
      expect(second.body.code).toBe(first.body.code);
      expect(first.body.bet.numbers).toEqual([7, 40, 77]);
      expect(await balance(player.token)).toBe(20_000 - 2000);

      const code = async (patch: object, status = 400) =>
        (await buy(player.token, { ...body, idempotencyKey: 'dix-refus-001', ...patch }).expect(status)).body.code;
      expect(await code({ draws: 21 })).toBe('INVALID_DRAW_COUNT');
      expect(await code({ stakeCents: 50 })).toBe('STAKE_OUT_OF_RANGE');
      expect(await code({ bet: { type: 'six', numbers: [1, 2, 3, 4, 5, 6] } })).toBe('INVALID_BET');
      expect(await code({ bet: { type: 'first_color', color: 'pink' } })).toBe('VALIDATION_ERROR');
      expect(await code({ stakeCents: 100_000, draws: 20 })).toBe('INSUFFICIENT_FUNDS');
    });

    it('annule un tirage manqué (serveur arrêté) et rembourse les mises', async () => {
      const player = await registerPlayer();
      await deposit(player.token, 10_000);
      const t = (await buy(player.token, { game: 'lucky_ten', bet: { type: 'more_even' }, stakeCents: 1000, draws: 1, idempotencyKey: 'dix-manque-01' }).expect(201)).body;
      expect(await balance(player.token)).toBe(9000);
      await runAt(Date.parse(t.entries[0].scheduledAt) + 2 * 60_000);

      const after = await ticket(player.token, t.code);
      expect(after).toMatchObject({ status: 'refunded' });
      const draw = (await api().get(`/api/v1/draws/lucky_ten/${t.entries[0].drawId}`).expect(200)).body;
      expect(draw).toMatchObject({ status: 'cancelled', cancelReason: 'missed', balls: null, serverSeed: null });
      expect(await balance(player.token)).toBe(10_000);
    });

    it('met les gros gains en revue jusqu’à la décision de la finance', async () => {
      const admin = await staffLogin('super_admin');
      const settings = (await api().get('/api/v1/admin/draws/lucky_six/settings').set(auth(admin.token)).expect(200)).body.current;
      await api()
        .put('/api/v1/admin/draws/lucky_six/settings')
        .set(auth(admin.token))
        .send({ config: { ...settings.config, reviewThresholdCents: 100 } })
        .expect(200);

      const player = await registerPlayer();
      await deposit(player.token, 10_000);
      const low = (await buy(player.token, { game: 'lucky_six', bet: { type: 'first_low' }, stakeCents: 1000, draws: 2, idempotencyKey: 'revue-bas-01' }).expect(201)).body;
      const high = (await buy(player.token, { game: 'lucky_six', bet: { type: 'first_high' }, stakeCents: 1000, draws: 2, idempotencyKey: 'revue-haut-1' }).expect(201)).body;
      const [first, second] = (low.entries as Entry[]).map((e) => Date.parse(e.scheduledAt));
      await runAt(first + 1000);
      await runAt(second + 1000);
      expect(await balance(player.token)).toBe(10_000 - 4000);

      const finance = await staffLogin('finance');
      const reviews = (await api().get('/api/v1/admin/draws/reviews').set(auth(finance.token)).expect(200)).body as { entryId: number; userId: number; payoutCents: number }[];
      const mine = reviews.filter((r) => r.userId === player.id);
      expect(mine).toHaveLength(2);
      expect(mine.every((r) => r.payoutCents === 1850)).toBe(true);

      const support = await staffLogin('support');
      await api().post(`/api/v1/admin/draws/reviews/${mine[0].entryId}/approve`).set(auth(support.token)).expect(403);
      await api().post(`/api/v1/admin/draws/reviews/${mine[0].entryId}/approve`).set(auth(finance.token)).expect(200);
      await api().post(`/api/v1/admin/draws/reviews/${mine[1].entryId}/reject`).set(auth(finance.token)).send({ reason: 'contrôle' }).expect(200);
      await api().post(`/api/v1/admin/draws/reviews/${mine[1].entryId}/approve`).set(auth(finance.token)).expect(409);
      expect(await balance(player.token)).toBe(10_000 - 4000 + 1850 + 1000);
      expect([(await ticket(player.token, low.code)).status, (await ticket(player.token, high.code)).status]).toContain('won');

      await api()
        .put('/api/v1/admin/draws/lucky_six/settings')
        .set(auth(admin.token))
        .send({ config: { ...settings.config, positionCoefficients: [10000, 7500, 5000, 2500, 1000, 500, 300, 200, 150, 100, 90, 80, 70, 60, 50, 40, 30, 25, 20, 15, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1] } })
        .expect(400);
      await api().put('/api/v1/admin/draws/lucky_six/settings').set(auth(admin.token)).send({ config: settings.config }).expect(200);
    });

    it('laisse le super-admin annuler un tirage à venir, mises rendues', async () => {
      const player = await registerPlayer();
      await deposit(player.token, 5000);
      const t = (await buy(player.token, { game: 'lucky_ten', bet: { type: 'first_color', color: 'blue' }, stakeCents: 2000, draws: 1, idempotencyKey: 'dix-annule-01' }).expect(201)).body;
      const finance = await staffLogin('finance');
      const admin = await staffLogin('super_admin');
      const drawId = t.entries[0].drawId;
      await api().post(`/api/v1/admin/draws/${drawId}/cancel`).set(auth(finance.token)).send({ reason: 'panne' }).expect(403);
      await api().post(`/api/v1/admin/draws/${drawId}/cancel`).set(auth(admin.token)).send({ reason: 'panne' }).expect(204);
      await api().post(`/api/v1/admin/draws/${drawId}/cancel`).set(auth(admin.token)).send({ reason: 'panne' }).expect(409);
      expect((await ticket(player.token, t.code)).status).toBe('refunded');
      expect(await balance(player.token)).toBe(5000);
    });

    it('interdit de modifier la graine ou le résultat d’un tirage', async () => {
      const { rows } = await db.query<{ id: number }>(`SELECT id FROM draws WHERE status = 'settled' LIMIT 1`);
      await expect(db.query(`UPDATE draws SET balls = '{1}' WHERE id = $1`, [rows[0].id])).rejects.toThrow(/sealed/);
      await expect(db.query(`UPDATE draws SET server_seed = 'x' WHERE status = 'scheduled'`)).rejects.toThrow(/sealed/);
      await expect(db.query('DELETE FROM draws')).rejects.toThrow(/append-only/);
      await expect(db.query('DELETE FROM tickets')).rejects.toThrow(/append-only/);
    });
  });

  describe('points de vente (agents)', () => {
    type Entry = { scheduledAt: string; drawId: number };
    const runAt = async (at: number) => {
      clock.current = at;
      await app.get(DrawScheduler).tick();
    };
    const agentBalance = async (token: string) =>
      (await api().get('/api/v1/agent/me').set(auth(token)).expect(200)).body.balanceCents as number;
    const sell = (token: string, body: object) =>
      api().post('/api/v1/agent/tickets').set(auth(token)).send({ customerIsAdult: true, ...body });
    const redeem = (token: string, code: string) => api().post(`/api/v1/agent/tickets/${code}/redeem`).set(auth(token));

    async function createAgent(overrides: object = {}) {
      const admin = await staffLogin('super_admin');
      const phone = `+5094${6_000_000 + ++seq}`;
      const agent = (
        await api()
          .post('/api/v1/admin/agents')
          .set(auth(admin.token))
          .send({ name: 'Boutik Jacmel', phone, password: PASSWORD, location: 'Jacmel', ticketCommissionBp: 500, depositCommissionBp: 100, creditLimitCents: 0, ...overrides })
          .expect(201)
      ).body;
      const login = await api().post('/api/v1/agent/auth/login').send({ phone, password: PASSWORD }).expect(200);
      return { ...agent, phone, token: login.body.accessToken as string, adminToken: admin.token };
    }

    async function topUp(agentId: number, amountCents: number) {
      const finance = await staffLogin('finance');
      await api()
        .post(`/api/v1/admin/agents/${agentId}/float`)
        .set(auth(finance.token))
        .send({ direction: 'topup', amountCents, reference: 'reçu de versement' })
        .expect(200);
    }

    it('réserve la création des agents au super-admin et leur donne un code PV', async () => {
      const support = await staffLogin('support');
      await api()
        .post('/api/v1/admin/agents')
        .set(auth(support.token))
        .send({ name: 'X', phone: '+50946999999', password: PASSWORD, ticketCommissionBp: 500, depositCommissionBp: 100, creditLimitCents: 0 })
        .expect(403);
      const agent = await createAgent();
      expect(agent.code).toMatch(/^PV\d{4}$/);
      expect(agent).toMatchObject({ status: 'active', balanceCents: 0, ticketCommissionBp: 500 });
      await api().post('/api/v1/agent/auth/login').send({ phone: agent.phone, password: 'mauvais-mdp' }).expect(401);
    });

    it('vend sur le crédit, verse la commission au règlement et paie le gagnant au guichet une seule fois', async () => {
      const agent = await createAgent();
      await topUp(agent.id, 50_000);
      expect(await agentBalance(agent.token)).toBe(50_000);

      const evenBody = { game: 'lucky_six', bet: { type: 'first_even' }, stakeCents: 1000, draws: 2, idempotencyKey: 'pv-pair-0001' };
      const noAttestation = await api().post('/api/v1/agent/tickets').set(auth(agent.token)).send(evenBody).expect(400);
      expect(noAttestation.body.code).toBe('VALIDATION_ERROR');
      const even = (await sell(agent.token, evenBody).expect(201)).body;
      const odd = (await sell(agent.token, { ...evenBody, bet: { type: 'first_odd' }, idempotencyKey: 'pv-impair-01' }).expect(201)).body;
      expect(even).toMatchObject({ agent: { code: agent.code, name: 'Boutik Jacmel' }, qrPayload: even.code, cashoutCents: 0, redemption: null });
      expect(await agentBalance(agent.token)).toBe(46_000);
      expect((await sell(agent.token, evenBody).expect(201)).body.code).toBe(even.code);
      expect(await agentBalance(agent.token)).toBe(46_000);

      expect((await api().get(`/api/v1/public/tickets/${even.code}`).expect(200)).body.status).toBe('pending');
      expect((await redeem(agent.token, even.code).expect(409)).body.code).toBe('TICKET_NOT_SETTLED');

      const [first, second] = (even.entries as Entry[]).map((e) => Date.parse(e.scheduledAt));
      await runAt(first + 1000);
      await runAt(second + 1000);
      // 4 participations × 10 HTG × 5 % de commission.
      expect(await agentBalance(agent.token)).toBe(46_000 + 200);

      const tickets = await Promise.all(
        [even, odd].map(async (t) => (await api().get(`/api/v1/agent/tickets/${t.code}`).set(auth(agent.token)).expect(200)).body),
      );
      // À chaque tirage, une seule des deux mises gagne (1,85 × 10 HTG).
      expect(tickets[0].cashoutCents + tickets[1].cashoutCents).toBe(2 * 1850);

      const cashier = await createAgent();
      for (const t of tickets) {
        if (t.cashoutCents === 0) {
          expect((await redeem(cashier.token, t.code).expect(409)).body.code).toBe('TICKET_NOT_WINNING');
          continue;
        }
        const paid = (await redeem(cashier.token, t.code).expect(200)).body;
        expect(paid.redemption).toMatchObject({ amountCents: t.cashoutCents, agentCode: cashier.code });
        expect((await redeem(agent.token, t.code).expect(409)).body.code).toBe('TICKET_ALREADY_PAID');
      }
      expect(await agentBalance(cashier.token)).toBe(2 * 1850);
      expect(await agentBalance(agent.token)).toBe(46_200);
      expect((await api().get('/api/v1/agent/tickets').set(auth(agent.token)).expect(200)).body).toHaveLength(2);
    });

    it('refuse une vente au-delà du crédit et rend au guichet la mise d’un tirage annulé', async () => {
      const agent = await createAgent({ creditLimitCents: 2000 });
      const t = (await sell(agent.token, { game: 'lucky_ten', bet: { type: 'more_odd' }, stakeCents: 2000, draws: 1, idempotencyKey: 'pv-credit-01' }).expect(201)).body;
      expect(await agentBalance(agent.token)).toBe(-2000);
      const refused = await sell(agent.token, { game: 'lucky_ten', bet: { type: 'more_odd' }, stakeCents: 100, draws: 1, idempotencyKey: 'pv-credit-02' }).expect(400);
      expect(refused.body.code).toBe('INSUFFICIENT_FLOAT');

      const lower = await api().patch(`/api/v1/admin/agents/${agent.id}`).set(auth(agent.adminToken)).send({ creditLimitCents: 0 }).expect(409);
      expect(lower.body.code).toBe('CREDIT_LIMIT_BELOW_DEBT');

      await api().post(`/api/v1/admin/draws/${t.entries[0].drawId}/cancel`).set(auth(agent.adminToken)).send({ reason: 'panne' }).expect(204);
      const refunded = (await api().get(`/api/v1/public/tickets/${t.code}`).expect(200)).body;
      expect(refunded).toMatchObject({ status: 'refunded', cashoutCents: 2000 });
      await redeem(agent.token, t.code).expect(200);
      expect(await agentBalance(agent.token)).toBe(0);
    });

    it('dépose sur le compte d’un joueur et touche la commission de dépôt', async () => {
      const agent = await createAgent();
      await topUp(agent.id, 20_000);
      const player = await registerPlayer();
      const body = { phone: player.phone, amountCents: 5000, idempotencyKey: 'pv-depot-0001' };
      const deposit = (await api().post('/api/v1/agent/deposits').set(auth(agent.token)).send(body).expect(201)).body;
      expect(deposit).toMatchObject({ status: 'completed', provider: 'agent', agentId: agent.id, amountCents: 5000 });
      expect((await api().post('/api/v1/agent/deposits').set(auth(agent.token)).send(body).expect(201)).body.id).toBe(deposit.id);
      expect(await balance(player.token)).toBe(5000);
      expect(await agentBalance(agent.token)).toBe(20_000 - 5000 + 50);

      const unknown = await api().post('/api/v1/agent/deposits').set(auth(agent.token)).send({ ...body, phone: '+50949999999' }).expect(404);
      expect(unknown.body.code).toBe('PLAYER_NOT_FOUND');
      const history = (await api().get('/api/v1/payments').set(auth(player.token)).expect(200)).body;
      expect(history[0]).toMatchObject({ provider: 'agent', direction: 'deposit' });
    });

    it('remet un retrait en liquide contre le code généré par le joueur', async () => {
      const agent = await createAgent();
      const player = await registerPlayer();
      await deposit(player.token, 10_000);
      const support = await staffLogin('support');
      await api().patch(`/api/v1/admin/players/${player.id}`).set(auth(support.token)).send({ kycStatus: 'verified' }).expect(200);

      const online = await api().post('/api/v1/payments/deposits').set(auth(player.token)).send({ provider: 'agent', amountCents: 1000, idempotencyKey: 'depot-guichet' }).expect(503);
      expect(online.body.code).toBe('PROVIDER_UNAVAILABLE');

      const withdrawal = (await api().post('/api/v1/payments/withdrawals').set(auth(player.token)).send({ provider: 'agent', amountCents: 3000, idempotencyKey: 'retrait-pv-01' }).expect(201)).body;
      expect(withdrawal.status).toBe('processing');
      expect(await balance(player.token)).toBe(7000);
      const { code } = (await api().post(`/api/v1/payments/withdrawals/${withdrawal.id}/pickup-code`).set(auth(player.token)).expect(200)).body;
      expect(code).toMatch(/^\d{8}$/);

      const wrong = code === '00000000' ? '11111111' : '00000000';
      expect((await api().post('/api/v1/agent/withdrawals/pickup').set(auth(agent.token)).send({ phone: player.phone, code: wrong }).expect(400)).body.code).toBe('PICKUP_CODE_INVALID');
      const paid = (await api().post('/api/v1/agent/withdrawals/pickup').set(auth(agent.token)).send({ phone: player.phone, code }).expect(200)).body;
      expect(paid).toMatchObject({ status: 'completed', agentId: agent.id });
      expect(await agentBalance(agent.token)).toBe(3000);
      await api().post('/api/v1/agent/withdrawals/pickup').set(auth(agent.token)).send({ phone: player.phone, code }).expect(400);

      const second = (await api().post('/api/v1/payments/withdrawals').set(auth(player.token)).send({ provider: 'agent', amountCents: 2000, idempotencyKey: 'retrait-pv-02' }).expect(201)).body;
      expect(await balance(player.token)).toBe(5000);
      await api().post(`/api/v1/payments/withdrawals/${second.id}/cancel`).set(auth(player.token)).expect(200);
      await api().post(`/api/v1/payments/withdrawals/${second.id}/cancel`).set(auth(player.token)).expect(409);
      expect(await balance(player.token)).toBe(7000);
    });

    it('bloque un agent : plus de vente ni de connexion', async () => {
      const agent = await createAgent();
      await topUp(agent.id, 5000);
      await api().patch(`/api/v1/admin/agents/${agent.id}`).set(auth(agent.adminToken)).send({ status: 'blocked' }).expect(200);
      const sale = await sell(agent.token, { game: 'lucky_six', bet: { type: 'first_low' }, stakeCents: 1000, draws: 1, idempotencyKey: 'pv-bloque-01' }).expect(403);
      expect(sale.body.code).toBe('AGENT_BLOCKED');
      expect((await api().post('/api/v1/agent/auth/login').send({ phone: agent.phone, password: PASSWORD }).expect(403)).body.code).toBe('AGENT_BLOCKED');
    });

    it('résume l’activité du jour pour l’agent et pour le back-office', async () => {
      const agent = await createAgent();
      await topUp(agent.id, 10_000);
      await sell(agent.token, { game: 'lucky_ten', bet: { type: 'first_even' }, stakeCents: 1000, draws: 1, idempotencyKey: 'pv-resume-01' }).expect(201);
      const player = await registerPlayer();
      await api().post('/api/v1/agent/deposits').set(auth(agent.token)).send({ phone: player.phone, amountCents: 2000, idempotencyKey: 'pv-resume-02' }).expect(201);

      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Port-au-Prince' });
      const mine = (await api().get(`/api/v1/agent/summary?from=${today}&to=${today}`).set(auth(agent.token)).expect(200)).body;
      expect(mine).toMatchObject({
        ticketsSold: 1,
        ticketSalesCents: 1000,
        playerDepositsCents: 2000,
        commissionsCents: 20,
        floatTopupsCents: 10_000,
        netCashCents: 3000,
      });
      expect(mine.agent.balanceCents).toBe(10_000 - 1000 - 2000 + 20);

      const auditor = await staffLogin('auditor');
      const theirs = (await api().get(`/api/v1/admin/agents/${agent.id}/summary?from=${today}&to=${today}`).set(auth(auditor.token)).expect(200)).body;
      expect(theirs.netCashCents).toBe(3000);
      expect((await api().get(`/api/v1/admin/agents/${agent.id}/ledger`).set(auth(auditor.token)).expect(200)).body).toHaveLength(4);
      expect((await api().get(`/api/v1/admin/agents?search=${agent.code}`).set(auth(auditor.token)).expect(200)).body[0].id).toBe(agent.id);
      const csv = await api().get(`/api/v1/admin/exports/agent_ledger?from=${today}&to=${today}`).set(auth(auditor.token)).expect(200);
      expect(csv.text.split('\n')[0]).toBe('id,agent_id,created_at,kind,amount_cents,balance_after_cents,ref_type,ref_id');
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
      const current = (await api().get('/api/v1/admin/keno/settings').set(auth(auditor.token)).expect(200)).body.current;
      const input = {
        minStakeCents: current.minStakeCents,
        maxStakeCents: current.maxStakeCents,
        maxPicks: current.maxPicks,
        maxPayoutCents: current.maxPayoutCents,
        paytable: current.paytable,
      };

      await api().put('/api/v1/admin/keno/settings').set(auth(auditor.token)).send(input).expect(403);
      const invalid = await api()
        .put('/api/v1/admin/keno/settings')
        .set(auth(admin.token))
        .send({ ...input, paytable: { ...input.paytable, '1': [0, 3] } })
        .expect(400);
      expect(invalid.body.code).toBe('INVALID_SETTINGS');

      const updated = await api()
        .put('/api/v1/admin/keno/settings')
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
      const games = Object.values(day.games) as { stakesCents: number; ggrCents: number }[];
      expect(games).toHaveLength(4);
      expect(games.reduce((sum, g) => sum + g.ggrCents, 0)).toBe(day.ggrCents);
      expect(games.reduce((sum, g) => sum + g.stakesCents, 0)).toBe(day.stakesCents);
      expect(day.games.keno.bets).toBeGreaterThan(0);
      expect(day.games.american_roulette.bets).toBeGreaterThan(0);

      const spins = await api()
        .get(`/api/v1/admin/exports/spins?from=${today}&to=${today}`)
        .set(auth(auditor.token))
        .expect(200);
      expect(spins.text.split('\n')[0]).toBe(
        'id,user_id,created_at,number,total_stake_cents,total_payout_cents,covers_all,bets,seed_id,nonce,settings_version',
      );

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
