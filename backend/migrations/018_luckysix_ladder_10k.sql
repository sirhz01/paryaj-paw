-- Lucky Six : barème des gains = celui de l'écran de référence, de 10 000 (boule 6) à 1 (boule 35).
-- RTP ≈ 85,9 % (le barème précédent, 4323 → 0,39, donnait 40 %). Les paytables de Keno et Lucky X ne changent pas.
-- Nouvelle version des paramètres (table append-only) : on reprend la version courante et on remplace seulement « luckysix ».
INSERT INTO shop_settings (point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
                           max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled, paytables, timings)
SELECT point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
       max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled,
       jsonb_set(paytables, '{luckysix}',
                 '[10000, 7500, 5000, 2500, 1000, 500, 300, 200, 150, 100,
                   80, 60, 40, 30, 25, 20, 18, 16, 14, 12,
                   10, 9, 8, 7, 6, 5, 4, 3, 2, 1]'::jsonb),
       timings
FROM shop_settings ORDER BY version DESC LIMIT 1;
