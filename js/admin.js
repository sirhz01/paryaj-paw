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

  let settings = null, role = '', terminals = [];

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
  $('logoutBtn').addEventListener('click', () => { A.logout(); showLogin(); });

  /* ---------- Onglets ---------- */
  $('tabs').addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    [...$('tabs').children].forEach((b) => b.classList.toggle('on', b === t));
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + t.dataset.tab));
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
    $('terms').innerHTML = terminals.map((t, i) => `<div class="t"><input value="${esc(t)}" maxlength="32" data-i="${i}" aria-label="Nom de la caisse ${i + 1}"><button type="button" data-del="${i}" title="Retirer">✕</button></div>`).join('');
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

  function fillSettings(s) {
    $('fPos').value = s.pointOfSale; $('fIssuer').value = s.issuer;
    terminals = s.terminals.slice(); renderTerminals();
    $('fStakes').value = s.stakesCents.map(htg).join(', ');
    $('fMin').value = htg(s.minStakeCents); $('fMax').value = htg(s.maxStakeCents); $('fTicket').value = htg(s.maxTicketCents);
    $('fPayout').value = htg(s.maxPayoutCents); $('fApproval').value = htg(s.approvalThresholdCents);
    $('fTop').checked = s.topLineEnabled;
    document.querySelectorAll('#setForm input, #setForm .save').forEach((el) => { if (!el.closest('.terms')) el.disabled = !canEdit(); });
  }

  async function save(patch, msgEl) {
    const { version, createdAt, ...base } = settings;
    try {
      const r = await A.call('PUT', '/admin/shop/settings', { ...base, ...patch });
      settings = r.settings; fillSettings(settings); fillRates(settings); renderRtp(r.rtp);
      flash(msgEl, 'Enregistré (version ' + settings.version + '). Les écrans et la caisse le prennent au prochain rechargement.', true);
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
      maxPayoutCents: toCents($('fPayout').value), approvalThresholdCents: toCents($('fApproval').value), topLineEnabled: $('fTop').checked,
    }, $('setMsg'));
  });

  /* ---------- Taux de gain ---------- */
  const rateBox = (label, name, value) => `<label class="rate">${label}<input type="number" min="0" step="any" name="${name}" value="${value === undefined ? '' : value}" ${canEdit() ? '' : 'disabled'}></label>`;
  function fillRates(s) {
    const p = s.paytables;
    $('kenoRates').innerHTML = Array.from({ length: 10 }, (_, i) => i + 1).map((n) => `<div class="krow"><b>${n} numéro${n > 1 ? 's' : ''}</b><div class="rates">${
      Array.from({ length: n + 1 }, (_, h) => rateBox(h + ' trouvé' + (h > 1 ? 's' : ''), `k:${n}:${h}`, p.keno[n] && p.keno[n][h])).join('')}</div></div>`).join('');
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

  /* ---------- Démarrage ---------- */
  async function start() {
    role = roleOf();
    $('logoutBtn').classList.remove('hidden');
    $('who').textContent = 'Rôle : ' + role + (canEdit() ? '' : ' (consultation seulement)');
    try {
      const r = await A.call('GET', '/admin/shop/settings');
      settings = r.settings;
      $('shopName').textContent = settings.pointOfSale;
      fillSettings(settings); fillRates(settings); renderRtp(r.rtp);
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
