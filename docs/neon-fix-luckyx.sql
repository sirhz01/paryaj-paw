-- À coller dans l'éditeur SQL de Neon (console.neon.tech → votre projet → SQL Editor).
-- Remet la table de gains Lucky X (36 boules sur 80) dans la dernière version des réglages.
-- Sûr à relancer : n'insère rien si la table est déjà la bonne.

-- 1) Diagnostic (facultatif) : quelles migrations sont appliquées, et quelle table Lucky X est active ?
-- SELECT name FROM schema_migrations ORDER BY name;
-- SELECT version, paytables->'luckyx' FROM shop_settings ORDER BY version DESC LIMIT 3;

-- 2) Correction
INSERT INTO shop_settings (point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
                           max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled, paytables, timings)
SELECT point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
       max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled,
       jsonb_set(paytables, '{luckyx}', '{
         "single": 2.04,
         "tiers": { "2": 4.61, "3": 10.6, "4": 24.7, "5": 58.7, "6": 142, "7": 350, "8": 881, "9": 2266, "10": 5959 }
       }'::jsonb),
       timings
FROM shop_settings
WHERE version = (SELECT max(version) FROM shop_settings)
  AND (paytables->'luckyx'->>'single')::numeric <> 2.04;
