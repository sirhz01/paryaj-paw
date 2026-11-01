-- Tables de gains de la boutique au format international, RTP ~92 % (avantage maison ~8 %).
-- Remplace les valeurs DEMO de 005_shop.sql, dont le RTP s'éloignait de 90-95 % (Keno 2 numéros à 114 %,
-- Lucky X simple à 72 %…). Nouvelle version des paramètres (table append-only) : on reprend les champs
-- d'exploitation de la version courante et on remplace seulement « paytables ».
--
--   Keno 20/80, 1 à 10 numéros : identique au moteur en ligne (migrations/001_init.sql), chaque ligne 91,6-93 %.
--   Lucky Six 35/48 : échelle certifiée du moteur des tirages programmés (003_four_games.sql), RTP 92,5 %.
--   Lucky X 50/20 : simple (1 numéro dans les 6 premières) et paliers 2-10 « tout tiré », chacun ~92 %.
INSERT INTO shop_settings (point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
                           max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled, paytables)
SELECT point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
       max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled,
       '{
         "keno": {
           "1":  { "1": 3.7 },
           "2":  { "1": 1, "2": 9.1 },
           "3":  { "2": 3, "3": 37 },
           "4":  { "2": 1.4, "3": 6.8, "4": 110 },
           "5":  { "2": 0.6, "3": 3.3, "4": 17, "5": 440 },
           "6":  { "3": 2, "4": 7.9, "5": 79, "6": 1500 },
           "7":  { "3": 1.1, "4": 4.5, "5": 23, "6": 225, "7": 5650 },
           "8":  { "3": 0.5, "4": 2.2, "5": 11, "6": 88, "7": 1100, "8": 10000 },
           "9":  { "3": 0.5, "4": 1.6, "5": 5.4, "6": 33, "7": 270, "8": 2700, "9": 10000 },
           "10": { "0": 1.1, "4": 1.1, "5": 3.3, "6": 16, "7": 110, "8": 1100, "9": 5400, "10": 10000 }
         },
         "luckysix": [10000, 7500, 5000, 2500, 905, 455, 270, 180, 135, 91,
                      82, 73, 63, 54, 45, 36, 27, 23, 18, 14, 9.1, 8.2, 7.3, 6.3, 5.4, 4.5, 3.6, 2.7, 1.8, 0.9],
         "luckyx": {
           "single": 7.67,
           "tiers": { "2": 5.93, "3": 15.82, "4": 43.73, "5": 126, "6": 377, "7": 1185, "8": 3921, "9": 13723, "10": 51151 }
         }
       }'::jsonb
FROM shop_settings ORDER BY version DESC LIMIT 1;
