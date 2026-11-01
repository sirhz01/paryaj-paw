/* Roulette américaine : roue, table, mises, cotes. Partagé entre l'écran TV et la caisse. */
(function () {
  const R = PP.R = {};

  R.ORDER = ['0', '28', '9', '26', '30', '11', '7', '20', '32', '17', '5', '22', '34', '15', '3', '24', '36', '13', '1',
    '00', '27', '10', '25', '29', '12', '8', '19', '31', '18', '6', '21', '33', '16', '4', '23', '35', '14', '2'];
  const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

  R.color = (n) => (n === '0' || n === '00') ? 'green' : REDS.has(+n) ? 'red' : 'black';

  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));

  /* Clés de mise : n:17  st:19  six:31  col:1-3  doz:1-3  red black even odd low high */
  R.keyNumbers = function (key) {
    const [k, v] = key.split(':'), x = +v;
    const all = range(1, 36);
    switch (k) {
      case 'n': return [v];
      case 'st': return range(x, x + 2);
      case 'six': return range(x, x + 5);
      case 'col': return all.filter((n) => n % 3 === x % 3);
      case 'doz': return range((x - 1) * 12 + 1, x * 12);
      case 'red': return all.filter((n) => R.color(n) === 'red');
      case 'black': return all.filter((n) => R.color(n) === 'black');
      case 'even': return all.filter((n) => n % 2 === 0);
      case 'odd': return all.filter((n) => n % 2 === 1);
      case 'low': return range(1, 18);
      case 'high': return range(19, 36);
    }
    return [];
  };

  /* Cote totale (mise comprise), comme sur les tickets de la boutique. */
  R.odds = (key) => ({ n: 36, st: 12, six: 6, col: 3, doz: 3, red: 2, black: 2, even: 2, odd: 2, low: 2, high: 2 })[key.split(':')[0]];

  R.label = function (key) {
    const [k, v] = key.split(':');
    return ({ n: 'Pari simple', st: 'Street', six: 'Six lignes', col: 'Colonne ' + v, doz: 'Douzaine ' + v,
      red: 'Rouge', black: 'Noir', even: 'Pair', odd: 'Impair', low: 'Manque 1-18', high: 'Passe 19-36' })[k];
  };

  R.winKeys = function (n) {
    const keys = ['n:' + n];
    if (n === '0' || n === '00') return keys;
    const x = +n;
    keys.push('col:' + (x % 3 === 0 ? 3 : x % 3), 'doz:' + Math.ceil(x / 12), R.color(n), x % 2 ? 'odd' : 'even', x <= 18 ? 'low' : 'high');
    return keys;
  };

  R.wins = (key, n) => R.keyNumbers(key).includes(n);

  /* Table de mise : 00 / 0, 12 colonnes de 3, colonnes, douzaines, chances simples. */
  R.buildTable = function (root, onCell) {
    root.innerHTML = '';
    root.classList.add('rt');
    const add = (cls, text, key, col, row, cs = 1, rs = 1) => {
      const d = document.createElement('div');
      d.className = 'rc ' + cls;
      d.textContent = text;
      d.dataset.key = key;
      d.style.gridColumn = `${col} / span ${cs}`;
      d.style.gridRow = `${row} / span ${rs}`;
      if (onCell) d.addEventListener('click', () => onCell(key, d));
      root.appendChild(d);
    };
    add('zero', '00', 'n:00', 1, 1, 1, 3);
    add('zero', '0', 'n:0', 1, 4, 1, 3);
    for (let c = 0; c < 12; c++) for (let r = 0; r < 3; r++) {
      const n = 3 * c + 3 - r;
      add('num ' + R.color(String(n)), n, 'n:' + n, c + 2, r * 2 + 1, 1, 2);
    }
    add('side', '3rd col.', 'col:3', 14, 1, 1, 2);
    add('side', '2nd col.', 'col:2', 14, 3, 1, 2);
    add('side', '1st col.', 'col:1', 14, 5, 1, 2);
    ['1st 12', '2nd 12', '3rd 12'].forEach((t, i) => add('side', t, 'doz:' + (i + 1), 2 + i * 4, 7, 4));
    [['LOW', 'low', ''], ['EVEN', 'even', ''], ['RED', 'red', 'is-red'], ['BLACK', 'black', 'is-black'], ['ODD', 'odd', ''], ['HIGH', 'high', '']]
      .forEach(([t, k, c], i) => add('side ' + c, t, k, 2 + i * 2, 8, 2));
  };

  /* Roue SVG (viewBox -100..100). Retourne { rotor, ball } pour l'animation. */
  R.buildWheel = function (svg) {
    const NS = 'http://www.w3.org/2000/svg', th = 360 / 38;
    const el = (n, a, p) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); (p || svg).appendChild(e); return e; };
    const pt = (r, a) => [(r * Math.sin(a * Math.PI / 180)).toFixed(2), (-r * Math.cos(a * Math.PI / 180)).toFixed(2)];

    el('circle', { r: 99, fill: '#0a1a12', stroke: '#c9a24a', 'stroke-width': 1.2 });
    el('circle', { r: 92, fill: '#0f2a1d', stroke: '#1b4a33', 'stroke-width': .6 });

    const rotor = el('g', { id: 'rotor' });
    R.ORDER.forEach((n, i) => {
      const a0 = (i - .5) * th, a1 = (i + .5) * th, [x0, y0] = pt(84, a0), [x1, y1] = pt(84, a1), [x2, y2] = pt(60, a1), [x3, y3] = pt(60, a0);
      const fill = { green: '#13803f', red: '#b3201c', black: '#15181b' }[R.color(n)];
      el('path', { d: `M${x0} ${y0}A84 84 0 0 1 ${x1} ${y1}L${x2} ${y2}A60 60 0 0 0 ${x3} ${y3}Z`, fill, stroke: '#d9c27a', 'stroke-width': .35 }, rotor);
      const t = el('text', { x: 0, y: -69.5, 'text-anchor': 'middle', 'font-size': n.length > 1 ? 5.2 : 6.2, fill: '#fff', 'font-weight': 700, transform: `rotate(${i * th})` }, rotor);
      t.textContent = n;
    });
    el('circle', { r: 58, fill: '#0b1f16', stroke: '#c9a24a', 'stroke-width': .6 }, rotor);
    for (let i = 0; i < 38; i++) {          /* rayons décoratifs du moyeu */
      const [x, y] = pt(58, i * th), [u, v] = pt(36, i * th);
      el('line', { x1: x, y1: y, x2: u, y2: v, stroke: i % 2 ? '#1c4a33' : '#2b6b49', 'stroke-width': 2.2 }, rotor);
    }
    el('circle', { r: 36, fill: '#06150e', stroke: '#c9a24a', 'stroke-width': .8 }, rotor);

    const ball = el('g', { id: 'ballRot' });
    const b = el('circle', { id: 'ball', cx: 0, cy: -88, r: 2.7, fill: '#f6f6f2', stroke: '#9a9a90', 'stroke-width': .4 }, ball);
    return { rotor, ball, ballDot: b, step: th };
  };
})();
