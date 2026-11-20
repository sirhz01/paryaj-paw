/* Résultats des tirages : choisir un jeu et un jour, voir les boules sorties à chaque tour.
   Partagé par la caisse (fenêtre « Résultats ») et l'administration (onglet « Résultats »).
   PP.mountResults(racine) construit le formulaire et renvoie { reload }. Les résultats viennent du serveur
   (tours dont le tirage est terminé) : sans serveur, rien n'est affiché. */
(function () {
  const PP = window.PP, esc = PP.esc;
  const GAMES = [['roulette', 'Roulette'], ['keno', 'Keno'], ['luckysix', 'Lucky Six'], ['luckyx', 'Lucky X']];
  const hhmm = new Intl.DateTimeFormat('fr-FR', { timeZone: 'America/Port-au-Prince', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

  /** Jour voisin (AAAA-MM-JJ) : d = -1 la veille, +1 le lendemain. */
  const shiftDay = (key, d) => {
    const [y, m, day] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, day + d)).toISOString().slice(0, 10);
  };

  /** Boules d'un tour, dans l'ordre du tirage (comme à l'écran TV). */
  function ballsHTML(game, result) {
    if (game === 'roulette') return `<span class="rb rb-${PP.R.color(result.n)}">${esc(result.n)}</span>`;
    return result.draw.map((n) => {
      const bg = game === 'luckyx' ? PP.lxColor(n) : game === 'luckysix' ? PP.ballColor(n) : '#1a2a44';
      const fg = game === 'luckyx' ? PP.lxText(n) : game === 'luckysix' ? PP.ballText(n) : '#fff';
      return `<span class="rb" style="--c:${bg};--txt:${fg}">${n}</span>`;
    }).join('');
  }

  PP.mountResults = function (root) {
    const today = () => PP.dayKey(PP.now());
    root.classList.add('results');
    root.innerHTML = `
      <div class="rfilters">
        <label>Jeu <select class="rGame">${GAMES.map(([g, t]) => `<option value="${g}">${t}</option>`).join('')}</select></label>
        <label>Jour <input type="date" class="rDay"></label>
        <button type="button" class="ghost rPrev" title="Jour précédent">&larr;</button>
        <button type="button" class="ghost rNext" title="Jour suivant">&rarr;</button>
        <button type="button" class="ghost rToday">Aujourd'hui</button>
      </div>
      <p class="hint rInfo"></p>
      <div class="rlist"></div>`;
    const $ = (c) => root.querySelector(c);
    const game = $('.rGame'), day = $('.rDay'), info = $('.rInfo'), list = $('.rlist');
    let seq = 0;

    async function load() {
      const key = day.value;
      if (!key) return;
      const mine = ++seq;
      info.textContent = 'Chargement…';
      list.innerHTML = '';
      try {
        const res = await PP.api.results(game.value, key);
        if (mine !== seq) return;   // une autre sélection est arrivée entre-temps
        const rows = res.rounds;
        info.textContent = rows.length ? `${rows.length} tour${rows.length > 1 ? 's' : ''} tiré${rows.length > 1 ? 's' : ''} le ${key}, du plus récent au plus ancien.` : 'Aucun tirage terminé pour ce jour.';
        list.innerHTML = rows.length
          ? '<table class="tbl rtbl"><thead><tr><th>Tour</th><th>Heure</th><th>Boules sorties</th></tr></thead><tbody>' +
            rows.map((r) => `<tr><td>#${r.round}</td><td>${hhmm.format(r.drawStartMs)}</td><td class="rballs">${ballsHTML(game.value, r.result)}</td></tr>`).join('') + '</tbody></table>'
          : '';
      } catch (e) {
        if (mine !== seq) return;
        info.textContent = PP.online ? PP.api.message(e) : 'Les résultats demandent le serveur (mode démo : indisponible).';
      }
    }

    const set = (key) => { day.value = key; day.max = today(); load(); };
    game.addEventListener('change', load);
    day.addEventListener('change', load);
    $('.rPrev').addEventListener('click', () => set(shiftDay(day.value || today(), -1)));
    $('.rNext').addEventListener('click', () => { const next = shiftDay(day.value || today(), 1); if (next <= today()) set(next); });
    $('.rToday').addEventListener('click', () => set(today()));
    set(today());
    return { reload: () => set(day.value && day.value <= today() ? day.value : today()) };
  };
})();
