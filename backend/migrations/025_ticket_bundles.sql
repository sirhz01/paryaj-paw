-- Fiche multi-tours : un seul ticket imprimé qui joue les mêmes boules sur plusieurs tours de suite (2 à 10 tours),
-- avec une mise propre à chaque tour. En base, un ticket par tour (règlement, rapports et caisse inchangés) ;
-- bundle_id relie les tickets d'une même fiche et vaut l'ID du premier ticket, celui qui est imprimé.
-- NULL pour un ticket ordinaire (un seul tour) : les tickets déjà vendus ne changent pas.
ALTER TABLE shop_tickets ADD COLUMN bundle_id TEXT;
CREATE INDEX shop_tickets_bundle ON shop_tickets (bundle_id) WHERE bundle_id IS NOT NULL;
