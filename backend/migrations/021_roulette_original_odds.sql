-- Roulette : revenir aux cotes standard de l'American Roulette (pari simple à 36, cheval 18, street 12, carré 9,
-- six lignes 6, colonne/douzaine 3, chances simples 2 ; top line 7,2). RTP visé 94,74 % (= 36 × 1/38). Le tirage ne
-- change pas (38 cases équiprobables) : seules les cotes payées changent. Les tickets déjà vendus gardent leur cote.
-- Nouvelle version des paramètres (table append-only) : on reprend la version courante et on remplace « roulette ».
INSERT INTO shop_settings (point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
                           max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled, paytables, created_by, timings)
SELECT point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
       max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled,
       jsonb_set(paytables, '{roulette}', '{"targetRtp": 94.74, "odds": {"n": 36, "sp": 18, "st": 12, "co": 9, "six": 6, "col": 3, "doz": 3, "red": 2, "black": 2, "even": 2, "odd": 2, "low": 2, "high": 2, "basket": 7.2}}'::jsonb),
       created_by, timings
FROM shop_settings ORDER BY version DESC LIMIT 1;
