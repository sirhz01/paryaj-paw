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
import { hashServerSeed } from '../src/fairness/provably-fair';
import { SHOP_CLOCK, nextDayKey, roundsInDay } from '../src/shop/clock';
import { dayStartMs, roundWindow } from '../src/shop/clock';
import { lineWin, rouletteKeyNumbers, TicketLine, WHEEL_ORDER } from '../src/shop/games';
import { RoundsService } from '../src/shop/rounds.service';
import { createPgliteDatabase } from '../src/database/pglite';

const PASSWORD = 'motdepasse-solide';
const DAY = '2026-11-02';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const ALL_STRAIGHT = ['n:0', 'n:00', ...Array.from({ length: 36 }, (_, i) => `n:${i + 1}`)];

describe('Boutique (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let rounds: RoundsService;
  let now = 0;
  let seq = 0;

  const at = (round: number, seconds: number) => (now = roundWindow('roulette', DAY, round).startMs + seconds * 1000);

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
      .useValue({ now: () => now })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app, config);
    await app.init();
    rounds = app.get(RoundsService);
    now = dayStartMs(DAY) + 1000;
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  async function login(role: StaffRole) {
    const email = `${role}-${++seq}@paryajpaw.test`;
    const { totpSecret } = await createStaff(db, { email, role, password: PASSWORD });
    const res = await api()
      .post('/api/v1/admin/auth/login')
      .send({ email, password: PASSWORD, totp: totpAt(totpSecret, totpCounter()) })
      .expect(200);
    return res.body.accessToken as string;
  }

  let cashier: string;
  let admin: string;
  beforeAll(async () => {
    cashier = await login('cashier');
    admin = await login('super_admin');
  });

  const sell = (token: string, body: Record<string, unknown>) =>
    api()
      .post('/api/v1/shop/tickets')
      .set(auth(token))
      .send({ terminal: 'CAISSE #1', idempotencyKey: `vente-${++seq}-abcdef`, ...body });
  const ticket = (id: string, token = cashier) => api().get(`/api/v1/shop/tickets/${id}`).set(auth(token));
  const pay = (id: string, token = cashier) =>
    api().post(`/api/v1/shop/tickets/${id}/pay`).set(auth(token)).send({ terminal: 'CAISSE #1' });

  describe('écrans (public)', () => {
    it('config : durées, grilles, tables de gains et mises rapides', async () => {
      const res = await api().get('/api/v1/shop/config').expect(200);
      expect(res.body.timings.roulette).toEqual({ bet: 25, draw: 11, result: 8 });
      expect(res.body.grids.luckysix).toMatchObject({ max: 48, min: 6, maxPick: 6, drawn: 35 });
      expect(res.body.stakesCents).toEqual([2500, 5000, 10000, 25000, 50000, 100000]);
      expect(res.body.paytables.keno['9']['9']).toBe(1620); // migration 024 (RTP 15 %)
      expect(res.body.paytables.luckyx.ladders['1']).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]); // migration 027 : gain selon le rang de la dernière boule
      expect(res.body.paytables.roulette.odds.n).toBe(36); // migration 026
      expect(res.body.wheelOrder).toHaveLength(38);
      expect(res.body.serverTime).toBe(now);
    });

    it('state : un tour par jeu avec son hash scellé, jamais la graine ni le résultat', async () => {
      at(11, 3);
      const res = await api().get('/api/v1/shop/state').expect(200);
      expect(res.body.serverTime).toBe(now);
      expect(res.body.games.roulette).toMatchObject({ day: DAY, round: 11, phase: 'bet', left: 22 });
      // Un tour déjà en tirage et jamais scellé (serveur arrêté) n'a pas de hash : on ne l'invente pas après coup.
      for (const g of Object.values<{ phase: string; serverSeedHash: string | null }>(res.body.games)) {
        if (g.phase === 'bet') expect(g.serverSeedHash).toMatch(/^[0-9a-f]{64}$/);
        else expect(g.serverSeedHash).toBeNull();
      }
      expect(res.body.games.roulette.serverSeedHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(res.body)).not.toMatch(/"serverSeed"|"result":/);
    });

    it('le résultat apparaît au début du tirage, la graine à la fin', async () => {
      at(11, 3);
      const sealed = await api().get(`/api/v1/shop/rounds/roulette/${DAY}/11`).expect(200);
      expect(sealed.body.result).toBeUndefined();
      expect(sealed.body.serverSeed).toBeUndefined();

      at(11, 26);
      const drawing = await api().get(`/api/v1/shop/rounds/roulette/${DAY}/11`).expect(200);
      expect(WHEEL_ORDER).toContain(drawing.body.result.n);
      expect(drawing.body.serverSeed).toBeUndefined();

      at(11, 36.5);
      const done = await api().get(`/api/v1/shop/rounds/roulette/${DAY}/11`).expect(200);
      expect(hashServerSeed(done.body.serverSeed)).toBe(sealed.body.serverSeedHash);
      expect(done.body.result).toEqual(drawing.body.result);

      const check = await api()
        .post('/api/v1/shop/verify')
        .send({ game: 'roulette', serverSeed: done.body.serverSeed, day: DAY, round: 11 })
        .expect(200);
      expect(check.body).toEqual({ serverSeedHash: sealed.body.serverSeedHash, result: done.body.result });
    });

    it('latest : seulement les tours dont le tirage est terminé', async () => {
      at(11, 36.5);
      const res = await api().get('/api/v1/shop/rounds/roulette/latest?limit=5').expect(200);
      expect(res.body.rounds.map((r: { round: number }) => r.round)).toContain(11);
      expect(res.body.rounds.every((r: { serverSeed?: string }) => r.serverSeed)).toBe(true);
      at(11, 26);
      const during = await api().get('/api/v1/shop/rounds/roulette/latest?limit=5').expect(200);
      expect(during.body.rounds.map((r: { round: number }) => r.round)).not.toContain(11);
    });

    it('refuse les tours inexistants ou manqués', async () => {
      await api().get(`/api/v1/shop/rounds/roulette/${DAY}/999999`).expect(404);
      await api().get(`/api/v1/shop/rounds/roulette/${DAY}/5`).expect(404);
      await api().get(`/api/v1/shop/rounds/poker/${DAY}/5`).expect(404);
      await api().get('/api/v1/shop/rounds/roulette/hier/5').expect(404);
    });
  });

  describe('vente', () => {
    it('refuse sans jeton de caissier', async () => {
      at(12, 1);
      await api().post('/api/v1/shop/tickets').send({}).expect(401);
      await ticket('ABC', 'jeton-bidon').expect(401);
    });

    it('roulette : le serveur calcule cotes et gain possible, et regroupe les mises identiques', async () => {
      at(12, 1);
      const res = await sell(cashier, {
        game: 'roulette',
        lines: [
          { key: 'n:17', stakeCents: 10000 },
          { key: 'n:17', stakeCents: 5000 },
          { key: 'doz:2', stakeCents: 2500 },
          { key: 'red', stakeCents: 5000 },
        ],
      }).expect(201);
      expect(res.body).toMatchObject({ game: 'roulette', day: DAY, round: 12, terminal: 'CAISSE #1', status: 'pending', stakeCents: 22500 });
      expect(res.body.id).toMatch(/^[A-HJ-NP-Z2-9]{9}$/);
      expect(res.body.lines).toEqual([
        { key: 'n:17', label: 'Pari simple', picks: ['17'], odds: 36, stakeCents: 15000, possibleCents: 540000 },
        { key: 'doz:2', label: 'Douzaine 2', picks: ['DOUZAINE 2'], odds: 3, stakeCents: 2500, possibleCents: 7500 },
        { key: 'red', label: 'Rouge', picks: ['ROUGE'], odds: 2, stakeCents: 5000, possibleCents: 10000 },
      ]);
    });

    it('rejouer la même requête rend le même ticket sans en créer un second', async () => {
      at(12, 2);
      const body = { game: 'keno', idempotencyKey: 'meme-vente-001', lines: [{ picks: [3, 1, 2], stakeCents: 5000 }] };
      const first = await sell(cashier, body).expect(201);
      const again = await sell(cashier, body).expect(201);
      expect(again.body.id).toBe(first.body.id);
      const { rows } = await db.query('SELECT count(*)::int AS n FROM shop_tickets WHERE idempotency_key = $1', ['meme-vente-001']);
      expect(rows[0]).toEqual({ n: 1 });
      expect(first.body.lines[0]).toMatchObject({ label: 'Keno 3 numéros', picks: [1, 2, 3], odds: 5.97, possibleCents: 29850 });
    });

    it('refuse les mises invalides avec un code', async () => {
      at(12, 3);
      const code = async (body: Record<string, unknown>) => (await sell(cashier, body).expect(400)).body.code;
      expect(await code({ game: 'roulette', lines: [{ key: 'n:37', stakeCents: 2500 }] })).toBe('INVALID_BET');
      expect(await code({ game: 'roulette', lines: [{ picks: [1], stakeCents: 2500 }] })).toBe('INVALID_BET');
      expect(await code({ game: 'keno', lines: [{ key: 'red', stakeCents: 2500 }] })).toBe('INVALID_BET');
      expect(await code({ game: 'keno', lines: [{ picks: [1, 1], stakeCents: 2500 }] })).toBe('INVALID_BET');
      expect(await code({ game: 'keno', lines: [{ picks: [81], stakeCents: 2500 }] })).toBe('INVALID_BET');
      expect(await code({ game: 'luckysix', lines: [{ picks: [1, 2, 3], stakeCents: 2500 }] })).toBe('INVALID_BET');
      expect(await code({ game: 'roulette', lines: [{ key: 'red', stakeCents: 100 }] })).toBe('STAKE_TOO_LOW');
      expect(await code({ game: 'roulette', lines: [{ key: 'red', stakeCents: 500_001 }] })).toBe('STAKE_TOO_HIGH');
      expect(await code({ game: 'roulette', terminal: 'CAISSE #9', lines: [{ key: 'red', stakeCents: 2500 }] })).toBe('UNKNOWN_TERMINAL');
      expect(await code({ game: 'roulette', lines: [] })).toBe('VALIDATION_ERROR');
      expect(await code({ game: 'roulette', lines: [{ key: 'red', stakeCents: 2500, extra: 1 }] })).toBe('VALIDATION_ERROR');
      const tooMuch = ['red', 'black', 'even', 'odd', 'low'].map((key) => ({ key, stakeCents: 500_000 }));
      expect(await code({ game: 'roulette', lines: tooMuch })).toBe('TICKET_TOO_HIGH');
    });

    it('après la fermeture des mises, la vente part sur le tour suivant', async () => {
      at(12, 24); // moins de 2 s avant la fermeture
      const closing = await sell(cashier, { game: 'roulette', lines: [{ key: 'red', stakeCents: 2500 }] }).expect(201);
      expect(closing.body.round).toBe(13);
      at(12, 30); // tirage en cours
      const drawing = await sell(cashier, { game: 'roulette', lines: [{ key: 'red', stakeCents: 2500 }] }).expect(201);
      expect(drawing.body.round).toBe(13);
    });

    it('le dernier tour du jour vend pour le premier tour du lendemain', async () => {
      const last = Math.floor(86400 / 44);
      at(last, 30);
      const res = await sell(cashier, { game: 'roulette', lines: [{ key: 'red', stakeCents: 2500 }] }).expect(201);
      expect(res.body).toMatchObject({ day: '2026-11-03', round: 1 });
    });

    it('un tour manqué ne vend rien', async () => {
      at(40, 30);
      expect(await rounds.ensure('roulette', DAY, 40)).toBeUndefined();
      const { rows } = await db.query('SELECT 1 FROM shop_rounds WHERE game = $1 AND day = $2 AND round_no = $3', ['roulette', DAY, 40]);
      expect(rows).toHaveLength(0);
    });

    it('ticket, résultat et paiement sont en lecture seule', async () => {
      await expect(db.query("UPDATE shop_tickets SET stake_cents = 1")).rejects.toThrow(/append-only/);
      await expect(db.query('DELETE FROM shop_rounds')).rejects.toThrow(/append-only/);
    });
  });

  describe('règlement et décaissement', () => {
    /** Ticket gagnant à coup sûr : une mise sur chacune des 38 cases. */
    async function winningTicket(stakeCents: number) {
      const res = await sell(cashier, { game: 'roulette', lines: ALL_STRAIGHT.map((key) => ({ key, stakeCents })) }).expect(201);
      return res.body as { id: string; round: number };
    }

    it('un ticket reste en attente jusqu\'à la fin du tirage', async () => {
      at(20, 2);
      const t = await winningTicket(2500);
      await ticket(t.id).expect(200).expect((r) => {
        expect(r.body.status).toBe('pending');
        expect(r.body.winCents).toBeUndefined();
      });
      at(20, 30);
      await ticket(t.id).expect(200).expect((r) => expect(r.body.status).toBe('pending'));
      await pay(t.id).expect(409).expect((r) => expect(r.body.code).toBe('ROUND_PENDING'));
    });

    it('gagnant : le gain vient du résultat scellé, et ne se paie qu\'une fois', async () => {
      at(21, 2);
      const t = await winningTicket(2500);
      at(21, 36);
      const view = await ticket(t.id).expect(200);
      expect(view.body).toMatchObject({ status: 'won', winCents: 90000 });

      const paid = await pay(t.id).expect(200);
      expect(paid.body).toMatchObject({ status: 'paid', payoutCents: 90000, paidTerminal: 'CAISSE #1' });
      const again = await pay(t.id).expect(409);
      expect(again.body.code).toBe('ALREADY_PAID');
      const { rows } = await db.query('SELECT count(*)::int AS n FROM shop_payouts WHERE ticket_id = $1', [t.id]);
      expect(rows[0]).toEqual({ n: 1 });
      await ticket(t.id).expect((r) => expect(r.body.status).toBe('paid'));
    });

    it('deux décaissements simultanés : un seul passe', async () => {
      at(22, 2);
      const t = await winningTicket(2500);
      at(22, 36);
      const results = await Promise.all([pay(t.id), pay(t.id), pay(t.id)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    });

    it('perdant : rien à décaisser', async () => {
      at(23, 2);
      const res = await sell(cashier, { game: 'roulette', lines: [{ key: 'n:5', stakeCents: 2500 }] }).expect(201);
      at(23, 36);
      const result = (await api().get(`/api/v1/shop/rounds/roulette/${DAY}/23`).expect(200)).body.result.n;
      if (result === '5') return; // 1 chance sur 38 : le tirage est aléatoire
      await ticket(res.body.id).expect((r) => expect(r.body).toMatchObject({ status: 'lost', winCents: 0 }));
      await pay(res.body.id).expect(409).expect((r) => expect(r.body.code).toBe('TICKET_LOST'));
    });

    // Roulette à 36× : 40 000 de mise sur le numéro gagnant donnent 1 440 000 de gain.
    // Ce montant est sous le seuil d'approbation de 1 000 000 (plafond de ticket 2 000 000) : on abaisse le seuil le temps du test.
    it('un gros gain demande un responsable', async () => {
      const current = (await api().get('/api/v1/admin/shop/settings').set(auth(admin)).expect(200)).body.settings;
      const { version: _v, createdAt: _c, ...input } = current;
      const setThreshold = (approvalThresholdCents: number) =>
        api().put('/api/v1/admin/shop/settings').set(auth(admin)).send({ ...input, approvalThresholdCents }).expect(200);
      await setThreshold(100_000);
      try {
        at(24, 2);
        const t = await winningTicket(40000);
        at(24, 36);
        const refused = await pay(t.id).expect(403);
        expect(refused.body).toMatchObject({ code: 'APPROVAL_REQUIRED', amountCents: 1_440_000 });
        await pay(t.id, admin).expect(200).expect((r) => expect(r.body.payoutCents).toBe(1_440_000));
      } finally {
        await setThreshold(input.approvalThresholdCents);
      }
    });

    it('chaque jeu règle ses tickets comme les règles du serveur', async () => {
      const cases = [
        { game: 'keno', lines: [{ picks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], stakeCents: 2500 }] },
        { game: 'luckysix', lines: [{ picks: [1, 2, 3, 4, 5, 6], stakeCents: 2500 }] },
        { game: 'luckyx', lines: [{ picks: [7], stakeCents: 2500 }, { picks: [8, 9], stakeCents: 2500 }] },
      ];
      at(25, 2);
      const sold = [];
      for (const c of cases) sold.push((await sell(cashier, c).expect(201)).body);
      // Les trois jeux ont des cycles différents : on se place après le tirage de chacun.
      const done = Math.max(...sold.map((t) => roundWindow(t.game, t.day, t.round).drawEndMs)) + 1000;
      now = done;
      for (const t of sold) {
        const round = await api().get(`/api/v1/shop/rounds/${t.game}/${t.day}/${t.round}`).expect(200);
        const paytables = (await api().get('/api/v1/shop/config').expect(200)).body.paytables;
        const expected = t.lines.reduce((sum: number, l: TicketLine) => sum + lineWin(t.game, l, round.body.result, paytables), 0);
        const view = await ticket(t.id).expect(200);
        expect(view.body.winCents).toBe(expected);
        expect(view.body.status).toBe(expected > 0 ? 'won' : 'lost');
      }
    });

    it('le planificateur règle tous les tours terminés', async () => {
      at(30, 2);
      const t = await winningTicket(2500);
      at(30, 40);
      expect(await rounds.settleDue()).toBeGreaterThanOrEqual(1);
      const { rows } = await db.query('SELECT win_cents FROM shop_ticket_results WHERE ticket_id = $1', [t.id]);
      expect(rows).toEqual([{ win_cents: 90000 }]);
      expect(await rounds.settleDue()).toBe(0);
    });

  });

  describe('rapports et paramètres', () => {
    it('rapport de caisse du jour', async () => {
      const res = await api().get(`/api/v1/shop/report?day=${DAY}`).set(auth(cashier)).expect(200);
      expect(res.body.day).toBe(DAY);
      expect(res.body.totals.tickets).toBeGreaterThan(5);
      expect(res.body.totals.payouts).toBeGreaterThanOrEqual(3);
      expect(res.body.terminals[0].terminal).toBe('CAISSE #1');
      expect(res.body.unclaimedWinners.count).toBeGreaterThanOrEqual(1);
    });

    it('liste des tickets récents', async () => {
      const res = await api().get('/api/v1/shop/tickets?limit=3').set(auth(cashier)).expect(200);
      expect(res.body).toHaveLength(3);
      expect(res.body[0]).toHaveProperty('status');
    });

    it('le caissier n\'accède ni au tableau de bord ni aux paramètres ni aux routes du back-office', async () => {
      await api().get('/api/v1/admin/shop/settings').set(auth(cashier)).expect(403);
      await api().put('/api/v1/admin/shop/settings').set(auth(cashier)).send({}).expect(403);
      await api().get('/api/v1/admin/dashboard?from=2026-11-01&to=2026-11-03').set(auth(cashier)).expect(403);
      await api().get('/api/v1/admin/keno/settings').set(auth(cashier)).expect(403);
      await api().get('/api/v1/admin/exports/shop_tickets?from=2026-11-01&to=2026-11-03').set(auth(cashier)).expect(403);
    });

    it('tableau de bord boutique par jour et par jeu', async () => {
      const res = await api().get(`/api/v1/admin/shop/dashboard?from=${DAY}&to=${DAY}`).set(auth(admin)).expect(200);
      const roulette = res.body.find((r: { game: string }) => r.game === 'roulette');
      expect(roulette.tickets).toBeGreaterThan(5);
      expect(roulette.ggrCents).toBe(roulette.stakesCents - roulette.winsCents);
      expect(roulette.paidCents).toBeGreaterThan(0);
      expect(roulette.settledStakesCents).toBeLessThanOrEqual(roulette.stakesCents); // seuls les tickets réglés servent de base au RTP constaté
      expect(roulette.settledStakesCents).toBeGreaterThan(0);
    });

    it('ventilation par caissier et par heure', async () => {
      const res = await api().get(`/api/v1/admin/shop/breakdown?from=${DAY}&to=${DAY}`).set(auth(admin)).expect(200);
      expect(res.body.cashiers.length).toBeGreaterThan(0);
      const ticketsByCashier = res.body.cashiers.reduce((n: number, r: { tickets: number }) => n + r.tickets, 0);
      const ticketsByHour = res.body.hours.reduce((n: number, r: { tickets: number }) => n + r.tickets, 0);
      expect(ticketsByHour).toBe(ticketsByCashier);
      for (const r of [...res.body.cashiers, ...res.body.hours]) expect(Number(r.settledStakesCents)).toBeLessThanOrEqual(Number(r.stakesCents));
      for (const h of res.body.hours) expect(h.hour).toBeGreaterThanOrEqual(0);
      await api().get(`/api/v1/admin/shop/breakdown?from=${DAY}&to=${DAY}`).set(auth(cashier)).expect(403);
    });

    it('paramètres : le RTP de chaque ligne est publié, une ligne > 100 % est refusée', async () => {
      const res = await api().get('/api/v1/admin/shop/settings').set(auth(admin)).expect(200);
      const keno2 = res.body.rtp.find((r: { game: string; line: string }) => r.game === 'keno' && r.line === '2 numéros');
      expect(keno2.rtpPercent).toBeGreaterThan(10); // RTP ~15 % depuis le choix d'avantage maison de 85 % (migration 024)
      expect(keno2.rtpPercent).toBeLessThanOrEqual(100);

      const { version: _v, createdAt: _c, ...input } = res.body.settings;
      // Une ligne qui rend plus que la mise (Keno 2 numéros à 19 ×) est refusée.
      const over = { ...input, paytables: { ...input.paytables, keno: { ...input.paytables.keno, '2': { '2': 19 } } } };
      const refused = await api().put('/api/v1/admin/shop/settings').set(auth(admin)).send(over).expect(400);
      expect(refused.body.code).toBe('INVALID_SETTINGS');
      expect(refused.body.errors.join()).toMatch(/keno 2 numéros/);

      const bad = await api().put('/api/v1/admin/shop/settings').set(auth(admin)).send({ ...input, stakesCents: [100] }).expect(400);
      expect(bad.body.errors.join()).toMatch(/mise rapide/);
    });

    it('un nouveau jeu de paramètres s\'applique aux ventes suivantes', async () => {
      const res = await api().get('/api/v1/admin/shop/settings').set(auth(admin)).expect(200);
      const { version, createdAt: _c, ...input } = res.body.settings;
      expect(version).toBeGreaterThanOrEqual(1); // version courante (la migration des tables certifiées en ajoute une)
      input.paytables.keno['2'] = { '2': 15 };
      const updated = await api()
        .put('/api/v1/admin/shop/settings')
        .set(auth(admin))
        .send({ ...input, maxPayoutCents: 100_000_000, topLineEnabled: false, terminals: ['CAISSE #1', 'CAISSE #2'] })
        .expect(200);
      expect(updated.body.settings.version).toBe(version + 1);

      at(35, 2);
      await sell(cashier, { game: 'roulette', lines: [{ key: 'basket', stakeCents: 2500 }] }).expect(400);
      await sell(cashier, { game: 'roulette', terminal: 'CAISSE #3', lines: [{ key: 'red', stakeCents: 2500 }] }).expect(400);
      const ok = await sell(cashier, { game: 'roulette', terminal: 'CAISSE #2', lines: [{ key: 'red', stakeCents: 2500 }] }).expect(201);
      const { rows } = await db.query('SELECT settings_version FROM shop_tickets WHERE id = $1', [ok.body.id]);
      expect(rows[0]).toEqual({ settings_version: version + 1 });
      // Les tickets déjà vendus gardent la version de leurs paramètres.
      const old = await db.query('SELECT count(*)::int AS n FROM shop_tickets WHERE settings_version = $1', [version]);
      expect(old.rows[0].n).toBeGreaterThan(3); // le test « gros gain » ouvre deux versions de paramètres avant celle-ci
    });

    it('exports CSV des tickets et des tours, sans graine', async () => {
      const tickets = await api().get(`/api/v1/admin/exports/shop_tickets?from=${DAY}&to=${DAY}`).set(auth(admin)).expect(200);
      expect(tickets.text.split('\n')[0]).toContain('win_cents');
      expect(tickets.text).toContain('CAISSE #1');
      const roundsCsv = await api().get(`/api/v1/admin/exports/shop_rounds?from=${DAY}&to=${DAY}`).set(auth(admin)).expect(200);
      expect(roundsCsv.text.split('\n')[0]).toContain('server_seed_hash');
      expect(roundsCsv.text.split('\n')[0]).not.toMatch(/server_seed(,|$)/);
    });
  });

  it('les numéros de la roue sont ceux du tapis', () => {
    for (const n of WHEEL_ORDER) expect(n === '0' || n === '00' || rouletteKeyNumbers(`n:${n}`) !== null).toBe(true);
  });

  describe('annulation d un ticket', () => {
    const voidIt = (id: string, token = cashier) => api().post(`/api/v1/shop/tickets/${id}/void`).set(auth(token));
    const stakes = async () => Number((await api().get(`/api/v1/shop/report?day=${DAY}`).set(auth(cashier)).expect(200)).body.totals.stakesCents);

    it('retire la mise de la caisse, bloque le paiement, et reste sans effet au second appel', async () => {
      at(40, 2);
      const before = await stakes();
      const sold = await sell(cashier, { game: 'roulette', lines: [{ key: 'n:17', stakeCents: 2500 }] }).expect(201);
      expect(await stakes()).toBe(before + 2500);

      const voided = await voidIt(sold.body.id).expect(200);
      expect(voided.body.status).toBe('voided');
      expect(await stakes()).toBe(before);
      await voidIt(sold.body.id).expect(200);           // idempotent
      expect(await stakes()).toBe(before);

      at(40, 60);                                         // tour terminé : un ticket annulé n'est jamais réglé ni payé
      await rounds.settleDue();
      const { rows } = await db.query('SELECT 1 FROM shop_ticket_results WHERE ticket_id = $1', [sold.body.id]);
      expect(rows).toHaveLength(0);
      await ticket(sold.body.id).expect(200).expect((r) => expect(r.body.status).toBe('voided'));
      await pay(sold.body.id).expect(409).expect((r) => expect(r.body.code).toBe('TICKET_VOIDED'));
    });

    it('refusé pour un autre caissier, et une fois le tirage commencé', async () => {
      at(41, 2);
      const sold = await sell(cashier, { game: 'roulette', lines: [{ key: 'n:5', stakeCents: 2500 }] }).expect(201);
      const other = await login('cashier');
      await voidIt(sold.body.id, other).expect(403).expect((r) => expect(r.body.code).toBe('NOT_YOUR_TICKET'));
      at(41, 30);                                         // tirage commencé (mises : 25 s)
      await voidIt(sold.body.id).expect(409).expect((r) => expect(r.body.code).toBe('VOID_TOO_LATE'));
      await ticket(sold.body.id).expect(200).expect((r) => expect(r.body.status).toBe('pending'));
    });
  });

  describe('fiche multi-tours', () => {
    /** Mises gagnantes à coup sûr sur chaque tour : une mise par case, avec une mise différente par tour. */
    const allStraight = (stakeCents: number) => ALL_STRAIGHT.map(() => stakeCents);
    const straightLines = ALL_STRAIGHT.map((key) => ({ key, stakeCents: 2500 }));
    const bundleSell = (later: number[], extra: Record<string, unknown> = {}) =>
      sell(cashier, { game: 'roulette', lines: straightLines, later: later.map((c) => ({ stakesCents: allStraight(c) })), ...extra });
    const countBundle = async (id: string) =>
      (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM shop_tickets WHERE bundle_id = $1', [id])).rows[0].n;

    it('une fiche joue les mêmes mises sur plusieurs tours, avec une mise par tour, payée en une fois', async () => {
      at(60, 2);
      const key = 'fiche-multi-001-abcdef';
      const res = await bundleSell([5000, 2500], { idempotencyKey: key }).expect(201);
      const b = res.body;
      expect(b).toMatchObject({ round: 60, status: 'pending', stakeCents: 38 * (2500 + 5000 + 2500) });
      expect(b.bundle).toMatchObject({ id: b.id, count: 3, payableCents: 0, paidCents: 0, pendingRounds: 3 });
      expect(b.bundle.rounds.map((r: { round: number }) => r.round)).toEqual([60, 61, 62]);
      expect(b.bundle.rounds.map((r: { stakeCents: number }) => r.stakeCents)).toEqual([95000, 190000, 95000]);
      expect(await countBundle(b.id)).toBe(3);

      // Rejouer la même requête ne crée rien de plus.
      const again = await bundleSell([5000, 2500], { idempotencyKey: key }).expect(201);
      expect(again.body.id).toBe(b.id);
      expect(await countBundle(b.id)).toBe(3);

      // Les tours à venir ont été créés (graine scellée) à l'avance.
      const made = await db.query('SELECT 1 FROM shop_rounds WHERE game = $1 AND day = $2 AND round_no IN (61, 62)', ['roulette', DAY]);
      expect(made.rows).toHaveLength(2);

      // Une seule ligne dans l'historique, pas une par tour.
      const list = (await api().get('/api/v1/shop/tickets?limit=100').set(auth(cashier)).expect(200)).body as { id: string }[];
      expect(list.filter((t) => t.id === b.id)).toHaveLength(1);
      const siblings = (await db.query<{ id: string }>('SELECT id FROM shop_tickets WHERE bundle_id = $1 AND id <> $1', [b.id])).rows;
      for (const s of siblings) expect(list.some((t) => t.id === s.id)).toBe(false);

      // Tour 1 terminé : seul son gain est payable, il reste 2 tours.
      at(60, 40);
      const v1 = await ticket(b.id).expect(200);
      expect(v1.body).toMatchObject({ status: 'won', winCents: 90000 });
      expect(v1.body.bundle).toMatchObject({ payableCents: 90000, pendingRounds: 2 });
      expect((await pay(b.id).expect(200)).body.payoutCents).toBe(90000);
      await pay(b.id).expect(409).expect((r) => expect(r.body.code).toBe('ROUND_PENDING'));

      // Tour 2 (mise doublée) : le gain double ; un ticket d'un tour suivant se règle avec la même fiche.
      at(61, 40);
      const v2 = await ticket(b.id).expect(200);
      expect(v2.body).toMatchObject({ status: 'won', winCents: 180000 });
      expect((await pay(b.id).expect(200)).body.payoutCents).toBe(180000);

      at(62, 40);
      expect((await pay(b.id).expect(200)).body.payoutCents).toBe(90000);
      const done = await ticket(b.id).expect(200);
      expect(done.body).toMatchObject({ status: 'paid', winCents: 90000 + 180000 + 90000 });
      await pay(b.id).expect(409).expect((r) => expect(r.body.code).toBe('ALREADY_PAID'));
      // Chaque tour n'a été payé qu'une fois.
      const paid = await db.query('SELECT count(*)::int AS n FROM shop_payouts WHERE ticket_id IN (SELECT id FROM shop_tickets WHERE bundle_id = $1)', [b.id]);
      expect(paid.rows[0]).toEqual({ n: 3 });
      // Un ticket d'un tour suivant mène à la même fiche.
      expect((await ticket(siblings[0].id).expect(200)).body.bundle.id).toBe(b.id);
    });

    it('refuse une fiche invalide sans rien enregistrer', async () => {
      at(63, 2);
      const before = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM shop_tickets')).rows[0].n;
      await bundleSell(Array(10).fill(2500)).expect(400);                       // 10 tours en plus : trop
      await bundleSell([2500, 100]).expect(400).expect((r) => expect(r.body.code).toBe('STAKE_TOO_LOW'));
      await sell(cashier, { game: 'roulette', lines: straightLines, later: [{ stakesCents: [2500] }] }).expect(400)
        .expect((r) => expect(r.body.code).toBe('INVALID_BET'));                   // une mise par ligne attendue
      expect((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM shop_tickets')).rows[0].n).toBe(before);
    });

    it('annuler la fiche annule tous ses tours, tant que le premier tirage n a pas commencé', async () => {
      at(70, 2);
      const b = (await bundleSell([2500, 2500]).expect(201)).body;
      const out = await api().post(`/api/v1/shop/tickets/${b.id}/void`).set(auth(cashier)).expect(200);
      expect(out.body.status).toBe('voided');
      const voided = await db.query('SELECT count(*)::int AS n FROM shop_ticket_voids WHERE ticket_id IN (SELECT id FROM shop_tickets WHERE bundle_id = $1)', [b.id]);
      expect(voided.rows[0]).toEqual({ n: 3 });
      await pay(b.id).expect(409).expect((r) => expect(r.body.code).toBe('TICKET_VOIDED'));

      at(72, 2);
      const late = (await bundleSell([2500]).expect(201)).body;
      at(72, 30);                                                                  // tirage commencé (mises : 25 s)
      await api().post(`/api/v1/shop/tickets/${late.id}/void`).set(auth(cashier)).expect(409).expect((r) => expect(r.body.code).toBe('VOID_TOO_LATE'));
    });

    it('une fiche qui passe minuit continue sur le premier tour du lendemain', async () => {
      const last = roundsInDay('roulette', DAY);
      at(last, 2);
      const b = (await bundleSell([2500, 2500]).expect(201)).body;
      expect(b.bundle.rounds.map((r: { day: string; round: number }) => [r.day, r.round]))
        .toEqual([[DAY, last], [nextDayKey(DAY), 1], [nextDayKey(DAY), 2]]);
    });
  });

  describe('roulette : RTP visé réglé dans l administration', () => {
    it('la migration 026 pose 94,74 % ; changer la cible recalcule les cotes pour les ventes suivantes seulement', async () => {
      at(50, 2);
      const before = await sell(cashier, { game: 'roulette', lines: [{ key: 'n:17', stakeCents: 2500 }] }).expect(201);
      expect(before.body.lines[0].odds).toBe(36);

      const res = await api().get('/api/v1/admin/shop/settings').set(auth(admin)).expect(200);
      expect(res.body.settings.paytables.roulette).toMatchObject({ targetRtp: 94.74 });
      const { version: _v, createdAt: _c, ...input } = res.body.settings;

      await api().put('/api/v1/admin/shop/settings').set(auth(admin)).send({ ...input, rouletteTargetRtp: 150 }).expect(400);
      const updated = await api().put('/api/v1/admin/shop/settings').set(auth(admin)).send({ ...input, rouletteTargetRtp: 80 }).expect(200);
      expect(updated.body.settings.paytables.roulette).toMatchObject({ targetRtp: 80, odds: { n: 30.4, six: 5.07, red: 1.69 } });
      const straight = updated.body.rtp.find((r: { game: string; line: string }) => r.game === 'roulette' && r.line === 'straight');
      expect(straight.rtpPercent).toBeCloseTo(80, 0);

      at(50, 3);
      const after = await sell(cashier, { game: 'roulette', lines: [{ key: 'n:17', stakeCents: 2500 }] }).expect(201);
      expect(after.body.lines[0].odds).toBe(30.4);
      // Un enregistrement des taux Keno / Lucky seuls (sans cible) ne remet pas la roulette à zéro.
      const keep = await api().put('/api/v1/admin/shop/settings').set(auth(admin)).send({ ...input, paytables: { keno: input.paytables.keno, luckysix: input.paytables.luckysix, luckyx: input.paytables.luckyx } }).expect(200);
      expect(keep.body.settings.paytables.roulette).toMatchObject({ targetRtp: 80 });
      // Le ticket vendu avant le changement garde sa cote.
      await ticket(before.body.id).expect(200).expect((r) => expect(r.body.lines[0].odds).toBe(36));
    });
  });
});
