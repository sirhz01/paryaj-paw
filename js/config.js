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
   paie LADDER[position - 6] × la mise. Échelle certifiée, RTP 92,5 % (même valeur côté serveur). */
PP.LUCKY_LADDER = [10000, 7500, 5000, 2500, 905, 455, 270, 180, 135, 91,
  82, 73, 63, 54, 45, 36, 27, 23, 18, 14, 9.1, 8.2, 7.3, 6.3, 5.4, 4.5, 3.6, 2.7, 1.8, 0.9];

/* Lucky X : 36 boules sur 50, annoncées dans l'ordre croissant. 1 numéro parmi les 36 tirées = cote 1,27 ;
   N numéros (2..10) tous tirés = LUCKYX_TIERS[N] × la mise. Chaque pari ~92 % de RTP (même valeur côté serveur). */
PP.LUCKYX_TIERS = { 2: 1.78, 3: 2.52, 4: 3.59, 5: 5.17, 6: 7.5, 7: 11, 8: 16.3, 9: 24.4, 10: 37.1 };
PP.LUCKYX_SINGLE_ODDS = 1.27;

/* Keno : KENO_PAY[numéros choisis][numéros trouvés] = coefficient × la mise.
   Table certifiée, identique au moteur en ligne ; chaque ligne 91,6-93 % de RTP. */
PP.KENO_PAY = {
  1:  { 1: 3.7 },
  2:  { 1: 1, 2: 9.1 },
  3:  { 2: 3, 3: 37 },
  4:  { 2: 1.4, 3: 6.8, 4: 110 },
  5:  { 2: 0.6, 3: 3.3, 4: 17, 5: 440 },
  6:  { 3: 2, 4: 7.9, 5: 79, 6: 1500 },
  7:  { 3: 1.1, 4: 4.5, 5: 23, 6: 225, 7: 5650 },
  8:  { 3: 0.5, 4: 2.2, 5: 11, 6: 88, 7: 1100, 8: 10000 },
  9:  { 3: 0.5, 4: 1.6, 5: 5.4, 6: 33, 7: 270, 8: 2700, 9: 10000 },
  10: { 0: 1.1, 4: 1.1, 5: 3.3, 6: 16, 7: 110, 8: 1100, 9: 5400, 10: 10000 },
};

PP.STAKES = [25, 50, 100, 250, 500, 1000];
