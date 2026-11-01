/* Configuration partagée : boutique, jeux, tables de gains.
   Tout ce qui est marqué DEMO doit être remplacé par les valeurs certifiées. */
window.PP = window.PP || {};

PP.SHOP = {
  pointDeVente: 'PRONO Limonade, Rue Prison, Roucou',
  emetteur: 'Limo prono by Mme Jean Gilles',
  peripherique: 'CAISSE #1',
};

/* Durées en secondes. Un cycle = bet + draw + result. */
PP.GAMES = {
  roulette: { name: 'American Roulette', ticket: 'Roulette',         bet: 25, draw: 11, result: 8  },
  keno:     { name: 'Keno 20/80',        ticket: 'Keno',             bet: 20, draw: 30, result: 8  },
  luckysix: { name: 'Lucky Six',         ticket: 'LUCKY SIX',        bet: 30, draw: 32, result: 12 },
  luckyx:   { name: 'Lucky X',           ticket: 'Lucky X',          bet: 20, draw: 24, result: 8  },
};

/* Couleur d'une boule selon n % 8 (Lucky Six / Lucky X). */
PP.COLORS = ['#2b2f33', '#e53935', '#1fbf55', '#38b6ff', '#2740d6', '#7a5a3a', '#d7e83a', '#ff9a2e'];
PP.COLOR_NAMES = ['Noir', 'Rouge', 'Vert', 'Bleu clair', 'Bleu', 'Marron', 'Jaune', 'Orange'];

/* Lucky Six : 35 boules tirées sur 48. La boule n°6..35 qui complète les 6 numéros du joueur
   paie LADDER[position - 6] × la mise. */
PP.LUCKY_LADDER = [10000, 7500, 5000, 2500, 1000, 500, 300, 200, 150, 100,
  80, 60, 40, 30, 25, 20, 18, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

/* Lucky X : 20 boules sur 50. 1 numéro dans les 6 premières = cote 6 ;
   N numéros (2..10) tous tirés = LUCKYX_TIERS[N] × la mise. */
PP.LUCKYX_TIERS = { 2: 6, 3: 13, 4: 19, 5: 70, 6: 250, 7: 700, 8: 2000, 9: 3000, 10: 20000 };
PP.LUCKYX_SINGLE_ODDS = 6;

/* Keno : KENO_PAY[numéros choisis][numéros trouvés] = coefficient × la mise.
   1 à 5 : exemple du cahier des charges (à valider par rapport mathématique).
   9 : écran de la boutique. 6, 7, 8, 10 : DEMO, valeurs provisoires. */
PP.KENO_PAY = {
  1:  { 1: 3 },
  2:  { 2: 19 },
  3:  { 2: 2, 3: 25 },
  4:  { 2: 1, 3: 5, 4: 80 },
  5:  { 3: 3, 4: 15, 5: 400 },
  6:  { 3: 1, 4: 4, 5: 20, 6: 300 },
  7:  { 4: 2, 5: 10, 6: 60, 7: 800 },
  8:  { 4: 1, 5: 5, 6: 25, 7: 200, 8: 2000 },
  9:  { 0: 1, 4: 2, 5: 10, 6: 25, 7: 125, 8: 1000, 9: 5000 },
  10: { 5: 2, 6: 10, 7: 50, 8: 300, 9: 2500, 10: 10000 },
};

PP.STAKES = [25, 50, 100, 250, 500, 1000];
