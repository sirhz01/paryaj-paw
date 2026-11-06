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
   paie LADDER[position - 6] × la mise. Barème de l'écran de référence (10 000 à 1) ; le serveur
   fournit la table en vigueur (api.js) et fait foi. */
PP.LUCKY_LADDER = [10000, 7500, 5000, 2500, 1000, 500, 300, 200, 150, 100,
  80, 60, 40, 30, 25, 20, 18, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

/* Lucky X : 36 boules sur 50, tirées dans un ordre aléatoire. On choisit N numéros (1 à 10) : ils doivent tous sortir, et le gain
   dépend du rang de la boule qui complète la sélection. LUCKYX_LADDERS[N][i] = coefficient × la mise quand la dernière boule
   choisie sort au rang N + i (aucun gain au-delà). Barème de l'écran de référence, RTP ≈ 90 % ; le serveur fournit la table en vigueur. */
PP.LUCKYX_LADDERS = {
  1: [9, 8, 7, 6, 5, 4, 3, 2, 1],
  2: [100, 40, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  3: [200, 100, 80, 70, 50, 40, 30, 20, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  4: [1000, 200, 80, 60, 50, 40, 30, 25, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  5: [5000, 1000, 500, 400, 300, 200, 100, 90, 70, 50, 45, 40, 35, 30, 20, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  6: [10000, 5000, 2500, 1500, 1000, 700, 500, 250, 200, 100, 90, 80, 70, 60, 50, 40, 30, 25, 15, 14, 13, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  7: [20000, 10000, 5000, 2500, 2000, 1000, 700, 500, 400, 300, 200, 100, 90, 80, 70, 60, 50, 45, 40, 35, 25, 20, 15, 12, 10, 8, 6, 4, 3, 2],
  8: [30000, 10000, 5000, 4000, 3000, 2000, 1000, 900, 800, 700, 600, 500, 100, 90, 80, 70, 60, 50, 45, 40, 35, 30, 25, 20, 15, 10, 9, 8, 3],
  9: [50000, 20000, 10000, 5000, 3000, 2000, 1000, 900, 800, 700, 600, 400, 300, 250, 200, 150, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 9, 4],
  10: [100000, 50000, 40000, 20000, 10000, 5000, 3000, 2500, 1500, 1000, 600, 500, 400, 300, 250, 200, 150, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10],
};
/** Coefficient du Lucky X pour N numéros dont le dernier sort au rang x (0 si aucun gain). */
PP.luckyxPay = (n, x) => (PP.LUCKYX_LADDERS[n] && PP.LUCKYX_LADDERS[n][x - n]) || 0;
/** Dernier rang qui paie encore pour N numéros. */
PP.luckyxLast = (n) => (PP.LUCKYX_LADDERS[n] ? n + PP.LUCKYX_LADDERS[n].length - 1 : 0);

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
