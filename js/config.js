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
PP.COLORS = ['#2b2f33', '#e53935', '#1fbf55', '#38b6ff', '#d65db1', '#7a5a3a', '#d7e83a', '#ff9a2e'];
PP.COLOR_NAMES = ['Noir', 'Rouge', 'Vert', 'Bleu clair', 'Bleu', 'Marron', 'Jaune', 'Orange'];

/* Lucky Six : 35 boules tirées sur 48. La boule n°6..35 qui complète les 6 numéros du joueur
   paie LADDER[position - 6] × la mise. Valeur par défaut, RTP 15 % (avantage maison 85 %) ; le serveur
   fournit la table en vigueur (api.js) et fait foi. */
PP.LUCKY_LADDER = [1620, 1220, 810, 405, 147, 73.8, 43.8, 29.2, 21.9, 14.7,
  13.3, 11.8, 10.2, 8.73, 7.31, 5.85, 4.38, 3.72, 2.92, 2.27, 1.47, 1.33, 1.18, 1.02, 0.873, 0.731, 0.585, 0.438, 0.292, 0.146];

/* Lucky X : 36 boules sur 50, tirées dans un ordre aléatoire. 1 numéro parmi les 36 tirées = cote LUCKYX_SINGLE_ODDS ;
   N numéros (2..10) tous tirés = LUCKYX_TIERS[N] × la mise. RTP 15 % par pari (valeur par défaut, le serveur fait foi). */
PP.LUCKYX_TIERS = { 2: 0.292, 3: 0.412, 4: 0.586, 5: 0.843, 6: 1.22, 7: 1.79, 8: 2.66, 9: 3.99, 10: 6.06 };
PP.LUCKYX_SINGLE_ODDS = 0.208;

/* Keno : KENO_PAY[numéros choisis][numéros trouvés] = coefficient × la mise.
   Valeur par défaut, RTP 15 % par ligne ; le serveur fournit la table en vigueur (api.js) et fait foi. */
PP.KENO_PAY = {
  1:  { 1: 0.6 },
  2:  { 1: 0.161, 2: 1.48 },
  3:  { 2: 0.484, 3: 5.97 },
  4:  { 2: 0.225, 3: 1.1, 4: 17.8 },
  5:  { 2: 0.0974, 3: 0.532, 4: 2.74, 5: 71.1 },
  6:  { 3: 0.326, 4: 1.28, 5: 12.8, 6: 244 },
  7:  { 3: 0.177, 4: 0.729, 5: 3.72, 6: 36.4, 7: 914 },
  8:  { 3: 0.0825, 4: 0.36, 5: 1.8, 6: 14.4, 7: 180, 8: 1640 },
  9:  { 3: 0.0823, 4: 0.258, 5: 0.872, 6: 5.35, 7: 43.8, 8: 437, 9: 1620 },
  10: { 0: 0.179, 4: 0.179, 5: 0.535, 6: 2.58, 7: 17.8, 8: 178, 9: 872, 10: 1610 },
};

PP.STAKES = [25, 50, 100, 250, 500, 1000];
