-- À coller dans l'éditeur SQL de Neon (ou laisser le serveur l'appliquer au démarrage via la migration 015).
-- Lucky X : 36 boules sur 50. Sûr à relancer : n'insère rien si la table est déjà la bonne.
INSERT INTO shop_settings (point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
                           max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled, paytables, timings)
SELECT point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
       max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled,
       jsonb_set(paytables, '{luckyx}', '{
         "single": 1.27,
         "tiers": { "2": 1.78, "3": 2.52, "4": 3.59, "5": 5.17, "6": 7.5, "7": 11, "8": 16.3, "9": 24.4, "10": 37.1 }
       }'::jsonb),
       timings
FROM shop_settings
WHERE version = (SELECT max(version) FROM shop_settings)
  AND (paytables->'luckyx'->>'single')::numeric <> 1.27;
