/* Liaison avec le back-end (backend/README.md) : horloge du serveur, réglages, résultats des tours,
   vente / consultation / décaissement des tickets.
   Sans serveur joignable, les pages restent en mode démo : tirages simulés dans le navigateur, tickets en localStorage.
   Adresse de l'API : ?api=http://hôte:3000/api/v1 (mémorisée), ?api=off pour forcer la démo ;
   par défaut /api/v1 (même serveur, cf. FRONT_DIR) ou http://localhost:3000/api/v1 depuis un fichier local. */
(function () {
  const PP = window.PP;
  PP.online = false;

  /* ---------- Adresse et appels HTTP ---------- */
  const store = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* stockage bloqué */ } };
  const stored = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const param = new URLSearchParams(location.search).get('api');
  if (param) store('pp.api', param);
  const chosen = param || stored('pp.api');
  const OFF = chosen === 'off';
  const BASE = (chosen && !OFF ? chosen : location.protocol === 'file:' ? 'http://localhost:3000/api/v1' : '/api/v1').replace(/\/$/, '');

  class ApiError extends Error {
    constructor(status, body) { super(body.code || 'ERROR'); this.status = status; this.code = body.code || 'ERROR'; this.body = body; }
  }

  async function http(method, path, body, token) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(BASE + path, {
        method, signal: ctl.signal,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json = {};
      try { json = text ? JSON.parse(text) : {}; } catch (e) { /* réponse non JSON */ }
      if (!res.ok) throw new ApiError(res.status, json);
      return json;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(0, { code: 'NETWORK' });
    } finally { clearTimeout(timer); }
  }

  /* ---------- Réglages et horloge ---------- */
  function apply(cfg) {
    PP.SHOP.pointDeVente = cfg.pointOfSale;
    PP.SHOP.emetteur = cfg.issuer;
    PP.SHOP.terminals = cfg.terminals;
    for (const g of Object.keys(cfg.timings)) Object.assign(PP.GAMES[g], cfg.timings[g]);
    PP.STAKES = cfg.stakesCents.map((c) => c / 100);
    PP.LIMITS = { min: cfg.minStakeCents / 100, max: cfg.maxStakeCents / 100, ticket: cfg.maxTicketCents / 100 };
    PP.KENO_PAY = cfg.paytables.keno;
    PP.LUCKY_LADDER = cfg.paytables.luckysix;
    PP.LUCKYX_TIERS = cfg.paytables.luckyx.tiers;
    PP.LUCKYX_SINGLE_ODDS = cfg.paytables.luckyx.single;
    PP.R.ORDER = cfg.wheelOrder;
    PP.CLOSE_MARGIN = cfg.closeMarginSeconds;
  }

  /* Les scripts des pages démarrent après PP.ready : réglages et horloge du serveur déjà en place. */
  PP.ready = (OFF ? Promise.reject(new Error('démo forcée')) : (async () => {
    const t0 = Date.now(), cfg = await http('GET', '/shop/config'), t1 = Date.now();
    PP.offset = cfg.serverTime - (t0 + t1) / 2;
    apply(cfg);
    PP.online = true;
  })()).catch((e) => { console.info('Mode démo (tirages simulés, tickets locaux) :', e.message); });

  /* ---------- Résultats des tours ---------- */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const inflight = {};
  PP.seeds = {};

  function remember(game, r) {
    const key = game + '|' + r.day + '|' + r.round;
    if (r.result) PP.cache[key] = r.result;
    PP.seeds[key] = { hash: r.serverSeedHash, seed: r.serverSeed };
  }

  /** Résultat d'un tour (promesse). Le serveur le publie au début du tirage : on réessaie quelques secondes. null si le tour n'existe pas. */
  PP.load = function (game, day, round) {
    if (!PP.online) return Promise.resolve(PP.result(game, day, round));
    const key = PP.roundKey(game, day, round);
    if (PP.cache[key]) return Promise.resolve(PP.cache[key]);
    return inflight[key] || (inflight[key] = (async () => {
      try {
        for (let i = 0; i < 40; i++) {
          let r;
          try { r = await http('GET', `/shop/rounds/${game}/${PP.dayKey(day)}/${round}`); } catch (e) { if (e.status === 404) return null; r = {}; }
          if (r.result) { remember(game, r); return r.result; }
          await wait(250);
        }
        return null;
      } finally { delete inflight[key]; }
    })());
  };

  /** Résultats des `count` derniers tours terminés, du plus récent au plus ancien (promesse de tableau). */
  PP.recent = async function (game, s, count) {
    if (!PP.online) {
      const last = s.phase === 'result' ? s.round : s.round - 1, out = [];
      for (let r = last; r > 0 && r > last - count; r--) out.push(PP.result(game, s.day, r));
      return out;
    }
    const expect = s.phase === 'result' ? s.round : s.round - 1;
    for (let i = 0; i < 4; i++) {
      try {
        const { rounds } = await http('GET', `/shop/rounds/${game}/latest?limit=${count}`);
        rounds.forEach((r) => remember(game, r));
        if (!expect || rounds.some((r) => r.round === expect && r.day === PP.dayKey(s.day)) || i === 3) return rounds.map((r) => r.result);
      } catch (e) { if (i === 3) return []; }
      await wait(400);
    }
    return [];
  };

  /* ---------- Caissier ---------- */
  const MESSAGES = {
    NETWORK: 'Serveur injoignable.',
    UNAUTHORIZED: 'Session expirée : se reconnecter.',
    FORBIDDEN: 'Action non autorisée pour ce compte.',
    INVALID_CREDENTIALS: 'E-mail ou mot de passe incorrect.',
    INVALID_TOTP: 'Code à 6 chiffres incorrect ou déjà utilisé.',
    INVALID_BET: 'Mise invalide.',
    STAKE_TOO_LOW: 'Mise trop basse.',
    STAKE_TOO_HIGH: 'Mise trop élevée.',
    TICKET_TOO_HIGH: 'Total du ticket trop élevé.',
    PAYOUT_LIMIT: 'Gain possible au-dessus du plafond.',
    UNKNOWN_TERMINAL: 'Caisse inconnue.',
    ROUND_CLOSED: 'Mises fermées pour ce tour.',
    TICKET_NOT_FOUND: 'Ticket introuvable.',
    ROUND_PENDING: 'Tour pas encore terminé.',
    TICKET_LOST: 'Ticket perdant.',
    ALREADY_PAID: 'Ticket déjà payé.',
    APPROVAL_REQUIRED: 'Gain au-dessus du seuil : un responsable doit décaisser.',
    VALIDATION_ERROR: 'Données invalides.',
  };

  const money = (c) => PP.money(c / 100);
  const A = PP.api = {
    base: BASE,
    get token() { try { return sessionStorage.getItem('pp.token'); } catch (e) { return null; } },
    set token(v) { try { v ? sessionStorage.setItem('pp.token', v) : sessionStorage.removeItem('pp.token'); } catch (e) { /* stockage bloqué */ } },
    message(e) {
      if (e.code === 'STAKE_TOO_LOW') return `Mise trop basse (minimum ${money(e.body.minCents)}).`;
      if (e.code === 'STAKE_TOO_HIGH') return `Mise trop élevée (maximum ${money(e.body.maxCents)}).`;
      if (e.code === 'TICKET_TOO_HIGH') return `Total du ticket au-dessus de ${money(e.body.maxCents)}.`;
      if (e.code === 'INVALID_BET' && e.body.reason) return 'Mise invalide : ' + e.body.reason + '.';
      if (e.code === 'ALREADY_PAID' && e.body.paidAt) return 'Ticket déjà payé le ' + PP.dateTime(e.body.paidAt, false) + '.';
      return MESSAGES[e.code] || 'Erreur ' + (e.code || e.message);
    },
    async login(email, password, totp) {
      const r = await http('POST', '/admin/auth/login', { email, password, totp });
      A.token = r.accessToken;
      return r;
    },
    logout() { A.token = null; },
    /** Un 401 efface la session : l'écran de connexion revient. */
    async call(method, path, body) {
      try { return await http(method, path, body, A.token); } catch (e) { if (e.status === 401) { A.token = null; if (A.onExpire) A.onExpire(); } throw e; }
    },
    sell: (game, terminal, lines, idempotencyKey) => A.call('POST', '/shop/tickets', { game, terminal, lines, idempotencyKey }),
    ticket: (id) => A.call('GET', '/shop/tickets/' + encodeURIComponent(id.trim().toUpperCase())),
    pay: (id, terminal) => A.call('POST', `/shop/tickets/${encodeURIComponent(id)}/pay`, { terminal }),
    list: (limit) => A.call('GET', '/shop/tickets?limit=' + limit),
    report: (day) => A.call('GET', '/shop/report' + (day ? '?day=' + day : '')),
  };

  /** Ticket du serveur (centimes, jour AAAA-MM-JJ) → ticket de l'écran (HTG, jour en ms), pour PP.ticketHTML. */
  PP.fromServerTicket = (t) => ({
    id: t.id, game: t.game, gameTicket: PP.GAMES[t.game].ticket, round: t.round, day: PP.dayStartOfKey(t.day),
    time: t.issuedAt, caisse: t.terminal, status: t.status === 'paid' ? 'paid' : 'open', serverStatus: t.status,
    win: t.winCents === undefined ? undefined : t.winCents / 100,
    lines: t.lines.map((l) => ({ key: l.key, label: l.label, picks: l.picks, odds: l.odds, stake: l.stakeCents / 100, possible: l.possibleCents / 100 })),
  });
})();
