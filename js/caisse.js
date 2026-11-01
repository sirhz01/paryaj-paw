/* Caisse : vente de tickets (4 jeux), impression avec logo, décaissement des gagnants.
   Connectée au serveur (js/api.js) : cotes, tour, gain et paiement viennent de lui.
   Sans serveur : mode démo, tickets en localStorage. */
PP.ready.then(function () {
  const R = PP.R, $ = (id) => document.getElementById(id), online = PP.online;
  let game = 'roulette', stake = 100;
  let slip = [];            // roulette : [{ key, stake }]
  let picks = [];           // autres jeux : numéros choisis
  let pendingCell = null;   // 1re case touchée en mode Cheval / Carré (2 touches)
  let payTicket = null;

  const NUM = {   // paramètres des grilles de numéros
    keno:     { max: 80, min: 1, maxPick: 10, text: 'Choisir de 1 à 10 numéros sur 80' },
    luckysix: { max: 48, min: 6, maxPick: 6,  text: 'Choisir exactement 6 numéros sur 48' },
    luckyx:   { max: 50, min: 1, maxPick: 10, text: 'Choisir de 1 à 10 numéros sur 50 (Normal mrc N)' },
  };

  /* ---------- En-tête ---------- */
  $('shopName').textContent = PP.SHOP.pointDeVente;
  if (online) {
    $('caisseSel').innerHTML = PP.SHOP.terminals.map((t) => `<option>${PP.esc(t)}</option>`).join('');
    $('stake').min = PP.LIMITS.min; $('stake').step = PP.LIMITS.min;
  } else $('demoBanner').classList.remove('hidden');
  const savedCaisse = localStorage.getItem('pp.caisse');
  if (savedCaisse) $('caisseSel').value = savedCaisse;
  $('caisseSel').addEventListener('change', (e) => localStorage.setItem('pp.caisse', e.target.value));

  /* ---------- Connexion du caissier (compte du back-office, rôle cashier) ---------- */
  const errText = (e) => (e && e.code === 'TICKET_NOT_FOUND') ? 'Ticket introuvable.' : PP.api.message(e);
  function needLogin() { $('login').classList.remove('hidden'); $('lgEmail').focus(); }
  PP.api.onExpire = needLogin;
  // Code à 6 chiffres désactivé côté serveur (STAFF_TOTP=off, hors production) : champ caché.
  if (online && PP.STAFF_TOTP === false) {
    $('lgCode').required = false;
    $('lgCode').closest('label').classList.add('hidden');
  }
  /* Compte lié à une caisse : la liste est figée sur celle-là (le serveur refuse les autres). */
  function lockTerminal(name) {
    try { name ? sessionStorage.setItem('pp.terminal', name) : sessionStorage.removeItem('pp.terminal'); } catch (e) { /* stockage bloqué */ }
    if (!name) { $('caisseSel').disabled = false; return; }
    if (![...$('caisseSel').options].some((o) => o.value === name)) $('caisseSel').add(new Option(name, name));
    $('caisseSel').value = name; $('caisseSel').disabled = true;
  }
  try { lockTerminal(online && PP.api.token ? sessionStorage.getItem('pp.terminal') : null); } catch (e) { /* stockage bloqué */ }
  if (online && !PP.api.token) needLogin();
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('lgMsg').textContent = ''; $('lgMsg').className = 'msg';
    try {
      const session = await PP.api.login($('lgEmail').value, $('lgPass').value, $('lgCode').value);
      lockTerminal(session.terminal);
      $('lgPass').value = ''; $('lgCode').value = '';
      $('login').classList.add('hidden');
      renderHistory();
    } catch (err) { $('lgMsg').textContent = PP.api.message(err); $('lgMsg').className = 'msg err'; }
  });
  $('logoutBtn').classList.toggle('hidden', !online);
  $('logoutBtn').addEventListener('click', async () => { await PP.api.endShift(); lockTerminal(null); needLogin(); });

  /* ---------- Onglets ---------- */
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => {
    game = b.dataset.g;
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    slip = []; picks = []; clearPending();
    renderBoard(); renderSlip();
  }));

  /* ---------- Mises ---------- */
  $('chips').innerHTML = PP.STAKES.map((v) => `<button data-v="${v}">${v}</button>`).join('');
  function syncChips() { document.querySelectorAll('#chips button').forEach((b) => b.classList.toggle('on', +b.dataset.v === stake)); }
  $('chips').addEventListener('click', (e) => { if (e.target.dataset.v) { stake = +e.target.dataset.v; $('stake').value = stake; syncChips(); renderSlip(); } });
  $('stake').addEventListener('input', () => { stake = Math.max(0, Number($('stake').value) || 0); syncChips(); renderSlip(); });
  syncChips();

  /* ---------- Plateau ---------- */
  R.buildTable($('rtable'), onRouletteCell);
  const mode = () => document.querySelector('input[name=mode]:checked').value;
  // Changer de mode annule une 1re touche de Cheval / Carré restée en attente.
  document.getElementById('modes').addEventListener('change', clearPending);

  function clearPending() { pendingCell = null; highlightPending(null); }
  function highlightPending(key) {
    document.querySelectorAll('#rtable .rc.pending').forEach((c) => c.classList.remove('pending'));
    if (key) { const c = document.querySelector(`#rtable .rc[data-key="${key}"]`); if (c) c.classList.add('pending'); }
  }
  function addKey(key) {
    if (!stake) return flash('Choisir une mise', true);
    const l = slip.find((x) => x.key === key);
    if (l) l.stake += stake; else slip.push({ key, stake });
    renderSlip();
  }

  function onRouletteCell(key) {
    const m = mode();
    const isNum = key.startsWith('n:');
    // Cheval / Carré : deux touches sur des numéros (0 et 00 compris pour le cheval).
    if ((m === 'sp' || m === 'co') && isNum) {
      const tok = key.slice(2);
      if (pendingCell === null) return (pendingCell = tok), highlightPending(key);
      if (pendingCell === tok) return clearPending();                 // retoucher la même case annule
      const combo = m === 'sp' ? R.splitKey(pendingCell, tok) : R.cornerKey(pendingCell, tok);
      clearPending();
      if (!combo) return flash(m === 'sp' ? 'Cheval : toucher deux numéros voisins' : 'Carré : toucher deux numéros en diagonale', true);
      return addKey(combo);
    }
    // Street / Six lignes : une touche sur un numéro (hors 0 et 00).
    if (isNum && !['n:0', 'n:00'].includes(key) && (m === 'st' || m === 'six')) {
      const x = +key.slice(2), s = x - ((x - 1) % 3);
      key = m === 'st' ? 'st:' + s : 'six:' + Math.min(s, 31);
    }
    addKey(key);
  }

  function renderBoard() {
    const rou = game === 'roulette';
    $('boardRoulette').classList.toggle('hidden', !rou);
    $('boardNumbers').classList.toggle('hidden', rou);
    if (rou) return;
    const c = NUM[game];
    $('needTxt').textContent = c.text;
    $('quickN').innerHTML = Array.from({ length: c.maxPick - c.min + 1 }, (_, i) => `<option>${c.min + i}</option>`).join('');
    $('quickN').value = c.maxPick;
    $('nums').innerHTML = Array.from({ length: c.max }, (_, i) => {
      const n = i + 1, col = game === 'keno' ? '' : `colored" style="--c:${PP.ballColor(n)};--txt:${PP.ballText(n)}`;
      return `<button class="${col}" data-n="${n}">${n}</button>`;
    }).join('');
    syncNums();
  }
  function syncNums() { document.querySelectorAll('#nums button').forEach((b) => b.classList.toggle('sel', picks.includes(+b.dataset.n))); }

  $('nums').addEventListener('click', (e) => {
    const n = +e.target.dataset.n; if (!n) return;
    const i = picks.indexOf(n);
    if (i >= 0) picks.splice(i, 1);
    else if (picks.length < NUM[game].maxPick) picks.push(n);
    else return flash(`Maximum ${NUM[game].maxPick} numéros`, true);
    syncNums(); renderSlip();
  });
  $('quickBtn').addEventListener('click', () => {
    const c = NUM[game], count = +$('quickN').value;
    picks = [];
    while (picks.length < count) { const n = PP.randInt(c.max) + 1; if (!picks.includes(n)) picks.push(n); }
    syncNums(); renderSlip();
  });
  $('clearPicks').addEventListener('click', () => { picks = []; syncNums(); renderSlip(); });

  /* ---------- Ticket en cours ---------- */
  function currentLines() {
    if (game === 'roulette') return slip.map((l) => PP.bets.rouletteLine(l.key, l.stake));
    if (!picks.length) return [];
    return [PP.bets.numbersLine(game, picks, stake)];
  }
  function renderSlip() {
    const lines = currentLines();
    $('slip').innerHTML = lines.length ? lines.map((l, i) => `
      <div class="ln"><b>${l.label}</b><span>${PP.money(l.stake)}</span>${game === 'roulette' ? `<button data-i="${i}" title="Retirer">✕</button>` : '<span></span>'}
        <small>${l.picks.join(' ')} · cote ${l.odds.toFixed(2)} · gain possible ${PP.money(l.possible)}</small></div>`).join('')
      : '<div class="empty">Aucune mise. Choisir sur le plateau.</div>';
    $('total').textContent = PP.money(lines.reduce((a, l) => a + l.stake, 0));
    if (game === 'roulette') document.querySelectorAll('#rtable .rc').forEach((c) => {
      const keys = slip.filter((l) => l.key === c.dataset.key || (/^(sp|st|co|six):/.test(l.key) && c.dataset.key.startsWith('n:') && R.keyNumbers(l.key).includes(c.dataset.key.slice(2))));
      c.classList.toggle('sel', keys.length > 0);
      const own = slip.find((l) => l.key === c.dataset.key);
      if (own) c.dataset.stake = own.stake; else delete c.dataset.stake;
    });
  }
  $('slip').addEventListener('click', (e) => { const i = e.target.dataset.i; if (i !== undefined) { slip.splice(+i, 1); renderSlip(); } });
  $('resetBtn').addEventListener('click', () => { slip = []; picks = []; clearPending(); syncNums(); renderSlip(); flash(''); });

  function flash(text, err) { const m = $('msg'); m.textContent = text; m.className = 'msg' + (err ? ' err' : text ? ' ok' : ''); }

  /* ---------- Impression ---------- */
  /* Même clé tant que la vente n'a pas abouti : un renvoi après coupure ne crée jamais un second ticket. */
  let pending = null;
  async function sellOnline(lines) {
    const body = lines.map((l) => ({ ...(game === 'roulette' ? { key: l.key } : { picks: l.picks }), stakeCents: Math.round(l.stake * 100) }));
    const terminal = $('caisseSel').value, sig = game + '|' + terminal + '|' + JSON.stringify(body);
    if (!pending || pending.sig !== sig) pending = { sig, key: 'v' + PP.newId() + Date.now().toString(36) };
    const t = PP.fromServerTicket(await PP.api.sell(game, terminal, body, pending.key));
    pending = null;
    return t;
  }
  function sellLocal(lines) {
    const s = PP.state(game);
    const round = s.phase === 'bet' && s.left > 2 ? s.round : s.round + 1;   // mises fermées → tour suivant
    const t = {
      id: PP.newId(), game, gameTicket: PP.GAMES[game].ticket, round, day: s.day, time: PP.now(),
      caisse: $('caisseSel').value, lines, status: 'open',
    };
    PP.tickets.add(t);
    return t;
  }

  $('printBtn').addEventListener('click', async () => {
    const lines = currentLines();
    if (!lines.length) return flash('Ticket vide', true);
    if (game !== 'roulette') {
      const c = NUM[game];
      if (picks.length < c.min) return flash(`Il faut au moins ${c.min} numéro(s)`, true);
      if (!stake) return flash('Choisir une mise', true);
    }
    const btn = $('printBtn');
    btn.disabled = true;
    let t;
    try { t = online ? await sellOnline(lines) : sellLocal(lines); }
    catch (e) { return flash(errText(e), true); }
    finally { btn.disabled = false; }
    showTicket(PP.ticketHTML(t));
    PP.printHTML(PP.ticketHTML(t));
    slip = []; picks = []; syncNums(); renderSlip();
    flash(`Ticket ${t.id} imprimé · tour ${t.round}`);
    renderHistory();
  });

  function showTicket(html) {
    let st = document.getElementById('tkStyle');
    if (!st) { st = document.createElement('style'); st.id = 'tkStyle'; st.textContent = PP.ticketCSS; document.head.appendChild(st); }
    $('paper').innerHTML = html;
  }

  /* ---------- Décaissement ---------- */
  function setPay(text, cls) { const m = $('payMsg'); m.textContent = text; m.className = 'msg ' + (cls || ''); }

  /** { t, state: 'pending' | 'lost' | 'won' | 'paid', win } depuis le serveur, ou depuis le stockage local en démo. */
  async function lookup(raw) {
    // Un scanner peut envoyer l'adresse du QR (…/t/CODE) ou des espaces : on garde le code seul ; vide = introuvable.
    // Un scanner Code 39 peut ajouter les * de début/fin ; on ne garde que lettres et chiffres.
    const id = (String(raw || '').trim().split(/[/?#]/).filter(Boolean).pop() || '').replace(/[^A-Za-z0-9-]/g, '');
    if (!id) throw { code: 'TICKET_NOT_FOUND', body: {} };
    if (online) {
      const t = PP.fromServerTicket(await PP.api.ticket(id));
      return { t, state: t.serverStatus, win: t.win || 0 };
    }
    const t = PP.tickets.find(id);
    if (!t) throw { code: 'TICKET_NOT_FOUND', body: {} };
    if (t.status === 'paid') return { t, state: 'paid', win: 0 };
    const r = PP.bets.settle(t);
    return { t, state: r.state, win: r.win };
  }
  async function checkTicket(id) {
    $('payBtn').classList.add('hidden'); payTicket = null;
    let r;
    try { r = await lookup(id || $('payId').value); } catch (e) { return setPay(errText(e), 'err'); }
    recent[r.t.id] = r.t;
    if (r.state === 'paid') return setPay('Ticket déjà payé.', 'err');
    if (r.state === 'pending') return setPay(`Tour ${r.t.round} pas encore terminé.`, 'err');
    if (r.state === 'lost') return setPay('Ticket perdant.', 'err');
    payTicket = { t: r.t, win: r.win };
    setPay(`Ticket gagnant : ${PP.money(r.win)}`, 'ok');
    $('payBtn').classList.remove('hidden');
  }
  $('checkBtn').addEventListener('click', () => checkTicket());
  $('payId').addEventListener('keydown', (e) => { if (e.key === 'Enter') checkTicket(); });
  // Le scanner tape le code comme un clavier : s'il part ailleurs que dans un champ, on le redirige vers « ID de ticket ».
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || !/[A-Za-z0-9*]/.test(e.key)) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || !$('login').classList.contains('hidden')) return;
    $('payId').focus(); $('payId').select();
  });
  $('payBtn').addEventListener('click', async () => {
    if (!payTicket) return;
    const { t, win } = payTicket, btn = $('payBtn');
    btn.disabled = true;
    try {
      if (online) await PP.api.pay(t.id, $('caisseSel').value);
      else { t.status = 'paid'; t.paidAt = PP.now(); PP.tickets.update(t); }
    } catch (e) { return setPay(errText(e), 'err'); }
    finally { btn.disabled = false; }
    const html = PP.payoutHTML(t, win);
    showTicket(html); PP.printHTML(html);
    btn.classList.add('hidden'); payTicket = null;
    setPay(`Décaissement de ${PP.money(win)} imprimé.`, 'ok');
    renderHistory();
  });

  /* ---------- Historique ---------- */
  const LABEL = { open: 'En cours', won: 'Gagnant', lost: 'Perdant', paid: 'Payé' };
  const recent = {};   // tickets affichés, par ID, pour rouvrir l'aperçu
  async function renderHistory() {
    let rows;
    if (online) {
      if (!PP.api.token) return;
      try { rows = (await PP.api.list(15)).map((t) => PP.fromServerTicket(t)).map((t) => [t, t.serverStatus === 'pending' ? 'open' : t.serverStatus]); }
      catch (e) { return; }
    } else {
      rows = PP.tickets.all().slice(-15).reverse().map((t) => [t, t.status === 'paid' ? 'paid' : (({ pending: 'open', won: 'won', lost: 'lost' })[PP.bets.settle(t).state])]);
    }
    rows.forEach(([t]) => { recent[t.id] = t; });
    $('hist').innerHTML = rows.map(([t, st]) => `<tr data-id="${t.id}"><td><b>${t.id}</b></td><td>${t.gameTicket}</td><td>${t.round}</td>
        <td>${PP.money(t.lines.reduce((a, l) => a + l.stake, 0))}</td><td><span class="st ${st}">${LABEL[st]}</span></td></tr>`).join('')
      || '<tr><td colspan="5" class="hint">Aucun ticket.</td></tr>';
  }
  $('hist').addEventListener('click', (e) => {
    const tr = e.target.closest('tr'); if (!tr || !tr.dataset.id) return;
    $('payId').value = tr.dataset.id; checkTicket(tr.dataset.id);
    const t = recent[tr.dataset.id]; if (t) showTicket(PP.ticketHTML(t));
  });

  /* ---------- Horloge du tour ---------- */
  setInterval(() => {
    const s = PP.state(game), open = s.phase === 'bet' && s.left > (PP.CLOSE_MARGIN || 2);
    $('roundTxt').textContent = `${PP.GAMES[game].name} · Tour ${open ? s.round : s.round + 1}`;
    const p = $('roundLeft'); p.classList.toggle('closed', !open);
    const toNext = (s.start + PP.cycle(game) * 1000 - PP.now()) / 1000;   // ouverture des mises du tour suivant
    p.textContent = open ? 'Mises ouvertes · ' + PP.clock(s.left) : 'Mises fermées · ouverture dans ' + PP.clock(toNext);
    $('clock').textContent = PP.dateTime(PP.now());
  }, 500);
  setInterval(renderHistory, 5000);

  renderBoard(); renderSlip(); renderHistory();
});
