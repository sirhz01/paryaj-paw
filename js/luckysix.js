/* Écran TV : Lucky Six. 35 boules sur 48 ; les 5 premières sont les « pre-numbers »,
   les boules 6 à 35 tombent chacune sur un palier de gain (LUCKY_LADDER). */
PP.ready.then(function () {
  const $ = (id) => document.getElementById(id), body = document.body;
  /* Chaque boule : le tambour tourne PAUSE secondes, puis la boule reste BALL secondes à l'écran avant que le tambour reparte. */
  const BALL = 1.43, PAUSE = 1.57, STEP = BALL + PAUSE;   // 3 s par boule
  /* Nombre de boules sorties à l'instant s.t du tirage. Si le tirage réglé est plus court que nécessaire, le rythme est resserré. */
  const targetAt = (s) => {
    const step = Math.max(0.6, Math.min(STEP, s.dur / 35)), pause = step * PAUSE / STEP, k = Math.floor(s.t / step);
    return Math.min(35, k + (s.t - k * step >= pause ? 1 : 0));
  };
  const setTop = PP.topbar('LUCKY SIX');
  const drum = PP.drum($('drum'), 30);

  const ballHTML = (n, cls = '') => `<span class="ball lsb ${cls}" style="--bc:${PP.ballColor(n)}">${n}</span>`;
  const empty = '<span class="ball empty">0</span>';

  $('pre').innerHTML = empty.repeat(5);
  $('grid').innerHTML = PP.LUCKY_LADDER.map((p) => `<div class="slot">${empty}<span class="pz">${PP.short(p)}</span></div>`).join('');
  $('legend').innerHTML = [1, 2, 3, 4, 5, 6, 7, 0].map((n) => ballHTML(n, '').replace(/>\d+</, '><')).join('');

  const preEls = $('pre').children, slots = $('grid').children;
  let shown = 0, res = null, cur = '';

  /* Barre du bas : paris sur la couleur (nombre de boules de chaque couleur), somme des 5 pre-numbers, pair / impair. */
  const BAR_ORDER = [2, 1, 3, 4, 5, 6, 7, 0];
  function renderColours(n) {
    const counts = Array(8).fill(0), drawn = res ? res.draw.slice(0, n) : [];
    drawn.forEach((x) => counts[x % 8]++);
    $('cbars').innerHTML = BAR_ORDER.map((c) => `<i style="--c:${PP.COLORS[c]};--h:${Math.min(100, 12 + counts[c] * 14)}" title="${counts[c]}"></i>`).join('');
    const even = drawn.filter((x) => x % 2 === 0).length, odd = drawn.length - even;
    $('evenN').textContent = even; $('oddN').textContent = odd;
    $('evenBar').style.width = (even / 35 * 100) + '%'; $('oddBar').style.width = (odd / 35 * 100) + '%';
    // Écran des résultats : barres horizontales, quatre couleurs de chaque côté du titre.
    const rows = (list) => list.map((c) => `<div class="cb-r" title="${counts[c]}"><i style="--c:${PP.COLORS[c]};--w:${Math.min(100, counts[c] * 13)}"></i><b>${counts[c]}</b></div>`).join('');
    $('colBet').innerHTML = `<div class="cb-g l">${rows(BAR_ORDER.slice(0, 4))}</div><div class="cb-t">Colour betting</div><div class="cb-g r">${rows(BAR_ORDER.slice(4))}</div>`;
  }
  function renderSum(n) {
    if (n < 5) { $('sum').innerHTML = ''; $('info').innerHTML = ''; return; }
    const sum = res.draw.slice(0, 5).reduce((a, b) => a + b, 0), oddPre = res.draw.slice(0, 5).filter((x) => x % 2).length;
    // Écran des résultats : somme des pre-numbers et parité majoritaire des 5 pre-numbers.
    $('info').innerHTML = `<div><span>Pre-numbers sum (−122,5+)</span><b>${sum}</b></div><div><span>Even/Odd Pre Numbers</span><b>${oddPre > 2 ? 'Odd' : 'Even'}</b></div>`;
    $('sum').innerHTML = `<span class="t">PREBALLS<br>SUM −122,5+</span><b>${sum}</b><span class="oe">${sum < 122.5 ? 'UNDER' : 'OVER'} · ${sum % 2 ? 'ODD' : 'EVEN'}</span>`;
  }
  /* Grosse boule qui sort du tambour à chaque tirage, puis le tambour redevient visible. */
  let bigTimer = null;
  function showBig(n) {
    const big = $('bigBall');
    big.style.setProperty('--bc', PP.ballColor(n)); big.innerHTML = '<span>' + n + '</span>';
    big.classList.remove('on'); void big.offsetWidth; big.classList.add('on');
    clearTimeout(bigTimer); bigTimer = setTimeout(() => big.classList.remove('on'), BALL * 1000);
  }
  function reveal(n) {
    if (!res) return;
    for (let i = shown; i < n; i++) {
      const ball = res.draw[i], tmp = document.createElement('div');
      tmp.innerHTML = ballHTML(ball, 'pop');
      const node = tmp.firstChild;
      if (i < 5) preEls[i].replaceWith(node);
      else { const slot = slots[i - 5]; slot.firstChild.replaceWith(node); slot.classList.add('hit'); }
    }
    if (n > shown) { if (n - shown === 1) showBig(res.draw[n - 1]); shown = n; renderSum(n); renderColours(n); }
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
  function reset() {
    shown = 0; $('bigBall').classList.remove('on');
    $('pre').innerHTML = empty.repeat(5);
    [...slots].forEach((s) => { s.classList.remove('hit'); if (s.firstChild.classList.contains('ball')) s.firstChild.replaceWith(Object.assign(document.createElement('div'), { innerHTML: empty }).firstChild); });
    renderSum(0); renderColours(0);
  }

  PP.run('luckysix', {
    onPhase(s) {
      body.dataset.phase = s.phase;
      const key = (cur = s.day + ':' + s.round);
      $('curDraw').textContent = PP.roundNo(s.phase === 'bet' ? Math.max(1, s.round - 1) : s.round);   // pendant les mises : le dernier tirage
      if (s.phase === 'bet') {
        $('nextRound').textContent = PP.roundNo(s.round);
        // Les boules du dernier tirage restent à l'écran pendant les mises ; après un rechargement de la page, on les récupère.
        if (shown === 0 && s.round > 1) PP.load('luckysix', s.day, s.round - 1).then((r) => { if (cur === key && shown === 0 && r) { res = r; reveal(35); } });
      } else if (s.phase === 'draw') {
        reset(); res = null;
        PP.load('luckysix', s.day, s.round).then((r) => { if (cur === key) res = r; });
      } else if (shown < 35) PP.load('luckysix', s.day, s.round).then((r) => { if (cur === key) res = r; });
      $('drumBox').classList.toggle('hidden', s.phase !== 'draw');
      $('resBox').classList.toggle('hidden', s.phase === 'draw' || (s.phase === 'bet' && s.round < 2));
      $('resBox').textContent = s.phase === 'result' ? 'RESULTS ROUND ' + PP.roundNo(s.round) : 'LAST DRAW · ROUND ' + PP.roundNo(s.round - 1);
      drum.setSpeed(s.phase === 'draw' ? 1.6 : 1);
    },
    onTick(s) {
      setTop(s);
      if (s.phase === 'bet') {
        const slides = document.querySelectorAll('.promo .slide'), k = Math.floor(s.t / 10) % slides.length;
        slides.forEach((el, i) => el.classList.toggle('on', i === k));
        $('count').textContent = PP.clock(s.left);
      } else if (s.phase === 'draw') {
        catchUp(targetAt(s));
      } else {
        reveal(35);
      }
    },
  });
});
