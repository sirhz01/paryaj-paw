-- Durée d'un tour : Keno 3 minutes ; Roulette américaine, Lucky Six et Lucky X 2 minutes.
-- Mises + tirage + résultat = durée du tour (Keno 130+40+10 = 180 s ; les trois autres 2 minutes = 120 s).
-- Comme tous les changements de temps, ils s'appliquent à partir du prochain minuit (heure d'Haïti).
INSERT INTO shop_settings (point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
                           max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled, paytables, timings)
SELECT point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
       max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled, paytables,
       '{
         "roulette": { "bet": 90,  "draw": 20, "result": 10 },
         "keno":     { "bet": 130, "draw": 40, "result": 10 },
         "luckysix": { "bet": 70,  "draw": 40, "result": 10 },
         "luckyx":   { "bet": 80,  "draw": 30, "result": 10 }
       }'::jsonb
FROM shop_settings ORDER BY version DESC LIMIT 1;
