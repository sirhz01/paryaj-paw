-- Roulette et Lucky Six : retour aux cotes d'avant la migration 024, sur décision de l'exploitant.
--   - Roulette : cotes standard de l'American Roulette (pari simple à 36, cheval 18, street 12, carré 9, six lignes 6,
--     colonne/douzaine 3, chances simples 2, top line 7,2), RTP 94,74 % (= 36 × 1/38) — migration 021.
--   - Lucky Six : barème de l'écran de référence, de 10 000 (boule 6) à 1 (boule 35) — migration 018.
-- Keno et Lucky X gardent le barème à RTP 15 % de la migration 024. Les tirages ne changent pas ; les tickets déjà
-- vendus gardent leur cote (stockée sur chaque ligne). Nouvelle version des paramètres (table append-only).
INSERT INTO shop_settings (point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
                           max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled, paytables, created_by, timings)
SELECT point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
       max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled,
       jsonb_set(
         jsonb_set(paytables, '{roulette}', '{"targetRtp": 94.74, "odds": {"n": 36, "sp": 18, "st": 12, "co": 9, "six": 6, "col": 3, "doz": 3, "red": 2, "black": 2, "even": 2, "odd": 2, "low": 2, "high": 2, "basket": 7.2}}'::jsonb),
         '{luckysix}', '[10000, 7500, 5000, 2500, 1000, 500, 300, 200, 150, 100, 80, 60, 40, 30, 25, 20, 18, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]'::jsonb),
       created_by, timings
FROM shop_settings ORDER BY version DESC LIMIT 1;
