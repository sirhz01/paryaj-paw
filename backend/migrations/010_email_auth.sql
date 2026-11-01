-- Authentification des joueurs par e-mail : le code de vérification arrive par e-mail (Resend), plus par SMS.
-- L'e-mail devient l'identifiant de connexion ; le téléphone reste facultatif (utile pour les retraits).
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE users ADD COLUMN email TEXT;

-- Unicité de l'e-mail ; les anciens comptes sans e-mail (NULL) ne se gênent pas (NULL distincts).
CREATE UNIQUE INDEX users_email_key ON users (email);
