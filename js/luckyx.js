/* Écran TV : Lucky X. 36 boules sur 50, tirées dans un ordre aléatoire, en 6 colonnes de 6 boules (3 colonnes de chaque côté du tambour) ;
   chaque colonne se remplit de haut en bas avant de passer à la suivante.
   Bas de l'écran : pour chaque mode (1 à 10 numéros choisis), le gain si le dernier numéro choisi sort à CETTE boule (il baisse au fil du
   tirage et disparaît quand le mode ne peut plus gagner), le rang de tirage au centre, les couleurs sorties, pair / impair et la somme des 6 premiers.
   Écran des résultats : toutes les boules, rang de sortie de chacune. */
PP.ready.then(function () {
  const $ = (id) => document.getElementById(id), body = document.body, DRAWN = 36, PER_SIDE = 18, MODES = 10;
  /* Chaque boule : le tambour tourne PAUSE secondes, puis la boule reste BALL secondes à l'écran avant que le tambour reparte. */
  const BALL = 1.43, PAUSE = 1.57, STEP = BALL + PAUSE;   // 3 s par boule
  /* Nombre de boules sorties à l'instant s.t du tirage. Si le tirage réglé est plus court que nécessaire, le rythme est resserré. */
  const targetAt = (s) => {
    const step = Math.max(0.6, Math.min(STEP, s.dur / DRAWN)), pause = step * PAUSE / STEP, k = Math.floor(s.t / step);
    return Math.min(DRAWN, k + (s.t - k * step >= pause ? 1 : 0));
  };
  const setTop = PP.topbar('LUCKY X');
  document.querySelector('#topbar .title').insertAdjacentHTML('beforeend', '<small class="lxsubt">CHOISISSEZ VOTRE MODE</small>');
  document.querySelector('#topbar .meta .lbl').innerHTML = 'NUMÉRO DE<br>ROUND';
  const drum = PP.drum($('drum'), 28);

  /* Anneaux lumineux : 1 rouge, 2 bleu, 3 vert, 4 jaune, 5 (0) violet — selon n modulo 5. */
  const RING = { 1: '#ff3b3b', 2: '#2f9bff', 3: '#22d65a', 4: '#ffd60a', 0: '#c14cff' };
  const ring = (n) => RING[n % 5];
  const COLOR_NAMES = [['ROUGE', 1], ['BLEU', 2], ['VERT', 3], ['JAUNE', 4], ['VIOLET', 0]];
  const ballHTML = (n, cls = '') => `<span class="lxb ${cls}" style="--c:${ring(n)}">${n}</span>`;
  const empty = '<span class="ball empty">0</span>';
  const modeLabel = (m) => m + (m === 1 ? ' BALLE' : ' BALLES');
  const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th');

  /* Pendant les mises : gain maximum de chaque mode (dernier numéro choisi sorti à la boule n° N). */
  $('tiers').innerHTML = Array.from({ length: MODES }, (_, i) => `<div class="t" style="opacity:1"><small>${modeLabel(i + 1)}</small><b>${PP.short(PP.luckyxPay(i + 1, i + 1))}</b></div>`).join('');

  /* Barre du bas : 10 modes, le rang de tirage entre le 5e et le 6e, puis couleurs / pair-impair / somme. */
  const tCell = (m) => `<div class="t" data-m="${m}"><small>${modeLabel(m)}</small><b>–</b></div>`;
  $('strip').innerHTML = '<div class="lxrow">' + Array.from({ length: 5 }, (_, i) => tCell(i + 1)).join('')
    + '<div class="seq"><b id="seqN">–</b><small>SÉQUENCE DE TIRAGE</small></div>' + Array.from({ length: 5 }, (_, i) => tCell(i + 6)).join('') + '</div>'
    + '<div class="lxline"></div>'
    + '<div class="lxsub"><div class="lxcols">' + COLOR_NAMES.map(([name, c]) => `<div class="c" style="--c:${RING[c]}"><small>${name}</small><span class="dash" id="dash${c}"></span></div>`).join('') + '</div>'
    + '<div class="lxpi"><div><small>PAIR</small><i><b id="evenBar"></b></i><em id="evenN">0</em></div><div><small>IMPAIR</small><i><b id="oddBar"></b></i><em id="oddN">0</em></div></div>'
    + '<div class="lxsum"><small>SOMME DES 6<br>PREMIERS NUMÉROS</small><b id="sum6">0</b></div></div>';

  /* Rang X : pour chaque mode N ≤ X, gain si le dernier numéro choisi sort à cette boule ; « – » quand le mode ne paie plus. */
  function showLadder(x) {
    document.querySelectorAll('#strip .lxrow .t').forEach((t) => {
      const m = +t.dataset.m, v = x === 0 ? PP.luckyxPay(m, m) : (m <= x ? PP.luckyxPay(m, x) : 0);
      t.querySelector('b').textContent = v ? PP.short(v) : '–';
      t.classList.toggle('dead', !v);
    });
  }
  /* Couleurs, pair / impair et somme des 6 premiers pour les n premières boules du tirage. */
  function showStats(list, into) {
    const col = { 1: 0, 2: 0, 3: 0, 4: 0, 0: 0 };
    let even = 0;
    list.forEach((n) => { col[n % 5]++; if (n % 2 === 0) even++; });
    const odd = list.length - even, sum = list.slice(0, 6).reduce((a, b) => a + b, 0), q = (id) => (into ? into.querySelector('[data-id="' + id + '"]') : $(id));
    for (const [, c] of COLOR_NAMES) q('dash' + c).style.setProperty('--n', col[c]);
    q('evenN').textContent = even; q('oddN').textContent = odd;
    q('evenBar').style.width = (list.length ? 100 * even / list.length : 0) + '%'; q('oddBar').style.width = (list.length ? 100 * odd / list.length : 0) + '%';
    q('sum6').textContent = sum;
  }

  showLadder(0);
  $('sl').innerHTML = $('sr').innerHTML = empty.repeat(PER_SIDE);
  // colonne c = i ÷ 6 (0-2 à gauche, 3-5 à droite), rangée = i mod 6 ; la grille de chaque côté a 3 colonnes de 6 rangées.
  const slotOf = (i) => { const col = Math.floor(i / 6); return (col < 3 ? $('sl') : $('sr')).children[(i % 6) * 3 + (col % 3)]; };
  let shown = 0, res = null, cur = '', drawing = false;

  const seqNow = () => (drawing ? (pendingPlace !== null ? shown : Math.min(DRAWN, shown + 1)) : (shown ? shown : 0));
  function refresh() {
    const x = seqNow();
    $('seqN').textContent = x || '–';
    showLadder(x);
    showStats(res ? res.draw.slice(0, shown) : [], null);
  }

  // La boule sortie apparaît d'abord en grand sur le tambour, puis rejoint sa place.
  const HOLD = BALL * 1000;
  let bigTimer = 0, placeTimer = 0, pendingPlace = null;
  function showBig(n) {
    const big = $('bigBall');
    big.style.setProperty('--bc', ring(n)); big.style.setProperty('--sph', PP.lxColor(n)); big.innerHTML = '<span>' + n + '</span>';
    big.classList.remove('on'); void big.offsetWidth; big.classList.add('on');
    clearTimeout(bigTimer); bigTimer = setTimeout(() => big.classList.remove('on'), HOLD);
  }
  function place(i) {
    const tmp = document.createElement('div'); tmp.innerHTML = ballHTML(res.draw[i], 'pop');
    slotOf(i).replaceWith(tmp.firstChild);
  }
  function flush() {
    clearTimeout(placeTimer);
    if (pendingPlace !== null && res) place(pendingPlace);
    pendingPlace = null;
    refresh();
  }
  function reveal(n) {
    if (!res) return;
    flush();
    if (n - shown === 1) {
      showBig(res.draw[shown]); pendingPlace = shown;
      placeTimer = setTimeout(flush, HOLD);
    } else {
      for (let i = shown; i < n; i++) place(i);
    }
    if (n > shown) shown = n;
    refresh();
  }
  /* Si le résultat arrive en retard (réseau lent), on ne montre pas d'un coup toutes les boules manquantes :
     on rattrape une boule à la fois, plus vite que le rythme normal. */
  let lastReveal = 0;
  function catchUp(target) {
    if (!res || target <= shown) return;
    const now = Date.now();
    if (target - shown > 1 && now - lastReveal < 300) return;
    lastReveal = now;
    reveal(target - shown > 1 ? shown + 1 : target);
  }

  /* Écran des résultats : toutes les boules, avec le rang de sortie de chacune (une seule fois par tour). */
  let resKey = '';
  /* Rang X → plus petit mode qui peut encore gagner à cette boule (« 1 BALLE », « 2 BALLES »… « 6+ BALLES »). */
  const lowestMode = (x) => { for (let m = 1; m <= MODES; m++) if (m <= x && x <= PP.luckyxLast(m)) return m; return MODES; };
  function sequenceRows(drawn) {
    const rows = [];
    for (let from = 0; from < drawn.length; from += 18) {
      const part = drawn.slice(from, from + 18), groups = [];
      part.forEach((_, i) => {
        const m = lowestMode(from + i + 1), g = groups[groups.length - 1];
        if (g && g.m === m) g.n++; else groups.push({ m, n: 1 });
      });
      rows.push('<div class="sq-row"><div class="sq-g">' + groups.map((g) => `<span style="grid-column:span ${g.n}">${g.m >= 6 && g.m === lowestMode(DRAWN) ? '6+ BALLES' : modeLabel(g.m)}</span>`).join('') + '</div>'
        + '<div class="sq-o">' + part.map((_, i) => `<i>${ordinal(from + i + 1)}</i>`).join('') + '</div>'
        + '<div class="sq-b">' + part.map((n) => ballHTML(n)).join('') + '</div></div>');
    }
    return rows.join('');
  }
  function renderResults(s) {
    const key = s.day + ':' + s.round;
    if (!res || resKey === key) return;
    resKey = key;
    const drawn = res.draw.slice(0, DRAWN), got = new Set(drawn);
    // Les 50 boules en 5 rangées de 10 : rouge (1, 6, 11…), bleu, vert, jaune, violet (5, 10, 15…). Les boules non sorties sont éteintes.
    const grid = [1, 2, 3, 4, 0].map((c) => Array.from({ length: 10 }, (_, k) => (c === 0 ? 5 * (k + 1) : c + 5 * k)));
    $('cyRes').innerHTML = '<div class="rs-left"><div class="rs-t">ROUND ' + PP.roundNo(s.round) + '<br><span>RÉSULTAT SPÉCIAL</span></div>'
      + '<div class="rs-fl"><div><small>PREMIÈRE BALLE</small><b style="color:' + ring(drawn[0]) + '">' + drawn[0] + '</b></div><div><small>DERNIÈRE BALLE</small><b style="color:' + ring(drawn[drawn.length - 1]) + '">' + drawn[drawn.length - 1] + '</b></div></div>'
      + '<div class="rs-st"><div class="lxsum"><small>SOMME DES 6<br>PREMIERS NUMÉROS</small><b data-id="sum6"></b></div>'
      + '<div class="lxcols">' + COLOR_NAMES.map(([name, c]) => `<div class="c" style="--c:${RING[c]}"><small>${name}</small><span class="dash" data-id="dash${c}"></span></div>`).join('') + '</div>'
      + '<div class="lxpi"><div><small>PAIR</small><i><b data-id="evenBar"></b></i><em data-id="evenN"></em></div><div><small>IMPAIR</small><i><b data-id="oddBar"></b></i><em data-id="oddN"></em></div></div></div></div>'
      + '<div class="rs-grid">' + grid.map((row) => row.map((n) => ballHTML(n, got.has(n) ? 'on' : 'off')).join('')).join('') + '</div>'
      + '<div class="rs-seq"><div class="rs-sqt">SÉQUENCE DE TIRAGE</div>' + sequenceRows(drawn) + '</div>';
    showStats(drawn, $('cyRes'));
  }
  function reset() {
    resKey = '';
    clearTimeout(placeTimer); pendingPlace = null; $('bigBall').classList.remove('on');
    shown = 0;
    $('sl').innerHTML = $('sr').innerHTML = empty.repeat(PER_SIDE);
    refresh();
  }

  PP.run('luckyx', {
    onPhase(s) {
      body.dataset.phase = s.phase;
      drawing = s.phase === 'draw';
      const key = (cur = s.day + ':' + s.round);
      if (s.phase === 'bet') {
        // Les boules du dernier tirage restent à l'écran pendant les mises ; après un rechargement de la page, on les récupère.
        if (shown === 0 && s.round > 1) PP.load('luckyx', s.day, s.round - 1).then((r) => { if (cur === key && shown === 0 && r) { res = r; reveal(DRAWN); showLadder(0); $('seqN').textContent = '–'; } });
        else { showLadder(0); $('seqN').textContent = '–'; }
      } else if (s.phase === 'draw') {
        reset(); res = null;
        PP.load('luckyx', s.day, s.round).then((r) => { if (cur === key) res = r; });
      } else {
        if (shown < DRAWN) PP.load('luckyx', s.day, s.round).then((r) => { if (cur === key) res = r; });
        $('doneRound').textContent = PP.roundNo(s.round);
      }
      drum.setSpeed(s.phase === 'draw' ? 1.6 : 1);
    },
    onTick(s) {
      setTop(s);
      if (s.phase === 'bet') {
        const slides = document.querySelectorAll('.promo .slide'), k = Math.floor(s.t / 5) % slides.length;
        slides.forEach((el, i) => el.classList.toggle('on', i === k));
        $('left').textContent = PP.clock(s.left);
      } else if (s.phase === 'draw') catchUp(targetAt(s));
      else { reveal(DRAWN); renderResults(s); }
    },
  });
});
