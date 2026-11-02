-- À coller dans l'éditeur SQL de Neon si la migration 017 n'a pas été appliquée automatiquement.
-- Keno 3 min ; Roulette, Lucky Six, Lucky X 2 min. S'applique à partir du prochain minuit (heure d'Haïti).
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
