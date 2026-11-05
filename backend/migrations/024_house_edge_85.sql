-- Avantage maison 85 % : tables de gains de la boutique recalculées pour un RTP de 15 % sur chaque ligne
-- (le joueur récupère en moyenne 15 % de ses mises ; la maison garde 85 %), sur les quatre jeux.
-- Décision de l'exploitant, qui confirme que la loi haïtienne le permet. Les tirages restent aléatoires
-- et vérifiables : seul le barème de gains change. Le RTP de chaque ligne reste publié (admin /shop/settings).
-- Les tickets déjà vendus gardent leur cote (stockée sur chaque ligne). Roulette : cote = 15 % × 38 / cases couvertes.
-- Nouvelle version des paramètres (table append-only) : on reprend la version courante et on remplace « paytables ».
INSERT INTO shop_settings (point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
                           max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled, paytables, created_by, timings)
SELECT point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
       max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled,
       '{"keno":{"1":{"1":0.6},"2":{"1":0.161,"2":1.48},"3":{"2":0.484,"3":5.97},"4":{"2":0.225,"3":1.1,"4":17.8},"5":{"2":0.0974,"3":0.532,"4":2.74,"5":71.1},"6":{"3":0.326,"4":1.28,"5":12.8,"6":244},"7":{"3":0.177,"4":0.729,"5":3.72,"6":36.4,"7":914},"8":{"3":0.0825,"4":0.36,"5":1.8,"6":14.4,"7":180,"8":1640},"9":{"3":0.0823,"4":0.258,"5":0.872,"6":5.35,"7":43.8,"8":437,"9":1620},"10":{"0":0.179,"4":0.179,"5":0.535,"6":2.58,"7":17.8,"8":178,"9":872,"10":1610}},"luckysix":[1620,1220,810,405,147,73.8,43.8,29.2,21.9,14.7,13.3,11.8,10.2,8.73,7.31,5.85,4.38,3.72,2.92,2.27,1.47,1.33,1.18,1.02,0.873,0.731,0.585,0.438,0.292,0.146],"luckyx":{"single":0.208,"tiers":{"2":0.292,"3":0.412,"4":0.586,"5":0.843,"6":1.22,"7":1.79,"8":2.66,"9":3.99,"10":6.06}},"roulette":{"targetRtp":15,"odds":{"n":5.7,"sp":2.85,"st":1.9,"co":1.43,"six":0.95,"col":0.48,"doz":0.48,"red":0.32,"black":0.32,"even":0.32,"odd":0.32,"low":0.32,"high":0.32,"basket":1.14}}}'::jsonb,
       created_by, timings
FROM shop_settings ORDER BY version DESC LIMIT 1;
