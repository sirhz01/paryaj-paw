/* Administration : rapport de fin de journée, réglages (caisses, limites) et taux de gain.
   Parle au back-end (GET/PUT /admin/shop/settings, GET /admin/shop/dashboard, GET /shop/report) ; demande une connexion
   du back-office. Sans serveur, rien à administrer. Seul le rôle super_admin modifie ; finance et auditor consultent. */
PP.ready.then(function () {
  const $ = (id) => document.getElementById(id), A = PP.api;
  const cents = (c) => PP.money(c / 100), esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const toCents = (v) => Math.round(Number(v) * 100);
  const htg = (c) => String(c / 100);
  const GAMES = { roulette: 'Roulette', keno: 'Keno', luckysix: 'Lucky Six', luckyx: 'Lucky X' };
  const today = () => PP.dayKey(Date.now() + (PP.offset || 0));
  const addDays = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  let settings = null, role = '', terminals = [], timingPlan = null;

  function roleOf() {
    try { return JSON.parse(atob(A.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role || ''; } catch (e) { return ''; }
  }
  const canEdit = () => role === 'super_admin';
  const flash = (el, text, ok) => { el.textContent = text; el.className = 'msg ' + (ok ? 'ok' : 'err'); };
  const errorText = (e) => e.code === 'INVALID_SETTINGS' && e.body.errors ? e.body.errors.join(' · ') : A.message(e);

  /* ---------- Connexion ---------- */
  function showLogin(msg) {
    $('login').classList.remove('hidden');
    $('logoutBtn').classList.add('hidden');
    $('lTotpRow').classList.toggle('hidden', !PP.STAFF_TOTP);
    $('lMsg').textContent = msg || (PP.online ? '' : 'Serveur injoignable : l’administration demande le serveur.');
  }
  A.onExpire = () => showLogin('Session expirée : se reconnecter.');
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await A.login($('lEmail').value.trim(), $('lPass').value, $('lTotp').value.trim());
      $('lPass').value = $('lTotp').value = '';
      $('login').classList.add('hidden');
      start();
    } catch (err) { $('lMsg').textContent = A.message(err); }
  });
  /* Recharger efface rapports, réglages et caissiers restés dans la page. */
  $('logoutBtn').addEventListener('click', () => { A.logout(); location.reload(); });

  /* ---------- Onglets ---------- */
  $('tabs').addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    [...$('tabs').children].forEach((b) => b.classList.toggle('on', b === t));
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + t.dataset.tab));
    // Rafraîchit la liste et les caisses attribuables à l'ouverture de l'onglet Caissiers.
    if (t.dataset.tab === 'cashiers' && canEdit()) loadCashiers();
  });

  /* ---------- Rapport ---------- */
  async function loadReport() {
    const day = $('repDay').value || today();
    try {
      const r = await A.report(day);
      const rows = r.terminals.map((t) => `<tr><td>${esc(t.terminal)}</td><td>${t.tickets}</td><td>${cents(t.stakesCents)}</td><td>${t.payouts}</td><td>${cents(t.payoutsCents)}</td><td class="${t.stakesCents - t.payoutsCents < 0 ? 'neg' : 'pos'}">${cents(t.stakesCents - t.payoutsCents)}</td></tr>`).join('');
      const s = r.totals, net = s.stakesCents - s.payoutsCents;
      $('repTbl').innerHTML = '<thead><tr><th>Caisse</th><th>Tickets vendus</th><th>Ventes</th><th>Gains payés (nb)</th><th>Gains payés</th><th>Net en caisse</th></tr></thead><tbody>'
        + (rows || '<tr><td colspan="6">Aucune vente ce jour-là.</td></tr>')
        + `<tr class="sum"><td>Total</td><td>${s.tickets}</td><td>${cents(s.stakesCents)}</td><td>${s.payouts}</td><td>${cents(s.payoutsCents)}</td><td class="${net < 0 ? 'neg' : 'pos'}">${cents(net)}</td></tr></tbody>`;
      const u = r.unclaimedWinners;
      $('repUnclaimed').textContent = u.count ? `${u.count} ticket(s) gagnant(s) pas encore réclamé(s) : ${cents(u.cents)} à prévoir.` : 'Aucun gain en attente de paiement.';
    } catch (e) { $('repTbl').innerHTML = `<tr><td class="neg">${esc(A.message(e))}</td></tr>`; }
  }

  let rangeRows = [];
  async function loadRange() {
    try {
      rangeRows = await A.call('GET', `/admin/shop/dashboard?from=${$('rngFrom').value}&to=${$('rngTo').value}`);
      const sum = { tickets: 0, stakesCents: 0, winsCents: 0, paidCents: 0, ggrCents: 0 };
      const body = rangeRows.map((r) => {
        for (const k of Object.keys(sum)) sum[k] += Number(r[k]);
        return `<tr><td>${r.day}</td><td>${GAMES[r.game] || esc(r.game)}</td><td>${r.tickets}</td><td>${cents(r.stakesCents)}</td><td>${cents(r.winsCents)}</td><td>${cents(r.paidCents)}</td><td class="${r.ggrCents < 0 ? 'neg' : 'pos'}">${cents(r.ggrCents)}</td></tr>`;
      }).join('');
      $('rngTbl').innerHTML = '<thead><tr><th>Jour</th><th>Jeu</th><th>Tickets</th><th>Mises</th><th>Gains dus</th><th>Payé</th><th>Bénéfice</th></tr></thead><tbody>'
        + (body || '<tr><td colspan="7">Aucune vente sur cette période.</td></tr>')
        + `<tr class="sum"><td colspan="2">Total</td><td>${sum.tickets}</td><td>${cents(sum.stakesCents)}</td><td>${cents(sum.winsCents)}</td><td>${cents(sum.paidCents)}</td><td class="${sum.ggrCents < 0 ? 'neg' : 'pos'}">${cents(sum.ggrCents)}</td></tr></tbody>`;
    } catch (e) { $('rngTbl').innerHTML = `<tr><td class="neg">${esc(A.message(e))}</td></tr>`; }
  }
  $('printBtn').addEventListener('click', () => window.print());
  $('repGo').addEventListener('click', loadReport);
  $('repDay').addEventListener('change', loadReport);
  $('rngGo').addEventListener('click', loadRange);
  $('rngCsv').addEventListener('click', () => {
    const head = 'jour;jeu;tickets;mises_htg;gains_dus_htg;payes_htg;benefice_htg';
    const csv = [head].concat(rangeRows.map((r) => [r.day, r.game, r.tickets, r.stakesCents / 100, r.winsCents / 100, r.paidCents / 100, r.ggrCents / 100].join(';'))).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `rapport_${$('rngFrom').value}_${$('rngTo').value}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  /* ---------- Réglages ---------- */
  function renderTerminals() {
    $('terms').innerHTML = terminals.map((t, i) => `<div class="t"><input value="${esc(t)}" maxlength="32" data-i="${i}" aria-label="Nom de la caisse ${i + 1}"><button type="button" data-del="${i}" title="Retirer"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>`).join('');
    $('termCount').textContent = `(${terminals.length})`;
    $('terms').querySelectorAll('input,button').forEach((el) => { el.disabled = !canEdit(); });
    $('termAdd').disabled = !canEdit();
  }
  $('terms').addEventListener('input', (e) => { if (e.target.dataset.i !== undefined) terminals[+e.target.dataset.i] = e.target.value; });
  $('terms').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    if (terminals.length === 1) return flash($('setMsg'), 'Il faut au moins une caisse.', false);
    terminals.splice(+b.dataset.del, 1); renderTerminals();
  });
  $('termAdd').addEventListener('click', () => { terminals.push('CAISSE #' + (terminals.length + 1)); renderTerminals(); });

  /* ---------- Temps de chaque jeu ---------- */
  const MIN_DRAW = { roulette: 11, keno: 30, luckysix: 32, luckyx: 24 };
  const tmText = (t) => Object.keys(GAMES).map((g) => GAMES[g] + ' ' + t[g].bet + '/' + t[g].draw + '/' + t[g].result).join(' · ');
  function renderTimings(t) {
    $('timings').innerHTML = '<div class="tmrow tmhead"><span></span><span>Durée du tour (minutes)</span><span>Mises</span><span>Tirage (min.)</span><span>Résultat</span></div>'
      + Object.keys(GAMES).map((g) => '<div class="tmrow"><b>' + GAMES[g] + '</b>'
        + '<input type="number" min="0.5" max="35" step="any" class="tmtotal" id="tm:' + g + ':total" value="' + +((t[g].bet + t[g].draw + t[g].result) / 60).toFixed(2) + '" aria-label="' + GAMES[g] + ' : durée totale d’un tour en minutes">'
        + '<input type="number" min="10" max="1800" step="1" id="tm:' + g + ':bet" value="' + t[g].bet + '" aria-label="' + GAMES[g] + ' : durée des mises">'
        + '<span class="tmdraw"><input type="number" min="' + MIN_DRAW[g] + '" max="120" step="1" id="tm:' + g + ':draw" value="' + t[g].draw + '" aria-label="' + GAMES[g] + ' : durée du tirage"><small>' + MIN_DRAW[g] + '</small></span>'
        + '<input type="number" min="5" max="120" step="1" id="tm:' + g + ':result" value="' + t[g].result + '" aria-label="' + GAMES[g] + ' : durée du résultat"></div>').join('');
    $('timings').querySelectorAll('input').forEach((el) => { el.disabled = !canEdit(); });
    /* Durée du tour en minutes : les secondes de « Mises » s'ajustent (durée − tirage − résultat) ; l'inverse met la durée à jour. */
    for (const g of Object.keys(GAMES)) {
      const v = (k) => $('tm:' + g + ':' + k);
      v('total').addEventListener('input', () => { v('bet').value = Math.round(Number(v('total').value) * 60 - Number(v('draw').value) - Number(v('result').value)); });
      ['bet', 'draw', 'result'].forEach((k) => v(k).addEventListener('input', () => { v('total').value = +((Number(v('bet').value) + Number(v('draw').value) + Number(v('result').value)) / 60).toFixed(2); }));
    }
    if (timingPlan) {
      $('timingsPlan').textContent = 'Aujourd’hui (mises/tirage/résultat) : ' + tmText(timingPlan.today)
        + (JSON.stringify(timingPlan.today) === JSON.stringify(timingPlan.tomorrow) ? '. Demain : pareil.' : '. Demain : ' + tmText(timingPlan.tomorrow) + '.');
    }
  }
  const readTimings = () => {
    const out = {};
    for (const g of Object.keys(GAMES)) out[g] = { bet: Number($('tm:' + g + ':bet').value), draw: Number($('tm:' + g + ':draw').value), result: Number($('tm:' + g + ':result').value) };
    return out;
  };

  function fillSettings(s) {
    $('fPos').value = s.pointOfSale; $('fIssuer').value = s.issuer;
    terminals = s.terminals.slice(); renderTerminals();
    $('fStakes').value = s.stakesCents.map(htg).join(', ');
    $('fMin').value = htg(s.minStakeCents); $('fMax').value = htg(s.maxStakeCents); $('fTicket').value = htg(s.maxTicketCents);
    $('fPayout').value = htg(s.maxPayoutCents); $('fApproval').value = htg(s.approvalThresholdCents);
    $('fTop').checked = s.topLineEnabled;
    renderTimings(s.timings);
    document.querySelectorAll('#setForm input, #setForm .save').forEach((el) => { if (!el.closest('.terms')) el.disabled = !canEdit(); });
  }

  async function save(patch, msgEl) {
    const { version, createdAt, ...base } = settings;
    try {
      const r = await A.call('PUT', '/admin/shop/settings', { ...base, ...patch });
      timingPlan = r.timings; settings = r.settings; fillSettings(settings); fillRates(settings); renderRtp(r.rtp);
      flash(msgEl, 'Enregistré (version ' + settings.version + '). Les écrans et la caisse le prennent au prochain rechargement ; les nouveaux temps de jeu à partir de demain 00:00.', true);
    } catch (e) { flash(msgEl, errorText(e), false); }
  }
  $('setForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const names = terminals.map((t) => t.trim().toUpperCase());
    if (names.some((n) => !n) || new Set(names).size !== names.length) return flash($('setMsg'), 'Chaque caisse doit avoir un nom différent.', false);
    const stakes = $('fStakes').value.split(/[,;\s]+/).filter(Boolean).map(toCents);
    save({
      pointOfSale: $('fPos').value.trim(), issuer: $('fIssuer').value.trim(), terminals: names, stakesCents: stakes,
      minStakeCents: toCents($('fMin').value), maxStakeCents: toCents($('fMax').value), maxTicketCents: toCents($('fTicket').value),
      maxPayoutCents: toCents($('fPayout').value), approvalThresholdCents: toCents($('fApproval').value), topLineEnabled: $('fTop').checked, timings: readTimings(),
    }, $('setMsg'));
  });

  /* ---------- Taux de gain ---------- */
  const rateBox = (label, name, value) => `<label class="rate">${label}<input type="number" min="0" step="any" name="${name}" value="${value === undefined ? '' : value}" ${canEdit() ? '' : 'disabled'}></label>`;
  /* Keno 20/80 : probabilité exacte de trouver h numéros sur n choisis (loi hypergéométrique). */
  const choose = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
  const kenoP = (n, h) => choose(20, h) * choose(60, n - h) / choose(80, n);
  /** Premier nombre de numéros trouvés qui gagne, selon le nombre de numéros choisis (usage des tables internationales). */
  const KENO_FROM = { 1: 1, 2: 2, 3: 2, 4: 2, 5: 3, 6: 3, 7: 3, 8: 4, 9: 4, 10: 5 };
  const KENO_DECAY = 0.55;
  const floorTo = (c) => { const step = c < 10 ? 0.1 : c < 100 ? 0.5 : c < 1000 ? 1 : 5; return Math.round(Math.floor(c / step) * step * 100) / 100; };

  /** Coefficients d'une ligne : le retour visé est réparti sur les niveaux gagnants (les plus fréquents en reçoivent le plus), arrondis vers le bas. */
  function kenoRow(n, rtp) {
    const from = KENO_FROM[n], weights = {};
    let total = 0;
    for (let h = from; h <= n; h++) { weights[h] = Math.pow(KENO_DECAY, h - from); total += weights[h]; }
    const row = {};
    for (let h = from; h <= n; h++) { const c = floorTo(rtp * (weights[h] / total) / kenoP(n, h)); if (c > 0) row[h] = c; }
    return row;
  }
  const kenoRtpOf = (n, row) => Object.entries(row).reduce((s, [h, c]) => s + kenoP(n, +h) * c, 0) * 100;
  function showKenoRtp(n) {
    const row = {};
    for (let h = 0; h <= n; h++) { const v = Number($('rateForm').elements[`k:${n}:${h}`].value); if (v > 0) row[h] = v; }
    const r = kenoRtpOf(n, row), el = document.getElementById('kr' + n);
    el.textContent = 'RTP ' + r.toFixed(1) + ' %'; el.className = 'krtp ' + (r > 100 ? 'rtp-bad' : r < 90 || r > 95 ? 'rtp-warn' : 'rtp-ok');
  }
  $('kenoAuto').addEventListener('click', () => {
    const rtp = Number($('kenoRtp').value) / 100;
    if (!(rtp > 0.5 && rtp < 1)) return flash($('rateMsg'), 'RTP visé : entre 50 et 99 %.', false);
    for (let n = 1; n <= 10; n++) {
      const row = kenoRow(n, rtp);
      for (let h = 0; h <= n; h++) $('rateForm').elements[`k:${n}:${h}`].value = row[h] === undefined ? '' : row[h];
      showKenoRtp(n);
    }
    flash($('rateMsg'), 'Taux calculés pour un RTP visé de ' + $('kenoRtp').value + ' %. Cliquer sur « Enregistrer les taux » pour les appliquer.', true);
  });
  $('kenoRates').addEventListener('input', (e) => { const m = /^k:(d+):/.exec(e.target.name || ''); if (m) showKenoRtp(+m[1]); });

  function fillRates(s) {
    const p = s.paytables;
    $('kenoRates').innerHTML = Array.from({ length: 10 }, (_, i) => i + 1).map((n) => `<div class="krow"><b>${n} numéro${n > 1 ? 's' : ''}<span class="krtp" id="kr${n}"></span></b><div class="rates">${
      Array.from({ length: n + 1 }, (_, h) => rateBox(h + ' trouvé' + (h > 1 ? 's' : ''), `k:${n}:${h}`, p.keno[n] && p.keno[n][h])).join('')}</div></div>`).join('');
    for (let n = 1; n <= 10; n++) showKenoRtp(n);
    $('ls6Rates').innerHTML = p.luckysix.map((v, i) => rateBox('boule ' + (i + 6), 'l:' + i, v)).join('');
    $('lxRates').innerHTML = rateBox('1 numéro (6 premières boules)', 'x:single', p.luckyx.single)
      + Array.from({ length: 9 }, (_, i) => i + 2).map((n) => rateBox(n + ' boules', 'x:' + n, p.luckyx.tiers[n])).join('');
    $('rateForm').querySelector('.save').disabled = !canEdit();
  }
  $('rateForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const val = (name) => { const v = $('rateForm').elements[name].value; return v === '' ? 0 : Number(v); };
    const keno = {};
    for (let n = 1; n <= 10; n++) { keno[n] = {}; for (let h = 0; h <= n; h++) { const v = val(`k:${n}:${h}`); if (v > 0) keno[n][h] = v; } }
    const tiers = {}; for (let n = 2; n <= 10; n++) tiers[n] = val('x:' + n);
    save({ paytables: { keno, luckysix: settings.paytables.luckysix.map((_, i) => val('l:' + i)), luckyx: { single: val('x:single'), tiers } } }, $('rateMsg'));
  });

  function renderRtp(list) {
    const cls = (v) => v > 100 ? 'rtp-bad' : v < 90 || v > 95 ? 'rtp-warn' : 'rtp-ok';
    $('rtpTbl').innerHTML = '<thead><tr><th>Jeu</th><th>Ligne de gain</th><th>RTP</th></tr></thead><tbody>'
      + list.map((r) => `<tr><td>${GAMES[r.game] || esc(r.game)}</td><td>${esc(r.line)}</td><td class="${cls(r.rtpPercent)}">${r.rtpPercent.toFixed(2)} %</td></tr>`).join('') + '</tbody>';
  }

  /* ---------- Rapport caissier (un par déconnexion) ---------- */
  async function loadShifts() {
    try {
      const list = await A.call('GET', '/admin/shop/cashier-reports');
      $('shiftTbl').innerHTML = '<thead><tr><th>Caissier</th><th>Caisse</th><th>Connexion</th><th>Déconnexion</th><th>Tickets vendus</th><th>Ventes</th><th>Gains payés (nb)</th><th>Gains payés</th><th>Net en caisse</th><th>Début</th><th>Attendu</th><th>Fin déclarée</th><th>Écart</th></tr></thead><tbody>'
        + (list.length ? list.map((r) => {
          const net = r.stakesCents - r.payoutsCents;
          const known = r.openingCents !== null && r.closingCents !== null;
          const expected = known ? r.openingCents + net : null, gap = known ? r.closingCents - expected : null;
          return `<tr><td>${esc(r.email)}</td><td>${esc(r.terminal || '—')}</td><td>${PP.dateTime(Date.parse(r.startedAt), false)}</td><td>${PP.dateTime(Date.parse(r.endedAt), false)}</td>`
            + `<td>${r.tickets}</td><td>${cents(r.stakesCents)}</td><td>${r.payouts}</td><td>${cents(r.payoutsCents)}</td><td class="${net < 0 ? 'neg' : ''}">${cents(net)}</td>`
            + `<td>${r.openingCents === null ? '—' : cents(r.openingCents)}</td><td>${known ? cents(expected) : '—'}</td><td>${r.closingCents === null ? '—' : cents(r.closingCents)}</td>`
            + `<td class="${gap === null ? '' : gap < 0 ? 'neg' : gap > 0 ? 'pos' : ''}">${gap === null ? '—' : (gap > 0 ? '+' : '') + cents(gap)}</td></tr>`;
        }).join('') : '<tr><td colspan="13">Aucun rapport : il apparaît quand un caissier se déconnecte.</td></tr>') + '</tbody>';
    } catch (e) { $('shiftTbl').innerHTML = `<tr><td class="neg">${esc(A.message(e))}</td></tr>`; }
  }
  $('shiftGo').addEventListener('click', loadShifts);

  /* ---------- Caissiers ---------- */
  function cashTermOptions() {
    return ['<option value="">— aucune —</option>'].concat(terminals.map((t) => `<option>${esc(t)}</option>`)).join('');
  }
  async function loadCashiers() {
    $('cTerm').innerHTML = cashTermOptions();
    try {
      const list = await A.call('GET', '/admin/cashiers');
      $('cashTbl').innerHTML = '<thead><tr><th>E-mail</th><th>Caisse</th><th>Accès</th><th>Actions</th></tr></thead><tbody>'
        + (list.length ? list.map((c) => {
          const badge = c.active ? '<span class="tag ok">Autorisé</span>' : '<span class="tag off">Bloqué</span>';
          const lock = c.locked ? ' <span class="tag off">verrouillé</span>' : '';
          return `<tr data-id="${c.id}" data-email="${esc(c.email)}"><td>${esc(c.email)}</td><td>${esc(c.terminal || '—')}</td>`
            + `<td>${badge}${lock}</td><td class="acts"><button class="ghost" data-act="${c.active ? 'block' : 'allow'}">${c.active ? 'Bloquer' : 'Autoriser'}</button>`
            + `<button class="ghost" data-act="pass">Mot de passe</button></td></tr>`;
        }).join('') : '<tr><td colspan="4">Aucun caissier. Créez-en un ci-dessus.</td></tr>') + '</tbody>';
    } catch (e) { $('cashTbl').innerHTML = `<tr><td class="neg">${esc(A.message(e))}</td></tr>`; }
  }
  $('cashForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await A.call('POST', '/admin/cashiers', { email: $('cEmail').value.trim(), password: $('cPass').value, terminal: $('cTerm').value || undefined });
      const totp = PP.STAFF_TOTP && r.totpSecret ? ` Code d’authentification à configurer dans son application : ${r.totpSecret}` : '';
      flash($('cashMsg'), 'Caissier créé (bloqué). Cliquez « Autoriser » pour lui ouvrir l’accès.' + totp, true);
      $('cEmail').value = ''; $('cPass').value = '';
      loadCashiers();
    } catch (err) { flash($('cashMsg'), err.code === 'EMAIL_TAKEN' ? 'Cet e-mail est déjà utilisé.' : errorText(err), false); }
  });
  $('cashTbl').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const tr = b.closest('tr'), id = tr.dataset.id, email = tr.dataset.email, act = b.dataset.act;
    try {
      if (act === 'allow' || act === 'block') {
        await A.call('PATCH', `/admin/cashiers/${id}/access`, { active: act === 'allow' });
        flash($('cashMsg'), `${email} ${act === 'allow' ? 'autorisé' : 'bloqué'}.`, true);
      } else {
        const pass = prompt(`Nouveau mot de passe pour ${email} (8 caractères minimum) :`);
        if (!pass) return;
        await A.call('PATCH', `/admin/cashiers/${id}/password`, { password: pass });
        flash($('cashMsg'), `Mot de passe de ${email} changé ; ses sessions sont coupées.`, true);
      }
      loadCashiers();
    } catch (err) { flash($('cashMsg'), errorText(err), false); }
  });

  /* ---------- Démarrage ---------- */
  async function start() {
    role = roleOf();
    $('logoutBtn').classList.remove('hidden');
    $('who').textContent = 'Rôle : ' + role + (canEdit() ? '' : ' (consultation seulement)');
    $('tabCashiers').classList.toggle('hidden', !canEdit());
    try {
      const r = await A.call('GET', '/admin/shop/settings');
      timingPlan = r.timings; settings = r.settings;
      $('shopName').textContent = settings.pointOfSale;
      fillSettings(settings); fillRates(settings); renderRtp(r.rtp);
      if (canEdit()) loadCashiers();
      loadShifts();
    } catch (e) {
      if (e.status !== 401) { A.logout(); showLogin(e.status === 403 ? 'Ce compte n’a pas accès à l’administration (compte propriétaire requis).' : A.message(e)); }
      return;
    }
    $('repDay').value = today(); $('rngTo').value = today(); $('rngFrom').value = addDays(today(), -6);
    loadReport(); loadRange();
  }

  if (!PP.online) showLogin();
  else if (A.token) start();
  else showLogin();
});
