/* Tickets imprimables (80 mm) : mise et décaissement, avec le logo La Référence Paryaj Paw en haut.
   Le logo est passé en niveaux de gris contrastés pour l'imprimante thermique. */
(function () {
  const PP = window.PP;

  /* Code 39 (chiffres + A-Z) : n = étroit, w = large, barre/espace en alternance. */
  const C39 = { '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
    A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn', F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn', K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn',
    N: 'nnnnwnnww', O: 'wnnnwnnwn', P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn', U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn', Z: 'nwwnwnnnn', '*': 'nwnnwnwnn' };

  function barcode(text) {
    let x = 0, bars = '';
    for (const ch of '*' + text.toUpperCase() + '*') {
      const p = C39[ch]; if (!p) continue;
      for (let i = 0; i < 9; i++) {
        const w = p[i] === 'w' ? 3 : 1;
        if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w}" height="40"/>`;
        x += w;
      }
      x += 1;
    }
    /* Marges blanches de 10 modules de chaque côté (Code 39 en exige ~10×) : sans elles le scanner ne lit pas. */
    return `<svg class="bc" viewBox="-10 0 ${x + 20} 40" preserveAspectRatio="none" shape-rendering="crispEdges" aria-label="${PP.esc(text)}">${bars}</svg>`;
  }

  /* Numéros joués en gros et en gras (lisibles de loin sur le papier thermique). Jusqu'à 6 numéros sur une rangée ;
     au-delà (Keno, Lucky X), des rangées de 5 pour que les chiffres restent gros. */
  const picksHTML = (picks) => {
    if (picks.length <= 6) return `<div class="picks">${picks.join(' ')}</div>`;
    const rows = [];
    for (let i = 0; i < picks.length; i += 5) rows.push(`<div class="picks big5">${picks.slice(i, i + 5).join(' ')}</div>`);
    return rows.join('');
  };
  const row = (a, b, cls = '') => `<div class="r ${cls}"><span>${a}</span><span>${b}</span></div>`;
  /* Moment du tirage du tour (= fin des mises) : indique au client à quel moment son jeu a lieu. */
  const drawTimeOf = (t) => {
    const g = PP.GAMES[t.game];
    if (!g || !t.day || !t.round) return '';
    return PP.dateTime(t.day + (t.round - 1) * PP.cycle(t.game) * 1000 + g.bet * 1000, false);
  };
  const STATUS_LABEL = { pending: 'En attente', won: 'Gagnant', lost: 'Perdant', paid: 'Payé', voided: 'Annulé' };
  /* Fiche multi-tours : une rangée par tour (tour, tirage, mise, gain maximum, et l'état une fois le tour joué). */
  const roundRows = (t) => t.bundle.rounds.map((r) => `
      <div class="rd">
        <div class="r rn"><span class="n">Tour ${PP.roundNo(r.round)}</span><span>${drawTimeOf({ game: t.game, day: r.day, round: r.round })}</span></div>
        <div class="r"><span>Mise: ${PP.money(r.stake)}</span><span>Gain max: ${PP.money(r.possible)}</span></div>
        ${r.status !== 'pending' ? `<div class="rst">${STATUS_LABEL[r.status] || ''}${r.win ? ' ' + PP.money(r.win) : ''}</div>` : ''}
      </div>`).join('');
  const head = (title, t) => `
    <img class="logo" src="assets/logo.jpg" alt="La Référence Paryaj Paw">
    <div class="shop">Point de vente: ${PP.esc(PP.SHOP.pointDeVente)}<br>Périphérique: ${PP.esc(t.caisse)}<br>Émetteur: ${PP.esc(PP.SHOP.emetteur)}</div>
    <div class="title">${title}</div>
    <hr>
    ${row('Délivré', PP.dateTime(t.time))}
    ${row('ID de ticket', t.id)}
    <hr>
    <div class="tour">${t.bundle
      ? '<div class="tno">Tours: ' + PP.roundNo(t.bundle.rounds[0].round) + ' à ' + PP.roundNo(t.bundle.rounds[t.bundle.count - 1].round) + '</div><div class="tdraw">Fiche de ' + t.bundle.count + ' tours' + (drawTimeOf(t) ? ' &middot; 1er tirage: ' + drawTimeOf(t) : '') + '</div>'
      : '<div class="tno">Tour: ' + PP.roundNo(t.round) + '</div>' + (drawTimeOf(t) ? '<div class="tdraw">Tirage: ' + drawTimeOf(t) + '</div>' : '')}</div>
    <hr>`;

  /* Ticket de mise. */
  PP.ticketHTML = function (t, copy) {
    const lines = t.lines.map((l) => `
      <div class="line">
        <div class="kind">(${l.label})</div>
        ${picksHTML(l.picks)}
        ${row('Cotes:', l.odds.toFixed(2))}
        ${t.bundle ? '' : row('Mise:', PP.money(l.stake)) + row('Gain possible:', PP.money(l.possible))}
      </div>`).join('<hr class="thin">');
    const total = t.totalStake != null ? t.totalStake : t.lines.reduce((a, l) => a + l.stake, 0);
    const rounds = t.bundle ? `<hr><div class="kind">Tours joués (mêmes numéros)</div>${roundRows(t)}` : '';
    return `<div class="tk">${copy ? '<div class="big">*** DUPLICATA ***</div>' : ''}${head(t.gameTicket, t)}${lines}${rounds}<hr>
      ${row(t.bundle ? 'Mise totale:' : 'Mise:', PP.money(total))}${row('Paiement de taxe:', PP.money(0))}${row('Paiement:', PP.money(total))}
      ${barcode(t.id)}</div>`;
  };

  /* Ticket de décaissement (paiement d'un ticket gagnant). */
  PP.payoutHTML = function (t, win) {
    const total = t.totalStake != null ? t.totalStake : t.lines.reduce((a, l) => a + l.stake, 0), now = { ...t, time: PP.now() };
    const paidRounds = t.bundle ? t.bundle.rounds.filter((r) => r.status === 'won').map((r) => row('Tour ' + PP.roundNo(r.round) + ':', PP.money(r.win))).join('') : '';
    return `<div class="tk">${head(t.gameTicket + ' Décaissement', now)}
      ${row(t.bundle ? 'Mise totale:' : 'Mise:', PP.money(total))}${paidRounds}
      ${row('Gains:', PP.money(win))}
      ${row('Taxes sur les retraits:', PP.money(0))}
      <hr>
      <div class="big">Décaissement total:</div>
      <div class="total">${PP.money(win)}</div>
      ${barcode(t.id)}</div>`;
  };

  PP.ticketCSS = `
    .tk{width:72mm;margin:0 auto;padding:2mm 1mm 4mm;background:#fff;color:#000;font:11px/1.35 'Courier New',monospace}
    .tk .logo{display:block;width:62mm;margin:0 auto 2mm;filter:grayscale(1) contrast(1.9) brightness(1.1);mix-blend-mode:multiply}
    .tk .shop{font-size:10px;margin-bottom:3mm}
    .tk .title{text-align:center;font-size:15px;letter-spacing:.04em;margin:2mm 0}
    .tk hr{border:0;border-top:1px solid #000;margin:1.5mm 0}
    .tk hr.thin{border-top-style:dotted;margin:2mm 0}
    .tk .r{display:flex;justify-content:space-between;gap:4mm}
    .tk .tour{text-align:center;margin:1mm 0}
    .tk .tour .tno{font-size:26px;font-weight:900;letter-spacing:.02em;line-height:1.15}
    .tk .tour .tdraw{font-size:11px;margin-top:.5mm}
    .tk .line .kind{text-align:center;font-size:10px;margin-top:2mm}
    .tk .line .picks{text-align:center;font-size:23px;font-weight:900;margin:1mm 0 1mm;word-spacing:2mm;line-height:1.2;overflow-wrap:anywhere}
    .tk .line .picks.big5{font-size:25px;word-spacing:3mm}
    .tk .line .picks:last-of-type{margin-bottom:2mm}
    .tk .line,.tk .bc,.tk .rd{break-inside:avoid;page-break-inside:avoid}
    .tk .rn .n{font-size:19px;font-weight:900}
    .tk .rd{margin:1.5mm 0;padding-bottom:1mm;border-bottom:1px dotted #000}
    .tk .rst{text-align:right;font-size:10px}
    .tk .big{margin-top:3mm}
    .tk .total{text-align:center;font-size:19px;margin:1mm 0 3mm}
    .tk .bc{display:block;width:100%;height:13mm;margin:4mm auto 0;fill:#000}`;

  /* Impression via un iframe caché : le reste de la page n'est jamais imprimé. */
  PP.printHTML = function (html) {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:-9999px;top:0;width:80mm;height:120mm;border:0';   /* hors écran mais de vraie taille : un iframe de 0 px s'imprime parfois en blanc */
    document.body.appendChild(f);
    const base = new URL('.', location.href).href;
    f.contentDocument.open();
    f.contentDocument.write(`<!doctype html><html><head><meta charset="utf-8"><base href="${base}">
      <style>@page{size:80mm auto;margin:0}html,body{margin:0;background:#fff}${PP.ticketCSS}</style></head><body>${html}</body></html>`);
    f.contentDocument.close();
    /* Un seul morceau de papier : la hauteur de la page = la hauteur du ticket (sinon une longue liste de mises est coupée en 2 pages,
       donc en 2 tickets, et le code-barres se retrouve seul sur le second). */
    let done = false;
    const go = () => {
      if (done) return; done = true;
      const d = f.contentDocument, mm = Math.ceil(d.documentElement.scrollHeight * 25.4 / 96) + 6;
      const st = d.createElement('style'); st.textContent = '@page{size:80mm ' + mm + 'mm;margin:0}html,body{height:' + mm + 'mm;overflow:hidden}'; d.head.appendChild(st);
      f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 2000);
    };
    const img = f.contentDocument.querySelector('img');
    if (img && !img.complete) { img.addEventListener('load', go); img.addEventListener('error', go); setTimeout(go, 3000); } else setTimeout(go, 150);
  };
})();
