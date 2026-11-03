/* Écran TV : American Roulette.
   bet    → table à gauche, roue sur le côté, bandeau des types de mise
   draw   → la roue vient au CENTRE de l'écran et tourne
   result → numéro gagnant + mises gagnantes sur la table */
PP.ready.then(function () {
  const R = PP.R, $ = (id) => document.getElementById(id);
  const stage = $('stage'), tableEl = $('table'), hub = $('hub'), clock = $('wClock');
  const setTop = PP.topbar('AMERICAN ROULETTE');

  R.buildTable(tableEl);
  const wheel = R.buildWheel($('wheel'));
  const th = wheel.step;

  const INFOS = [
    { grp: 'INSIDE BETTINGS', name: 'STRAIGHT UP', code: 'S1', desc: 'Pick any single number', x: 36, keys: ['n:17'] },
    { grp: 'INSIDE BETTINGS', name: 'STREET', code: 'T1', desc: 'Pick 3 numbers in a vertical line', x: 12, keys: ['st:19'] },
    { grp: 'INSIDE BETTINGS', name: 'SIX LINE', code: 'SL', desc: 'Pick 2 vertical lines', x: 6, keys: ['six:31'] },
    { grp: 'INSIDE BETTINGS', name: 'BASKET', code: 'B1', desc: 'Pick zero, double zero, 1, 2 and 3', x: 7, keys: ['n:0', 'n:00', 'n:1', 'n:2', 'n:3'] },
    { grp: 'OUTSIDE BETTINGS', name: 'COLUMN', code: 'H2', desc: 'Pick all numbers in second horizontal line', x: 3, keys: ['col:2'] },
    { grp: 'OUTSIDE BETTINGS', name: 'DOZEN', code: 'D3', desc: 'Pick the third group of 12 numbers', x: 3, keys: ['doz:3'] },
    { grp: 'OUTSIDE BETTINGS', name: 'RED / BLACK', code: 'RB', desc: 'Pick the colour of the winning number', x: 2, keys: ['red', 'black'] },
    { grp: 'OUTSIDE BETTINGS', name: 'ODD / EVEN', code: 'OE', desc: 'Pick odd or even', x: 2, keys: ['odd', 'even'] },
    { grp: 'OUTSIDE BETTINGS', name: 'LOW / HIGH', code: 'LH', desc: 'Pick 1-18 or 19-36', x: 2, keys: ['low', 'high'] },
  ];
  let infoIdx = -1, cur = '';
  function showInfo(i) {
    if (i === infoIdx) return;
    infoIdx = i;
    const f = INFOS[i];
    $('infoGrp').textContent = f.grp; $('infoName').textContent = f.name; $('infoCode').textContent = f.x.toFixed(2).replace('.', ',');
    $('infoDesc').textContent = f.desc; $('infoWager').textContent = 'X WAGER';
    $('info').classList.add('on');   // la barre n'apparaît qu'une fois remplie : plus de barre vide au démarrage
    tableEl.classList.add('focus');
    const cells = new Set(f.keys.flatMap((k) => /^(st|six):/.test(k) ? R.keyNumbers(k).map((n) => 'n:' + n) : [k]));
    tableEl.querySelectorAll('.rc').forEach((c) => c.classList.toggle('hl', cells.has(c.dataset.key)));
  }
  function clearFocus() { infoIdx = -1; tableEl.classList.remove('focus'); tableEl.querySelectorAll('.rc').forEach((c) => c.classList.remove('hl', 'win')); }

  /* ---- Roue ---- */
  let rotorAngle = 0;   // angle visuel (mod 360) après le dernier tirage
  const setT = (el, dur, ease) => { el.style.transition = dur ? `transform ${dur}s ${ease}` : 'none'; };

  /* Pendant les mises la roue, rangée sur le côté droit, tourne doucement (6° par seconde) ; le tirage repart de cet angle. */
  let idleOn = false, idleLast = 0;
  function idleFrame(ts) {
    if (!idleOn) return;
    if (idleLast) {
      rotorAngle += ((ts - idleLast) / 1000) * 6;
      wheel.rotor.style.transform = `rotate(${rotorAngle}deg)`;
    }
    idleLast = ts;
    requestAnimationFrame(idleFrame);
  }
  function setIdle(on) {
    if (on === idleOn) return;
    idleOn = on; idleLast = 0;
    if (on) { setT(wheel.rotor, 0); setT(wheel.ball, 0); wheel.ball.style.transform = 'rotate(0deg)'; requestAnimationFrame(idleFrame); }
  }

  function spin(s, n, resume) {
    const k = R.ORDER.indexOf(n), remaining = s.dur - s.t;
    const rotor = wheel.rotor, ball = wheel.ball;
    wheel.ballDot.classList.remove('in', 'drop');
    setT(rotor, 0); setT(ball, 0);
    rotor.style.transform = `rotate(${rotorAngle}deg)`; ball.style.transform = 'rotate(0deg)';
    void rotor.getBoundingClientRect();
    setT(rotor, remaining, 'cubic-bezier(.1,.55,.2,1)'); setT(ball, remaining, 'cubic-bezier(.25,.45,.25,1)');
    rotorAngle = -k * th;
    rotor.style.transform = `rotate(${rotorAngle - 360 * 6}deg)`;
    ball.style.transform = `rotate(${360 * 8}deg)`;
  }
  function settle(n) {
    const k = R.ORDER.indexOf(n);
    rotorAngle = -k * th;
    setT(wheel.rotor, 0); setT(wheel.ball, 0);
    wheel.rotor.style.transform = `rotate(${rotorAngle}deg)`; wheel.ball.style.transform = 'rotate(0deg)';
    wheel.ballDot.classList.add('in');
  }

  function renderLatest(s) {
    PP.recent('roulette', s, 50).then((list) => {
      $('latest').innerHTML = '<span>LATEST RESULTS</span>' + list.slice(0, 10).map((r) => `<span class="chip ${R.color(r.n)}">${r.n}</span>`).join('');
      const counts = {};
      list.forEach((r) => { counts[r.n] = (counts[r.n] || 0) + 1; });
      wheel.setStats(counts, list.map((r) => r.n));
    });
  }

  /* Le résultat vient du serveur au début du tirage ; on applique la phase d'après l'heure d'arrivée. */
  function show(res, first) {
    const s = PP.state('roulette');
    if (s.phase === 'draw') { clearFocus(); spin(s, res.n); }
    if (s.phase === 'result') {
      if (first) settle(res.n); else wheel.ballDot.classList.add('in');
      const keys = new Set(R.winKeys(res.n));
      tableEl.classList.add('focus');
      tableEl.querySelectorAll('.rc').forEach((c) => { const w = keys.has(c.dataset.key); c.classList.toggle('win', w); c.classList.toggle('hl', w); });
      const num = $('resNum'); num.textContent = res.n; num.className = 'num ' + R.color(res.n);
    }
  }

  PP.run('roulette', {
    onPhase(s, first) {
      stage.dataset.phase = s.phase;
      renderLatest(s);
      setIdle(s.phase === 'bet');
      if (s.phase === 'bet') { clearFocus(); wheel.ballDot.classList.remove('in', 'drop'); return; }
      const key = (cur = s.day + ':' + s.round);
      PP.load('roulette', s.day, s.round).then((res) => { if (res && cur === key) show(res, first); });
    },
    onTick(s) {
      setTop(s);
      /* Compte à rebours des mises : au-dessus de la roue, puis dans son cœur pendant les 20 dernières secondes. */
      const inside = s.phase === 'bet' && s.left <= 20, above = s.phase === 'bet' && s.left > 20;
      if (s.phase === 'bet') showInfo(Math.floor(s.t / 3) % INFOS.length);
      hub.textContent = inside ? PP.clock(s.left) : '';
      hub.classList.toggle('on', inside);
      clock.textContent = above ? PP.clock(s.left) : '';
      clock.classList.toggle('on', above);
      /* La bille rebondit sur les butées puis tombe dans la case sur les dernières secondes du tirage. */
      if (s.phase === 'draw' && s.left < 4) wheel.ballDot.classList.add('drop');
      if (s.phase === 'draw' && s.left < 2.4) wheel.ballDot.classList.add('in');
    },
  });
});
