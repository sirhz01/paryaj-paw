-- Cotes de la roulette configurables : RTP visé enregistré dans les réglages (paytables.roulette), cotes calculées par le serveur
-- (cote = RTP × 38 / cases couvertes, arrondie au centième). Première valeur : 92 %. Le tirage ne change pas (38 cases équiprobables).
-- Les tickets déjà vendus gardent leur cote (stockée sur chaque ligne).
INSERT INTO shop_settings (point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
                           max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled, paytables, created_by, timings)
SELECT point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
       max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled,
       jsonb_set(paytables, '{roulette}', '{"targetRtp": 92, "odds": {"n": 34.96, "sp": 17.48, "st": 11.65, "co": 8.74, "six": 5.83, "col": 2.91, "doz": 2.91, "red": 1.94, "black": 1.94, "even": 1.94, "odd": 1.94, "low": 1.94, "high": 1.94, "basket": 6.99}}'::jsonb),
       created_by, timings
FROM shop_settings ORDER BY version DESC LIMIT 1;
