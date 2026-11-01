/* Écran TV : Lucky X. 36 boules sur 80, annoncées dans l'ordre croissant : 18 de chaque côté du tambour (3 rangées de 6) ;
   paliers N boules en bas, numéro de séquence au centre. */
PP.ready.then(function () {
  const $ = (id) => document.getElementById(id), body = document.body, STEP = 0.62, DRAWN = 36, PER_SIDE = 18;
  const setTop = PP.topbar('LUCKY X');
  const drum = PP.drum($('drum'), 28);

  const ballHTML = (n, cls = '') => `<span class="ball ${cls}" style="background:${PP.ballColor(n)};color:${PP.ballText(n)}">${n}</span>`;
  const empty = '<span class="ball empty">0</span>';
  const tiers = Object.entries(PP.LUCKYX_TIERS);

  $('sl').innerHTML = $('sr').innerHTML = empty.repeat(PER_SIDE);
  $('tiers').innerHTML = tiers.map(([n, v]) => `<div class="t" style="opacity:1"><small>${n} BALLS</small><b>${PP.short(v)}</b></div>`).join('');
  $('strip').innerHTML = tiers.slice(0, 4).map(([n, v]) => `<div class="t" data-n="${n}"><small>${n} BALLS</small><b>${PP.short(v)}</b></div>`).join('')
    + '<div class="seq"><b id="seqN">–</b><small>DRAW SEQUENCE</small></div>'
    + tiers.slice(4).map(([n, v]) => `<div class="t" data-n="${n}"><small>${n} BALLS</small><b>${PP.short(v)}</b></div>`).join('');

  const slotOf = (i) => (i < PER_SIDE ? $('sl') : $('sr')).children[i % PER_SIDE];
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
      res = null;
      if (s.phase === 'bet') reset();
      else PP.load('luckyx', s.day, s.round).then((r) => { if (cur === key) res = r; });
      if (s.phase === 'result') $('doneRound').textContent = s.round;
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
