-- Suppression des comptes du back-office : on ne peut pas effacer une ligne de « staff » (le journal d'audit, append-only,
-- la référence dès la première connexion). Un compte supprimé est donc retiré des listes, bloqué, et son e-mail est libéré.
ALTER TABLE staff ADD COLUMN deleted_at TIMESTAMPTZ;
