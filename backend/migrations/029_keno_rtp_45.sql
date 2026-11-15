-- Keno : taux de gain (RTP) porté à 45 % sur chaque ligne (1 à 10 numéros), à la demande de l'exploitant.
-- Même structure que le barème précédent (migration 024), coefficients × 3 ; RTP réel de chaque ligne : 44,96 à 45,06 %.
-- Les autres jeux ne changent pas. Les tickets déjà vendus gardent leur cote (stockée sur chaque ligne).
-- Nouvelle version des paramètres (table append-only) : on reprend la version courante et on remplace « paytables.keno ».
INSERT INTO shop_settings (point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
                           max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled, paytables, created_by, timings)
SELECT point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
       max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled,
       jsonb_set(paytables, '{keno}', '{"1":{"1":1.8},"2":{"1":0.483,"2":4.44},"3":{"2":1.45,"3":17.9},"4":{"2":0.675,"3":3.3,"4":53.4},"5":{"2":0.292,"3":1.6,"4":8.22,"5":213},"6":{"3":0.978,"4":3.84,"5":38.4,"6":732},"7":{"3":0.531,"4":2.19,"5":11.2,"6":109,"7":2740},"8":{"3":0.247,"4":1.08,"5":5.4,"6":43.2,"7":540,"8":4920},"9":{"3":0.247,"4":0.774,"5":2.62,"6":16,"7":131,"8":1310,"9":4860},"10":{"0":0.537,"4":0.537,"5":1.6,"6":7.74,"7":53.4,"8":534,"9":2620,"10":4830}}'::jsonb),
       created_by, timings
FROM shop_settings ORDER BY version DESC LIMIT 1;
