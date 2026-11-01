/* Écran TV : Keno 20/80. 20 numéros tirés un par un ; la phase de mise fait défiler la table de gains. */
PP.ready.then(function () {
  const $ = (id) => document.getElementById(id), body = document.body, STEP = 1.5;
  const setTop = PP.topbar('KENO');

  const cells = {};
  for (let n = 1; n <= 80; n++) {
    const d = document.createElement('div'); d.className = 'k-cell'; d.textContent = n;
    cells[n] = d; $(n <= 40 ? 'gl' : 'gr').appendChild(d);
  }
  $('seq').innerHTML = Array.from({ length: 20 }, () => '<div class="d">·</div>').join('');
  const dots = $('seq').children;

  let shown = 0, res = null, payIdx = -1, cur = '';

  function renderPay(n) {
    if (n === payIdx) return; payIdx = n;
    $('payN').textContent = n;
    const table = PP.KENO_PAY[n], hits = Object.keys(table).map(Number).sort((a, b) => b - a);
    const topHit = hits[0];
    $('payTbl').innerHTML = hits.map((h) => `
      <div class="col ${h === topHit ? 'top' : ''}">
        <div class="h">${h}<small>HITS</small></div>
        <div class="w"><small>WIN</small>${PP.short(table[h])}</div>
      </div>`).join('');
  }
  function reveal(n) {
    if (!res) return;
    for (let i = shown; i < n; i++) {
      cells[res.draw[i]].classList.add('hit');
      dots[i].classList.add('on'); dots[i].textContent = res.draw[i];
    }
    if (n > shown) {
      shown = n;
      const k = $('kball'); k.textContent = res.draw[n - 1];
      k.classList.remove('pop'); void k.offsetWidth; k.classList.add('pop');
    }
  }
  function reset() {
    shown = 0; $('kball').textContent = '–';
    Object.values(cells).forEach((c) => c.classList.remove('hit'));
    [...dots].forEach((d) => { d.classList.remove('on'); d.textContent = '·'; });
  }

  PP.run('keno', {
    onPhase(s) {
      body.dataset.phase = s.phase;
      const key = (cur = s.day + ':' + s.round);
      res = null;
      if (s.phase === 'bet') reset();
      else PP.load('keno', s.day, s.round).then((r) => { if (cur === key) res = r; });
    },
    onTick(s) {
      setTop(s);
      if (s.phase === 'bet') {
        renderPay(Math.floor(s.t / 2) % 10 + 1);
        $('payLeft').textContent = PP.clock(s.left);
      } else if (s.phase === 'draw') reveal(Math.min(20, Math.floor(s.t / STEP) + 1));
      else reveal(20);
    },
  });
});
