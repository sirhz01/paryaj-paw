/* Horloge des tours, tirages, stockage, barre du haut.
   PP.result() est un SIMULATEUR côté navigateur (graine déterministe par tour) pour que l'écran TV
   et la caisse voient le même résultat sans serveur. En production : remplacer par un appel API,
   le tirage doit rester côté serveur (cf. cahier des charges, §3 et §5). */
(function () {
  const PP = window.PP;

  /* ?shift=SECONDES décale l'horloge (démo / tests). PP.offset = écart avec l'horloge du serveur (js/api.js). */
  const shift = Number(new URLSearchParams(location.search).get('shift')) || 0;
  PP.offset = 0;
  PP.now = () => Date.now() + PP.offset + shift * 1000;

  /* ---------- Jour d'Haïti : les tours repartent de 1 à minuit, heure de Port-au-Prince ---------- */
  const TZ = 'America/Port-au-Prince';
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fields = (ms) => Object.fromEntries(fmt.formatToParts(ms).map((x) => [x.type, Number(x.value)]));
  /** 'AAAA-MM-JJ' du jour d'Haïti contenant ms. */
  PP.dayKey = (ms) => { const f = fields(ms); return f.year + '-' + String(f.month).padStart(2, '0') + '-' + String(f.day).padStart(2, '0'); };
  /** Minuit (ms) du jour d'Haïti 'AAAA-MM-JJ'. */
  PP.dayStartOfKey = (key) => {
    const [y, m, d] = key.split('-').map(Number), wall = Date.UTC(y, m - 1, d);
    let g = wall;
    for (let i = 0; i < 3; i++) { const f = fields(g); g += wall - Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second); }
    return g;
  };
  /* La boucle d'écran appelle PP.state dix fois par seconde : on garde le dernier jour calculé. */
  let known = { start: NaN, end: NaN };
  const nextDayStart = (day) => PP.dayStartOfKey(PP.dayKey(day + 36 * 3600 * 1000));
  PP.dayStart = (ms) => {
    if (ms >= known.start && ms < known.end) return known.start;
    const start = PP.dayStartOfKey(PP.dayKey(ms));
    known = { start, end: nextDayStart(start) };
    return start;
  };
  PP.dayEnd = (day) => (day === known.start ? known.end : nextDayStart(day));
  /** Nombre de tours complets dans le jour ; le reste de la journée prolonge le dernier résultat. */
  PP.roundsInDay = (game, day) => Math.floor((PP.dayEnd(day) - day) / (PP.cycle(game) * 1000));

  /* ---------- PRNG à graine ---------- */
  function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
  }
  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  PP.rng = (seed) => mulberry32(xmur3(seed)());
  PP.randInt = (n) => { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] % n; };

  function sample(rnd, max, count) {
    const pool = Array.from({ length: max }, (_, i) => i + 1);
    for (let i = 0; i < count; i++) {
      const j = i + Math.floor(rnd() * (max - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, count);
  }

  /* ---------- Tours ---------- */
  PP.cycle = (g) => PP.GAMES[g].bet + PP.GAMES[g].draw + PP.GAMES[g].result;

  PP.state = function (game, now = PP.now()) {
    const g = PP.GAMES[game], cyc = PP.cycle(game) * 1000;
    const day = PP.dayStart(now), last = PP.roundsInDay(game, day) - 1;
    const el = now - day, idx = Math.min(Math.floor(el / cyc), last), t = el - idx * cyc;
    const b = g.bet * 1000, d = g.draw * 1000, r = idx === last ? PP.dayEnd(day) - day - idx * cyc - b - d : g.result * 1000;
    let phase, pt, dur;
    if (t < b) { phase = 'bet'; pt = t; dur = b; }
    else if (t < b + d) { phase = 'draw'; pt = t - b; dur = d; }
    else { phase = 'result'; pt = t - b - d; dur = r; }
    return { game, day, round: idx + 1, phase, t: pt / 1000, dur: dur / 1000, left: (dur - pt) / 1000, start: day + idx * cyc };
  };

  /* Le résultat d'un tour est connu une fois la phase de tirage terminée. */
  PP.isComplete = (game, day, round, now = PP.now()) => {
    const g = PP.GAMES[game];
    return now >= day + (round - 1) * PP.cycle(game) * 1000 + (g.bet + g.draw) * 1000;
  };

  /* Résultats reçus du serveur, par tour (js/api.js). Hors ligne : tirage simulé ci-dessous. */
  PP.cache = {};
  PP.roundKey = (game, day, round) => game + '|' + PP.dayKey(day) + '|' + round;

  PP.result = function (game, day, round) {
    if (PP.online) return PP.cache[PP.roundKey(game, day, round)];
    const rnd = PP.rng(`${game}|${day}|${round}|paryaj-paw`);
    switch (game) {
      case 'roulette': return { n: PP.R.ORDER[Math.floor(rnd() * 38)] };
      case 'keno': return { draw: sample(rnd, 80, 20) };
      case 'luckysix': return { draw: sample(rnd, 48, 35) };
      case 'luckyx': return { draw: sample(rnd, 50, 36) };
    }
  };

  /* ---------- Formats ---------- */
  /** Échappe un texte venant des réglages ou du serveur avant de l'insérer dans du HTML. */
  PP.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  PP.money = (n) => Number(n).toFixed(2) + ' HTG';
  PP.clock = (sec) => { sec = Math.max(0, Math.ceil(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
  PP.short = (n) => n >= 1000 ? (n / 1000).toString().replace(/\.0$/, '') + 'K' : String(n);
  PP.dateTime = (ms, withSec = true) => {
    const d = new Date(ms), p = (x) => String(x).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}` + (withSec ? ':' + p(d.getSeconds()) : '');
  };
  PP.ballColor = (n) => PP.COLORS[n % 8];
  PP.ballText = (n) => (n % 8 === 6 || n % 8 === 3) ? '#10161c' : '#fff';
  /* Lucky X (50 boules) : 5 couleurs selon le reste de n ÷ 5 — 1 rouge, 2 bleu, 3 vert, 4 jaune, 5 mauve. */
  const LX_COLORS = { 1: '#e53935', 2: '#2740d6', 3: '#1fbf55', 4: '#f2d31b', 0: '#8e44ad' };
  PP.lxColor = (n) => LX_COLORS[n % 5];
  PP.lxText = (n) => (n % 5 === 4 ? '#10161c' : '#fff');

  /* ---------- Boucle d'écran ---------- */
  PP.run = function (game, h) {
    let last = null;
    const tick = () => {
      const s = PP.state(game);
      const key = s.day + ':' + s.round + ':' + s.phase;
      if (key !== last) { h.onPhase && h.onPhase(s, last === null); last = key; }
      h.onTick && h.onTick(s);
    };
    tick(); setInterval(tick, 100);
  };

  /* ---------- Barre du haut ---------- */
  /* Numéro de tour affiché : après 1000, on recommence à 1 (affichage seulement ; le tour réel garde son numéro pour les tickets et les rapports). */
  PP.roundNo = (n) => ((Math.max(1, n) - 1) % 1000) + 1;

  PP.topbar = function (title) {
    const el = document.getElementById('topbar');
    el.innerHTML = `
      <a class="brand" href="index.html" title="Accueil"><img src="assets/logo.jpg" alt="La Référence Paryaj Paw"></a>
      <div class="title">${title}</div>
      <div class="meta"><span class="lbl">ROUND<br>NUMBER</span><b id="tbRound">–</b><span class="status" id="tbStatus"></span></div>`;
    const r = el.querySelector('#tbRound'), st = el.querySelector('#tbStatus');
    return (s) => {
      r.textContent = PP.roundNo(s.round);
      st.textContent = s.phase === 'bet' ? 'CLOSES IN ' + PP.clock(s.left) : s.phase === 'draw' ? 'DRAWING' : 'COMPLETED';
    };
  };

  document.addEventListener('keydown', (e) => {
    // Pas dans un champ : un scanner ou le caissier tape des codes qui contiennent des F.
    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen();
    }
  });

  /* ---------- Tickets (localStorage) ---------- */
  const KEY = 'pp.tickets';
  PP.tickets = {
    all() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } },
    save(list) { try { localStorage.setItem(KEY, JSON.stringify(list.slice(-300))); } catch (e) { /* stockage plein ou bloqué */ } },
    add(t) { const l = this.all(); l.push(t); this.save(l); },
    find(id) { return this.all().find((t) => t.id === id.trim().toUpperCase()); },
    update(t) { const l = this.all().map((x) => x.id === t.id ? t : x); this.save(l); },
  };
  PP.newId = () => {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = ''; for (let i = 0; i < 9; i++) s += A[PP.randInt(A.length)];
    return s;
  };
})();
