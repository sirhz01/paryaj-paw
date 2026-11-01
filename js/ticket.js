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
    return `<svg class="bc" viewBox="0 0 ${x} 40" preserveAspectRatio="none" aria-label="${text}">${bars}</svg>`;
  }

  const row = (a, b, cls = '') => `<div class="r ${cls}"><span>${a}</span><span>${b}</span></div>`;
  const head = (title, t) => `
    <img class="logo" src="assets/logo.jpg" alt="La Référence Paryaj Paw">
    <div class="shop">Point de vente: ${PP.SHOP.pointDeVente}<br>Périphérique: ${t.caisse}<br>Émetteur: ${PP.SHOP.emetteur}</div>
    <div class="title">${title}</div>
    <hr>
    ${row('Délivré', PP.dateTime(t.time))}
    ${row('ID de ticket', t.id)}
    <hr>
    <div class="tour">Tour: ${t.round}</div>
    <hr>`;

  /* Ticket de mise. */
  PP.ticketHTML = function (t) {
    const lines = t.lines.map((l) => `
      <div class="line">
        <div class="kind">(${l.label})</div>
        <div class="picks">${l.picks.join(' ')}</div>
        ${row('Cotes:', l.odds.toFixed(2))}
        ${row('Mise:', PP.money(l.stake))}
        ${row('Gain possible:', PP.money(l.possible))}
      </div>`).join('<hr class="thin">');
    const total = t.lines.reduce((a, l) => a + l.stake, 0);
    return `<div class="tk">${head(t.gameTicket, t)}${lines}<hr>
      ${row('Mise:', PP.money(total))}${row('Paiement de taxe:', PP.money(0))}${row('Paiement:', PP.money(total))}
      ${barcode(t.id)}</div>`;
  };

  /* Ticket de décaissement (paiement d'un ticket gagnant). */
  PP.payoutHTML = function (t, win) {
    const total = t.lines.reduce((a, l) => a + l.stake, 0), now = { ...t, time: PP.now() };
    return `<div class="tk">${head(t.gameTicket + ' Décaissement', now)}
      ${row('Mise:', PP.money(total))}
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
    .tk .tour{text-align:center;font-size:10px;margin:1mm 0}
    .tk .line .kind{text-align:center;font-size:10px;margin-top:2mm}
    .tk .line .picks{text-align:center;font-size:17px;margin:1mm 0 2mm;word-spacing:3mm;overflow-wrap:anywhere}
    .tk .big{margin-top:3mm}
    .tk .total{text-align:center;font-size:19px;margin:1mm 0 3mm}
    .tk .bc{display:block;width:95%;height:13mm;margin:4mm auto 0;fill:#000}`;

  /* Impression via un iframe caché : le reste de la page n'est jamais imprimé. */
  PP.printHTML = function (html) {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    const base = new URL('.', location.href).href;
    f.contentDocument.open();
    f.contentDocument.write(`<!doctype html><html><head><meta charset="utf-8"><base href="${base}">
      <style>@page{size:80mm auto;margin:0}html,body{margin:0;background:#fff}${PP.ticketCSS}</style></head><body>${html}</body></html>`);
    f.contentDocument.close();
    const go = () => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 2000); };
    const img = f.contentDocument.querySelector('img');
    if (img && !img.complete) img.addEventListener('load', go); else setTimeout(go, 50);
  };
})();
