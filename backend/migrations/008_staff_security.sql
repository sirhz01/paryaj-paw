-- Sécurité du back-office : révocation des sessions, blocage après échecs, caissier lié à sa caisse.
ALTER TABLE staff
  ADD COLUMN token_version INT NOT NULL DEFAULT 0,
  ADD COLUMN failed_logins INT NOT NULL DEFAULT 0,
  ADD COLUMN locked_until  TIMESTAMPTZ,
  ADD COLUMN terminal      TEXT;
