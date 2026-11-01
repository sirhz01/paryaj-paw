-- Argent déclaré par le caissier : montant en caisse au début (à la connexion) et à la fin (à la déconnexion), en centimes.
ALTER TABLE cashier_reports ADD COLUMN opening_cents BIGINT, ADD COLUMN closing_cents BIGINT;
