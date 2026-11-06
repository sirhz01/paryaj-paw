-- Lucky X : barème de l'écran de référence (décision de l'exploitant). Les N numéros choisis (1 à 10) doivent tous sortir parmi
-- les 36 boules tirées ; le gain dépend du rang de la boule qui complète la sélection (plus elle sort tôt, plus on gagne) :
-- ladders[N][i] = coefficient quand la dernière boule choisie sort au rang N + i (aucun gain au-delà). RTP ≈ 90 % pour chaque N.
-- Les tirages ne changent pas ; les tickets déjà vendus sont réglés avec l'ancien barème (version de paramètres de leur vente).
-- Nouvelle version des paramètres (table append-only) : on reprend la version courante et on remplace seulement « luckyx ».
INSERT INTO shop_settings (point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
                           max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled, paytables, created_by, timings)
SELECT point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
       max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled,
       jsonb_set(paytables, '{luckyx}', '{"ladders":{"1":[9,8,7,6,5,4,3,2,1],"2":[100,40,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1],"3":[200,100,80,70,50,40,30,20,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1],"4":[1000,200,80,60,50,40,30,25,20,19,18,17,16,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1],"5":[5000,1000,500,400,300,200,100,90,70,50,45,40,35,30,20,15,14,13,12,11,10,9,8,7,6,5,4,3,2,1],"6":[10000,5000,2500,1500,1000,700,500,250,200,100,90,80,70,60,50,40,30,25,15,14,13,10,9,8,7,6,5,4,3,2,1],"7":[20000,10000,5000,2500,2000,1000,700,500,400,300,200,100,90,80,70,60,50,45,40,35,25,20,15,12,10,8,6,4,3,2],"8":[30000,10000,5000,4000,3000,2000,1000,900,800,700,600,500,100,90,80,70,60,50,45,40,35,30,25,20,15,10,9,8,3],"9":[50000,20000,10000,5000,3000,2000,1000,900,800,700,600,400,300,250,200,150,100,90,80,70,60,50,40,30,20,10,9,4],"10":[100000,50000,40000,20000,10000,5000,3000,2500,1500,1000,600,500,400,300,250,200,150,100,90,80,70,60,50,40,30,20,10]}}'::jsonb),
       created_by, timings
FROM shop_settings ORDER BY version DESC LIMIT 1;
