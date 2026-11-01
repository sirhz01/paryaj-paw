/* Écran TV : Lucky Six. 35 boules sur 48 ; les 5 premières sont les « pre-numbers »,
   les boules 6 à 35 tombent chacune sur un palier de gain (LUCKY_LADDER). */
PP.ready.then(function () {
  const $ = (id) => document.getElementById(id), body = document.body, STEP = 0.9;
  const setTop = PP.topbar('LUCKY SIX');
  const drum = PP.drum($('drum'), 30);

  const ballHTML = (n, cls = '') => `<span class="ball ${cls}" style="background:${PP.ballColor(n)};color:${PP.ballText(n)}">${n}</span>`;
  const empty = '<span class="ball empty">0</span>';

  $('pre').innerHTML = empty.repeat(5);
  $('grid').innerHTML = PP.LUCKY_LADDER.map((p) => `<div class="slot">${empty}<span class="pz">${PP.short(p)}</span></div>`).join('');
  $('legend').innerHTML = [1, 2, 3, 4, 5, 6, 7, 0].map((n) => ballHTML(n, '').replace(/>\d+</, '><')).join('');

  const preEls = $('pre').children, slots = $('grid').children;
  let shown = 0, res = null, cur = '';

  function barsHTML(counts, idxs) {
    return idxs.map((c) => `<div class="cb"><i style="width:${counts[c] * 14}%;background:${PP.COLORS[c]}"></i><b>${counts[c]}</b></div>`).join('');
  }
  function renderColours(n) {
    const counts = Array(8).fill(0);
    (res ? res.draw.slice(0, n) : []).forEach((x) => counts[x % 8]++);
    $('cbL').innerHTML = barsHTML(counts, [1, 2, 3, 4]);
    $('cbR').innerHTML = barsHTML(counts, [5, 6, 7, 0]);
  }
  function renderSum(n) {
    if (n < 5) { $('sum').innerHTML = ''; return; }
    const sum = res.draw.slice(0, 5).reduce((a, b) => a + b, 0);
    $('sum').innerHTML = `PRE-NUMBERS SUM (−122.5+)<b>${sum}</b><span class="oe">${sum < 122.5 ? 'UNDER' : 'OVER'} · ${sum % 2 ? 'ODD' : 'EVEN'}</span>`;
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
    if (n > shown) { shown = n; $('cur').innerHTML = ballHTML(res.draw[n - 1]); renderSum(n); renderColours(n); }
  }
  function reset() {
    shown = 0; $('cur').innerHTML = '';
    $('pre').innerHTML = empty.repeat(5);
    [...slots].forEach((s) => { s.classList.remove('hit'); if (s.firstChild.classList.contains('ball')) s.firstChild.replaceWith(Object.assign(document.createElement('div'), { innerHTML: empty }).firstChild); });
    renderSum(0); renderColours(0);
  }

  PP.run('luckysix', {
    onPhase(s) {
      body.dataset.phase = s.phase;
      const key = (cur = s.day + ':' + s.round);
      res = null;
      if (s.phase === 'bet') { reset(); $('nextRound').textContent = s.round; }
      else PP.load('luckysix', s.day, s.round).then((r) => { if (cur === key) res = r; });
      $('drumBox').classList.toggle('hidden', s.phase === 'result');
      $('resBox').classList.toggle('hidden', s.phase !== 'result');
      if (s.phase === 'result') $('resBox').textContent = 'RESULTS ROUND ' + s.round;
      drum.setSpeed(s.phase === 'draw' ? 1.6 : 1);
    },
    onTick(s) {
      setTop(s);
      if (s.phase === 'bet') {
        const slides = document.querySelectorAll('.promo .slide'), k = Math.floor(s.t / 10) % slides.length;
        slides.forEach((el, i) => el.classList.toggle('on', i === k));
        $('count').textContent = PP.clock(s.left);
      } else if (s.phase === 'draw') {
        reveal(Math.min(35, Math.floor(s.t / STEP) + 1));
      } else {
        reveal(35);
      }
    },
  });
});
