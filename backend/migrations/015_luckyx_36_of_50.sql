-- Lucky X : 36 boules tirées sur 50 (avant : 36 sur 80), annoncées dans l'ordre croissant, en 6 colonnes de 6 boules.
--   Pari simple : le numéro est dans les 36 boules tirées (probabilité 36/50) ; paliers 2 à 10 : tous les numéros choisis sont tirés
--   (probabilité C(36,n)/C(50,n)). Coefficients calculés pour un RTP d'environ 92 % sur chaque ligne.
-- Nouvelle version des paramètres (table append-only) : on reprend la version courante et on remplace seulement « luckyx ».
INSERT INTO shop_settings (point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
                           max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled, paytables, timings)
SELECT point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
       max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled,
       jsonb_set(paytables, '{luckyx}', '{
         "single": 1.27,
         "tiers": { "2": 1.78, "3": 2.52, "4": 3.59, "5": 5.17, "6": 7.5, "7": 11, "8": 16.3, "9": 24.4, "10": 37.1 }
       }'::jsonb),
       timings
FROM shop_settings ORDER BY version DESC LIMIT 1;
