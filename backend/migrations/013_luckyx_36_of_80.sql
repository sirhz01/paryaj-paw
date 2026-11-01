-- Lucky X : 36 boules tirées sur 80 (avant : 20 sur 50), boules sorties dans l'ordre croissant.
--   Pari simple : le numéro est dans les 36 boules tirées (probabilité 36/80) ; paliers 2 à 10 : tous les numéros choisis sont tirés
--   (probabilité C(36,n)/C(80,n)). Coefficients calculés pour un RTP de 92 % sur chaque ligne.
-- Nouvelle version des paramètres (table append-only) : on reprend la version courante et on remplace seulement « luckyx ».
INSERT INTO shop_settings (point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
                           max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled, paytables, timings)
SELECT point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
       max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled,
       jsonb_set(paytables, '{luckyx}', '{
         "single": 2.04,
         "tiers": { "2": 4.61, "3": 10.6, "4": 24.7, "5": 58.7, "6": 142, "7": 350, "8": 881, "9": 2266, "10": 5959 }
       }'::jsonb),
       timings
FROM shop_settings ORDER BY version DESC LIMIT 1;
