-- Lucky Six et Lucky X : 120 s pour miser, puis tirage à 3 s par boule.
-- Six : 120 + 105 (35 boules) + 10 = 235 s ; Lucky X : 120 + 108 (36 boules) + 10 = 238 s.
-- S'applique à partir du prochain minuit (heure d'Haïti). Roulette et Keno ne changent pas.
INSERT INTO shop_settings (point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
                           max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled, paytables, created_by, timings)
SELECT point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
       max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled, paytables, created_by,
       jsonb_set(jsonb_set(timings,
         '{luckysix}', '{"bet": 120, "draw": 105, "result": 10}'::jsonb),
         '{luckyx}',   '{"bet": 120, "draw": 108, "result": 10}'::jsonb)
FROM shop_settings ORDER BY version DESC LIMIT 1;
