-- Avantage maison 60 % : tables de gains de la boutique recalculées pour un RTP de 40 % sur chaque ligne
-- (le joueur récupère en moyenne 40 % de ses mises ; la maison garde 60 %). Les tirages restent aléatoires
-- et vérifiables : seul le barème de gains change. Coefficients = valeurs certifiées (~92 %) × 0,40 / RTP de la ligne.
-- Les cotes de la roulette (fixées dans le code, src/shop/games.ts) sont ajustées séparément au même RTP.
-- Nouvelle version des paramètres (table append-only) : on reprend la version courante et on remplace « paytables ».
INSERT INTO shop_settings (point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
                           max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled, paytables, timings)
SELECT point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
       max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled,
       '{
         "keno": {
           "1":  { "1": 1.6 },
           "2":  { "1": 0.43, "2": 3.93 },
           "3":  { "2": 1.29, "3": 15.9 },
           "4":  { "2": 0.6, "3": 2.93, "4": 47.4 },
           "5":  { "2": 0.26, "3": 1.42, "4": 7.32, "5": 190 },
           "6":  { "3": 0.87, "4": 3.42, "5": 34.2, "6": 650 },
           "7":  { "3": 0.47, "4": 1.94, "5": 9.91, "6": 96.9, "7": 2434 },
           "8":  { "3": 0.22, "4": 0.96, "5": 4.8, "6": 38.4, "7": 480, "8": 4365 },
           "9":  { "3": 0.22, "4": 0.69, "5": 2.33, "6": 14.3, "7": 117, "8": 1167, "9": 4322 },
           "10": { "0": 0.48, "4": 0.48, "5": 1.43, "6": 6.91, "7": 47.5, "8": 475, "9": 2332, "10": 4319 }
         },
         "luckysix": [4323, 3243, 2162, 1081, 391, 197, 117, 77.8, 58.4, 39.3,
                      35.5, 31.6, 27.2, 23.3, 19.5, 15.6, 11.7, 9.94, 7.78, 6.05, 3.93, 3.55, 3.16, 2.72, 2.33, 1.95, 1.56, 1.17, 0.78, 0.39],
         "luckyx": {
           "single": 0.89,
           "tiers": { "2": 2.01, "3": 4.6, "4": 10.7, "5": 25.5, "6": 61.7, "7": 152, "8": 383, "9": 985, "10": 2591 }
         }
       }'::jsonb,
       timings
FROM shop_settings ORDER BY version DESC LIMIT 1;
