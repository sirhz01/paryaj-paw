/* Construction des lignes de ticket et règlement (gain / perte) pour les 4 jeux. */
(function () {
  const PP = window.PP, R = PP.R;

  PP.bets = {
    /* Ligne de roulette à partir d'une clé de mise (cf. roulette-core). */
    rouletteLine(key, stake) {
      const k = key.split(':')[0], odds = R.odds(key);
      const picks = ['n', 'sp', 'st', 'co', 'six'].includes(k) ? R.keyNumbers(key) : [R.label(key).toUpperCase()];
      return { key, label: R.label(key), picks, odds, stake, possible: stake * odds };
    },

    /* Ligne pour Keno / Lucky Six / Lucky X (une seule combinaison de numéros). */
    numbersLine(game, picks, stake) {
      const n = picks.length;
      let odds;
      if (game === 'keno') odds = Math.max(...Object.values(PP.KENO_PAY[n]));
      else if (game === 'luckysix') odds = PP.LUCKY_LADDER[0];
      else odds = Math.max(...PP.LUCKYX_LADDERS[n]);
      const label = { keno: `Keno ${n} numéros`, luckysix: '6 numéros', luckyx: n === 1 ? 'Pari simple' : `${n} boules` }[game];
      return { label, picks: [...picks].sort((a, b) => a - b), odds, stake, possible: stake * odds };
    },

    /* Retourne { state: 'pending' | 'lost' | 'won', win }. */
    settle(t, now = PP.now()) {
      if (!PP.isComplete(t.game, t.day, t.round, now)) return { state: 'pending', win: 0 };
      const res = PP.result(t.game, t.day, t.round);
      let win = 0;
      for (const l of t.lines) {
        if (t.game === 'roulette') {
          if (R.wins(l.key, res.n)) win += l.stake * l.odds;
        } else if (t.game === 'keno') {
          const hits = l.picks.filter((p) => res.draw.includes(p)).length;
          win += l.stake * (PP.KENO_PAY[l.picks.length][hits] || 0);
        } else if (t.game === 'luckysix') {
          let found = 0;
          for (let i = 0; i < res.draw.length; i++) {
            if (l.picks.includes(res.draw[i])) found++;
            if (found === 6) { if (i + 1 >= 6) win += l.stake * PP.LUCKY_LADDER[i + 1 - 6]; break; }
          }
        } else if (t.game === 'luckyx') {
          let found = 0;
          for (let i = 0; i < res.draw.length; i++) {
            if (l.picks.includes(res.draw[i])) found++;
            if (found === l.picks.length) { win += l.stake * PP.luckyxPay(l.picks.length, i + 1); break; }
          }
        }
      }
      return win > 0 ? { state: 'won', win } : { state: 'lost', win: 0 };
    },
  };
})();
