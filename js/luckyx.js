/* Écran TV : Lucky X. 36 boules sur 50, annoncées dans l'ordre croissant, en 6 colonnes de 6 boules (3 colonnes de chaque côté du tambour) ;
   chaque colonne se remplit de haut en bas avant de passer à la suivante ;
   paliers N boules en bas, numéro de séquence au centre. */
PP.ready.then(function () {
  const $ = (id) => document.getElementById(id), body = document.body, STEP = 0.62, DRAWN = 36, PER_SIDE = 18;
  const setTop = PP.topbar('LUCKY X');
  const drum = PP.drum($('drum'), 28);

  const ballHTML = (n, cls = '') => `<span class="ball ${cls}" style="background:${PP.lxColor(n)};color:${PP.lxText(n)}">${n}</span>`;
  const empty = '<span class="ball empty">0</span>';
  const tiers = Object.entries(PP.LUCKYX_TIERS);

  $('sl').innerHTML = $('sr').innerHTML = empty.repeat(PER_SIDE);
  $('tiers').innerHTML = tiers.map(([n, v]) => `<div class="t" style="opacity:1"><small>${n} BALLS</small><b>${PP.short(v)}</b></div>`).join('');
  $('strip').innerHTML = tiers.slice(0, 4).map(([n, v]) => `<div class="t" data-n="${n}"><small>${n} BALLS</small><b>${PP.short(v)}</b></div>`).join('')
    + '<div class="seq"><b id="seqN">–</b><small>DRAW SEQUENCE</small></div>'
    + tiers.slice(4).map(([n, v]) => `<div class="t" data-n="${n}"><small>${n} BALLS</small><b>${PP.short(v)}</b></div>`).join('');

  // colonne c = i ÷ 6 (0-2 à gauche, 3-5 à droite), rangée = i mod 6 ; la grille de chaque côté a 3 colonnes de 6 rangées.
  const slotOf = (i) => { const col = Math.floor(i / 6); return (col < 3 ? $('sl') : $('sr')).children[(i % 6) * 3 + (col % 3)]; };
  let shown = 0, res = null, cur = '';

  function reveal(n) {
    if (!res) return;
    for (let i = shown; i < n; i++) {
      const tmp = document.createElement('div'); tmp.innerHTML = ballHTML(res.draw[i], 'pop');
      slotOf(i).replaceWith(tmp.firstChild);
    }
    if (n > shown) {
      shown = n; $('seqN').textContent = n;
      document.querySelectorAll('.cy-strip .t').forEach((t) => t.classList.toggle('on', +t.dataset.n <= n));
    }
  }
  function reset() {
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
      } else if (s.phase === 'draw') reveal(Math.min(DRAWN, Math.floor(s.t / STEP) + 1));
      else reveal(DRAWN);
    },
  });
});
