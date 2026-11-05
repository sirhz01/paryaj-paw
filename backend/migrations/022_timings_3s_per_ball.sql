-- Lucky Six (35 boules) et Lucky X (36 boules) : une boule toutes les 3 secondes à l'écran.
-- Tirage Six 35 × 3 = 105 s, Lucky X 36 × 3 = 108 s ; tour de 3 minutes (mises + tirage + résultat = 180 s).
-- Comme tous les changements de temps, s'applique à partir du prochain minuit (heure d'Haïti). Roulette et Keno ne changent pas.
INSERT INTO shop_settings (point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
                           max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled, paytables, created_by, timings)
SELECT point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
       max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled, paytables, created_by,
       jsonb_set(jsonb_set(timings,
         '{luckysix}', '{"bet": 65, "draw": 105, "result": 10}'::jsonb),
         '{luckyx}',   '{"bet": 62, "draw": 108, "result": 10}'::jsonb)
FROM shop_settings ORDER BY version DESC LIMIT 1;
