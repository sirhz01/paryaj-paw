-- Annulation d'un ticket par le caissier (impression annulée, erreur de saisie) tant que le tirage du tour n'a pas commencé.
-- Le ticket lui-même ne change jamais (table en ajout seul) : l'annulation est une ligne à part, comme le résultat et le paiement.
-- Un ticket annulé n'est plus compté dans la caisse, les rapports ni le règlement du tour.
CREATE TABLE shop_ticket_voids (
  ticket_id  TEXT PRIMARY KEY REFERENCES shop_tickets (id),
  staff_id   BIGINT NOT NULL REFERENCES staff (id),
  terminal   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX shop_ticket_voids_created ON shop_ticket_voids (created_at);
CREATE TRIGGER shop_ticket_voids_append_only BEFORE UPDATE OR DELETE ON shop_ticket_voids
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
