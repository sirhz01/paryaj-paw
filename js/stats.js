/* Onglet « Statistiques » de l'administration : évolution des ventes, des gains et du bénéfice jour après jour,
   comparée à la période précédente, avec le RTP réellement constaté face au RTP théorique des tables de gains.
   Données : GET /admin/shop/dashboard (une ligne par jour et par jeu) et GET /admin/shop/settings (RTP théorique). */
PP.ready.then(function () {
  const $ = (id) => document.getElementById(id), A = PP.api;
  const cents = (c) => PP.money(c / 100);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const GAMES = { roulette: 'Roulette', keno: 'Keno', luckysix: 'Lucky Six', luckyx: 'Lucky X' };
  const addDays = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const today = () => PP.dayKey(Date.now() + (PP.offset || 0));
  const pct = (v) => (Number.isFinite(v) ? v.toFixed(1).replace('.', ',') + ' %' : '—');
  const num = (v) => Number(v) || 0;

  const query = (from, to) => A.call('GET', `/admin/shop/dashboard?from=${from}&to=${to}`);

  /** Totaux d'une liste de lignes (jour × jeu). */
  function totals(rows) {
    const t = { tickets: 0, stakes: 0, settled: 0, wins: 0, paid: 0, ggr: 0 };
    for (const r of rows) { t.tickets += num(r.tickets); t.stakes += num(r.stakesCents); t.settled += num(r.settledStakesCents); t.wins += num(r.winsCents); t.paid += num(r.paidCents); }
    // Bénéfice, marge et RTP ne comptent que les tickets dont le tirage est réglé : un ticket en attente n'a pas encore de gain.
    t.ggr = t.settled - t.wins;
    t.pending = t.stakes - t.settled;
    t.margin = t.settled > 0 ? (100 * t.ggr) / t.settled : NaN;
    t.rtp = t.settled > 0 ? (100 * t.wins) / t.settled : NaN;
    t.avgStake = t.tickets > 0 ? t.stakes / t.tickets : NaN;
    return t;
  }

  /** Une valeur par jour de from à to (jours sans vente à zéro). */
  function perDay(rows, from, to) {
    const days = [];
    for (let d = from; d <= to; d = addDays(d, 1)) days.push({ day: d, stakes: 0, settled: 0, wins: 0, ggr: 0, tickets: 0 });
    const index = new Map(days.map((d) => [d.day, d]));
    for (const r of rows) {
      const d = index.get(r.day); if (!d) continue;
      d.stakes += num(r.stakesCents); d.settled += num(r.settledStakesCents); d.wins += num(r.winsCents); d.ggr += num(r.settledStakesCents) - num(r.winsCents); d.tickets += num(r.tickets);
    }
    return days;
  }

  const delta = (cur, prev, goodWhenUp = true) => {
    if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return '';
    const p = (100 * (cur - prev)) / Math.abs(prev), up = p >= 0;
    const good = up === goodWhenUp;
    return `<small class="${good ? 'pos' : 'neg'}">${up ? '▲' : '▼'} ${Math.abs(p).toFixed(1).replace('.', ',')} % vs période précédente</small>`;
  };

  function kpis(cur, prev) {
    const k = (label, value, extra, cls) => `<div class="kpi"><span>${label}</span><b class="${cls || ''}">${value}</b>${extra || ''}</div>`;
    $('stKpis').innerHTML =
      k('Ventes (mises)', cents(cur.stakes), delta(cur.stakes, prev.stakes))
      + k('Gains dus', cents(cur.wins), delta(cur.wins, prev.wins, false))
      + k('Bénéfice (tirages réglés)', cents(cur.ggr), delta(cur.ggr, prev.ggr), cur.ggr < 0 ? 'neg' : 'pos')
      + k('Marge de la maison', pct(cur.margin), `<small>Période précédente : ${pct(prev.margin)}</small>`)
      + k('Tickets', cur.tickets, cur.pending > 0 ? `<small>${cents(cur.pending)} de mises en attente de tirage</small>` : delta(cur.tickets, prev.tickets))
      + k('Mise moyenne', Number.isFinite(cur.avgStake) ? cents(cur.avgStake) : '—', delta(cur.avgStake, prev.avgStake));
  }

  /* ---------- Graphiques SVG (sans bibliothèque) ---------- */
  const W = 720, H = 220, PAD = { l: 58, r: 12, t: 12, b: 26 };
  function niceMax(v) { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / p) * p; }

  /** series : [{ name, color, values[] }] sur les mêmes jours ; area = remplit sous la première série. */
  function chart(days, series, opts) {
    const all = series.flatMap((s) => s.values);
    const hi = niceMax(Math.max(0, ...all)), lo = Math.min(0, ...all) < 0 ? -niceMax(-Math.min(...all)) : 0;
    const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b, n = days.length;
    const x = (i) => PAD.l + (n === 1 ? iw / 2 : (iw * i) / (n - 1));
    const y = (v) => PAD.t + ih - (ih * (v - lo)) / (hi - lo || 1);
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) * i) / 4, yy = y(v);
      g += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${yy}" y2="${yy}" stroke="#e3e8f2"/><text x="${PAD.l - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="#6b7590">${esc(Math.round(v / 100))}</text>`;
    }
    if (lo < 0) g += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(0)}" y2="${y(0)}" stroke="#14285f" stroke-width="1.2"/>`;
    const step = Math.max(1, Math.ceil(n / 8));
    days.forEach((d, i) => { if (i % step === 0 || i === n - 1) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#6b7590">${d.day.slice(5)}</text>`; });
    series.forEach((s, si) => {
      const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
      if (opts.area && si === 0) g += `<polygon points="${x(0)},${y(0)} ${pts.join(' ')} ${x(n - 1)},${y(0)}" fill="${s.color}" opacity=".12"/>`;
      g += `<polyline points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
      s.values.forEach((v, i) => { g += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${n > 45 ? 1.5 : 3}" fill="${s.color}"><title>${esc(days[i].day)} · ${esc(s.name)} : ${esc(cents(v))}</title></circle>`; });
    });
    const legend = series.map((s) => `<span class="lg"><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
    return `<div class="legend">${legend}</div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label)}" class="stchart">${g}</svg>`;
  }

  /* ---------- Tableau par jeu ---------- */
  function gameTable(rows, theory) {
    const by = {};
    for (const r of rows) (by[r.game] = by[r.game] || []).push(r);
    const names = Object.keys(GAMES).filter((g) => by[g]);
    const lines = names.map((g) => {
      const t = totals(by[g]), th = theory[g];
      const gap = Number.isFinite(t.rtp) && th !== undefined ? t.rtp - th : NaN;
      const cls = Number.isFinite(gap) && Math.abs(gap) > 10 ? 'neg' : '';
      return `<tr><td>${GAMES[g]}</td><td>${t.tickets}</td><td>${cents(t.stakes)}</td><td>${cents(t.wins)}</td><td class="${t.ggr < 0 ? 'neg' : 'pos'}">${cents(t.ggr)}</td>`
        + `<td>${pct(t.rtp)}</td><td>${th !== undefined ? pct(th) : '—'}</td><td class="${cls}">${Number.isFinite(gap) ? (gap > 0 ? '+' : '') + gap.toFixed(1).replace('.', ',') + ' pts' : '—'}</td></tr>`;
    }).join('');
    $('stGames').innerHTML = '<thead><tr><th>Jeu</th><th>Tickets</th><th>Mises</th><th>Gains dus</th><th>Bénéfice</th><th>RTP constaté</th><th>RTP théorique</th><th>Écart</th></tr></thead><tbody>'
      + (lines || '<tr><td colspan="8">Aucune vente sur cette période.</td></tr>') + '</tbody>';
  }

  async function theoreticalRtp() {
    const out = {};
    try {
      const s = await A.call('GET', '/admin/shop/settings');
      const acc = {};
      for (const r of s.rtp || []) (acc[r.game] = acc[r.game] || []).push(Number(r.rtpPercent));
      for (const [g, list] of Object.entries(acc)) out[g] = list.reduce((a, b) => a + b, 0) / list.length;
    } catch (e) { /* sans réglages, la colonne théorique reste vide */ }
    return out;
  }

  /* ---------- Par caissier et par heure ---------- */
  function cashierTable(list) {
    const rows = list.map((r) => {
      const stakes = num(r.stakesCents), settled = num(r.settledStakesCents), wins = num(r.winsCents), ggr = settled - wins;
      return `<tr><td>${esc(r.email)}</td><td>${esc(r.terminal)}</td><td>${num(r.tickets)}</td><td>${cents(stakes)}</td><td>${cents(wins)}</td><td>${cents(num(r.paidCents))}</td>`
        + `<td class="${ggr < 0 ? 'neg' : 'pos'}">${cents(ggr)}</td><td>${pct(settled > 0 ? (100 * wins) / settled : NaN)}</td><td class="${num(r.voids) > 0 ? 'neg' : ''}">${num(r.voids)}</td></tr>`;
    }).join('');
    $('stCashiers').innerHTML = '<thead><tr><th>Caissier</th><th>Caisse</th><th>Tickets</th><th>Mises</th><th>Gains dus</th><th>Payé</th><th>Bénéfice</th><th>RTP constaté</th><th>Annulés</th></tr></thead><tbody>'
      + (rows || '<tr><td colspan="9">Aucune vente sur cette période.</td></tr>') + '</tbody>';
  }

  /** 24 barres (heure d'Haïti) : mises par heure d'émission du ticket. */
  function hoursChart(list) {
    const byHour = new Map(list.map((r) => [num(r.hour), r]));
    const hours = Array.from({ length: 24 }, (_, h) => byHour.get(h) || { hour: h, tickets: 0, stakesCents: 0, winsCents: 0, settledStakesCents: 0 });
    const hi = niceMax(Math.max(0, ...hours.map((h) => num(h.stakesCents))));
    const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b, bw = iw / 24;
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const v = (hi * i) / 4, yy = PAD.t + ih - (ih * v) / hi;
      g += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${yy}" y2="${yy}" stroke="#e3e8f2"/><text x="${PAD.l - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="#6b7590">${Math.round(v / 100)}</text>`;
    }
    hours.forEach((h, i) => {
      const bh = (ih * num(h.stakesCents)) / hi, bx = PAD.l + i * bw + 2;
      g += `<rect x="${bx.toFixed(1)}" y="${(PAD.t + ih - bh).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${bh.toFixed(1)}" fill="#14285f"><title>${String(h.hour).padStart(2, '0')} h · ${num(h.tickets)} ticket(s) · mises ${esc(cents(num(h.stakesCents)))} · bénéfice (tirages réglés) ${esc(cents(num(h.settledStakesCents) - num(h.winsCents)))}</title></rect>`;
      g += `<text x="${(bx + (bw - 4) / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#6b7590">${h.hour}</text>`;
    });
    $('stHours').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Mises par heure d'émission" class="stchart">${g}</svg>`;
    const best = hours.reduce((a, b) => (num(b.stakesCents) > num(a.stakesCents) ? b : a), hours[0]);
    $('stHoursNote').textContent = num(best.stakesCents) > 0
      ? `Heure la plus active : ${String(best.hour).padStart(2, '0')} h – ${String(best.hour + 1).padStart(2, '0')} h (${num(best.tickets)} ticket(s), ${cents(num(best.stakesCents))}). Heures de Port-au-Prince.`
      : 'Aucune vente sur cette période.';
    return hours;
  }

  /* ---------- Export CSV ---------- */
  let last = { from: '', to: '', days: [], games: [], cashiers: [], hours: [] };
  const mad = (c) => num(c) / 100;
  function download(name, head, lines) {
    const csv = [head].concat(lines.map((l) => l.join(';'))).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${name}_${last.from}_${last.to}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const csvEmail = (v) => String(v).replace(/;/g, ',');
  function exportCsv(kind) {
    if (kind === 'days') {
      download('statistiques_jours', 'jour;jeu;tickets;mises_htg;gains_dus_htg;payes_htg;benefice_htg',
        last.games.map((r) => [r.day, r.game, r.tickets, mad(r.stakesCents), mad(r.winsCents), mad(r.paidCents), mad(num(r.settledStakesCents) - num(r.winsCents))]));
    } else if (kind === 'cashiers') {
      download('statistiques_caissiers', 'caissier;caisse;tickets;mises_htg;gains_dus_htg;payes_htg;benefice_htg;rtp_constate_pct;tickets_annules',
        last.cashiers.map((r) => [csvEmail(r.email), csvEmail(r.terminal), r.tickets, mad(r.stakesCents), mad(r.winsCents), mad(r.paidCents), mad(num(r.settledStakesCents) - num(r.winsCents)),
          num(r.settledStakesCents) > 0 ? ((100 * num(r.winsCents)) / num(r.settledStakesCents)).toFixed(2) : '', r.voids]));
    } else {
      download('statistiques_heures', 'heure_haiti;tickets;mises_htg;gains_dus_htg;benefice_htg',
        last.hours.map((h) => [h.hour, h.tickets, mad(h.stakesCents), mad(h.winsCents), mad(num(h.settledStakesCents) - num(h.winsCents))]));
    }
  }

  let busy = false;
  async function load() {
    if (busy) return; busy = true;
    const len = Number($('stRange').value), game = $('stGame').value;
    const to = today(), from = addDays(to, -(len - 1)), pTo = addDays(from, -1), pFrom = addDays(pTo, -(len - 1));
    $('stMsg').textContent = 'Chargement…'; $('stMsg').className = 'hint';
    try {
      const [curAll, prevAll, theory, split] = await Promise.all([query(from, to), query(pFrom, pTo), theoreticalRtp(), A.call('GET', `/admin/shop/breakdown?from=${from}&to=${to}`)]);
      const keep = (rows) => (game ? rows.filter((r) => r.game === game) : rows);
      const cur = keep(curAll), prev = keep(prevAll), days = perDay(cur, from, to);
      kpis(totals(cur), totals(prev));
      $('stChart1').innerHTML = chart(days, [
        { name: 'Ventes', color: '#14285f', values: days.map((d) => d.stakes) },
        { name: 'Gains dus', color: '#e08a1e', values: days.map((d) => d.wins) },
      ], { label: 'Ventes et gains par jour' });
      let run = 0;
      $('stChart2').innerHTML = chart(days, [
        { name: 'Bénéfice cumulé', color: '#1c7a3a', values: days.map((d) => (run += d.ggr)) },
      ], { label: 'Bénéfice cumulé', area: true });
      gameTable(curAll, theory);
      cashierTable(split.cashiers);
      const hours = hoursChart(split.hours);
      last = { from, to, days, games: curAll, cashiers: split.cashiers, hours };
      const t = totals(cur);
      $('stMsg').textContent = t.tickets < 200
        ? `Seulement ${t.tickets} ticket(s) sur la période : le RTP constaté varie beaucoup sur un petit volume et ne se rapproche du RTP théorique qu'avec beaucoup de tickets.`
        : `Période du ${from} au ${to}, comparée au ${pFrom} – ${pTo}.`;
    } catch (e) { $('stMsg').textContent = A.message(e); $('stMsg').className = 'hint neg'; }
    busy = false;
  }

  $('stCsvDays').addEventListener('click', () => exportCsv('days'));
  $('stCsvCashiers').addEventListener('click', () => exportCsv('cashiers'));
  $('stCsvHours').addEventListener('click', () => exportCsv('hours'));
  $('stGo').addEventListener('click', load);
  $('stRange').addEventListener('change', load);
  $('stGame').addEventListener('change', load);
  document.querySelector('[data-tab="stats"]').addEventListener('click', load);
});
