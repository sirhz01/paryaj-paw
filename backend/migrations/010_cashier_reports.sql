-- Rapport de caissier : une ligne enregistrée à chaque déconnexion d'un caissier (ventes et paiements de sa session).
CREATE TABLE cashier_reports (
  id            BIGSERIAL PRIMARY KEY,
  staff_id      BIGINT NOT NULL REFERENCES staff (id),
  terminal      TEXT,
  started_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  tickets       INT NOT NULL DEFAULT 0,
  stakes_cents  BIGINT NOT NULL DEFAULT 0,
  payouts       INT NOT NULL DEFAULT 0,
  payouts_cents BIGINT NOT NULL DEFAULT 0,
  UNIQUE (staff_id, started_at)
);
CREATE INDEX cashier_reports_ended ON cashier_reports (ended_at DESC);
CREATE TRIGGER cashier_reports_append_only BEFORE UPDATE OR DELETE ON cashier_reports
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
