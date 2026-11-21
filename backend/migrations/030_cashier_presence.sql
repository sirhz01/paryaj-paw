-- Présence des caissiers : les tours ne sont créés (et les tirages ne tournent) que si au moins un caissier
-- est connecté. La caisse envoie un signal régulier ; une déconnexion efface la ligne, un navigateur fermé
-- sans déconnexion expire tout seul (voir CashierPresence.TTL_MS).
CREATE TABLE cashier_presence (
  staff_id BIGINT PRIMARY KEY REFERENCES staff (id),
  seen_at  TIMESTAMPTZ NOT NULL
);
