-- À coller dans l'éditeur SQL de Neon : supprime les données de TEST (ventes, tirages, paiements, rapports de caisse).
-- NE TOUCHE PAS : le compte propriétaire, les réglages (shop_settings : taux, temps, caisses) ni les comptes caissiers.
-- IRRÉVERSIBLE. Faire d'abord un « branch » / sauvegarde dans Neon (Branches → Create branch) si vous hésitez.
-- Vérifier d'abord ce qui sera supprimé :
--   SELECT (SELECT count(*) FROM shop_tickets) tickets, (SELECT count(*) FROM shop_payouts) paiements,
--          (SELECT count(*) FROM shop_rounds) tours, (SELECT count(*) FROM cashier_reports) rapports;

BEGIN;
DELETE FROM shop_payouts;
DELETE FROM shop_ticket_results;
DELETE FROM shop_tickets;
DELETE FROM shop_rounds;
DELETE FROM cashier_reports;
COMMIT;

-- Facultatif : supprimer aussi les comptes caissiers de test (garder le propriétaire).
-- SELECT id, email, role FROM staff ORDER BY id;
-- DELETE FROM staff WHERE role = 'cashier' AND email IN ('test@paryaj.local');   -- adapter la liste
