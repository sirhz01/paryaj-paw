/* Écran TV : Lucky X. 36 boules sur 50, annoncées dans l'ordre croissant, en 6 colonnes de 6 boules (3 colonnes de chaque côté du tambour) ;
   chaque colonne se remplit de haut en bas avant de passer à la suivante ;
   paliers N boules en bas, numéro de séquence au centre. */
PP.ready.then(function () {
  const $ = (id) => document.getElementById(id), body = document.body, DRAWN = 36, PER_SIDE = 18;
  /* Chaque boule : le tambour tourne PAUSE secondes, puis la boule reste BALL secondes à l'écran avant que le tambour reparte. */
  const BALL = 1.14, PAUSE = 1.26, STEP = BALL + PAUSE;   // 2,4 s par boule
  /* Nombre de boules sorties à l'instant s.t du tirage. Si le tirage réglé est plus court que nécessaire, le rythme est resserré. */
  const targetAt = (s) => {
    const step = Math.max(0.6, Math.min(STEP, s.dur / DRAWN)), pause = step * PAUSE / STEP, k = Math.floor(s.t / step);
    return Math.min(DRAWN, k + (s.t - k * step >= pause ? 1 : 0));
  };
  const setTop = PP.topbar('LUCKY X');
  const drum = PP.drum($('drum'), 28);

  const ballHTML = (n, cls = '') => `<span class="ball ${cls}" style="background:${PP.lxColor(n)};color:${PP.lxText(n)}">${n}</span>`;
  const empty = '<span class="ball empty">0</span>';
  // Paliers affichés de 2 BALLS à 10 BALLS.
  const tiers = Object.entries(PP.LUCKYX_TIERS);

  $('sl').innerHTML = $('sr').innerHTML = empty.repeat(PER_SIDE);
  $('tiers').innerHTML = tiers.map(([n, v]) => `<div class="t" style="opacity:1"><small>${n} BALLS</small><b>${PP.short(v)}</b></div>`).join('');
  $('strip').innerHTML = tiers.slice(0, 4).map(([n, v]) => `<div class="t" data-n="${n}"><small>${n} BALLS</small><b>${PP.short(v)}</b></div>`).join('')
    + '<div class="seq"><b id="seqN">–</b><small>DRAW SEQUENCE</small></div>'
    + tiers.slice(4).map(([n, v]) => `<div class="t" data-n="${n}"><small>${n} BALLS</small><b>${PP.short(v)}</b></div>`).join('');

  // colonne c = i ÷ 6 (0-2 à gauche, 3-5 à droite), rangée = i mod 6 ; la grille de chaque côté a 3 colonnes de 6 rangées.
  const slotOf = (i) => { const col = Math.floor(i / 6); return (col < 3 ? $('sl') : $('sr')).children[(i % 6) * 3 + (col % 3)]; };
  let shown = 0, res = null, cur = '';

  // La boule sortie apparaît d'abord en grand sur le tambour, puis rejoint sa place.
  const HOLD = BALL * 1000;
  let bigTimer = 0, placeTimer = 0, pendingPlace = null;
  function showBig(n) {
    const big = $('bigBall');
    big.style.setProperty('--bc', PP.lxColor(n)); big.innerHTML = '<span>' + n + '</span>';
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
    if (n > shown) {
      shown = n; $('seqN').textContent = n;
      document.querySelectorAll('.cy-strip .t').forEach((t) => t.classList.toggle('on', +t.dataset.n <= n));
    }
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
  /* Écran des résultats : les boules tirées, ensemble et dans l'ordre du tirage (une seule fois par tour). */
  let resKey = '';
  function renderResults(s) {
    const key = s.day + ':' + s.round;
    if (!res || resKey === key) return;
    resKey = key;
    const drawn = res.draw.slice(0, DRAWN), got = new Set(drawn);
    // Les 50 boules, rangée par couleur : rouge (1, 6, 11…), bleu, vert, jaune, mauve (5, 10, 15…).
    const all = [1, 2, 3, 4, 0].flatMap((c) => Array.from({ length: 10 }, (_, k) => (c === 0 ? 5 * (k + 1) : c + 5 * k)));
    $('cyRes').innerHTML = '<div class="rt">RESULTS ROUND ' + s.round + '</div>'
      + '<div class="rall">' + all.map((n) => ballHTML(n, got.has(n) ? 'on' : 'off')).join('') + '</div>'
      + '<div class="rfl"><div><small>FIRST BALL</small>' + ballHTML(drawn[0]) + '</div><div><small>LAST BALL</small>' + ballHTML(drawn[drawn.length - 1]) + '</div></div>'
      + '<div class="rdr">' + drawn.map((n) => ballHTML(n)).join('') + '</div>';
  }
  function reset() {
    resKey = '';
    clearTimeout(placeTimer); pendingPlace = null; $('bigBall').classList.remove('on');
    shown = 0; $('seqN').textContent = '–';
    $('sl').innerHTML = $('sr').innerHTML = empty.repeat(PER_SIDE);
    document.querySelectorAll('.cy-strip .t').forEach((t) => t.classList.remove('on'));
  }

  PP.run('luckyx', {
    onPhase(s) {
      body.dataset.phase = s.phase;
      const key = (cur = s.day + ':' + s.round);
      if (s.phase === 'bet') {
        // Les boules du dernier tirage restent à l'écran pendant les mises ; après un rechargement de la page, on les récupère.
        if (shown === 0 && s.round > 1) PP.load('luckyx', s.day, s.round - 1).then((r) => { if (cur === key && shown === 0 && r) { res = r; reveal(DRAWN); } });
      } else if (s.phase === 'draw') {
        reset(); res = null;
        PP.load('luckyx', s.day, s.round).then((r) => { if (cur === key) res = r; });
      } else {
        if (shown < DRAWN) PP.load('luckyx', s.day, s.round).then((r) => { if (cur === key) res = r; });
        $('doneRound').textContent = s.round;
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
