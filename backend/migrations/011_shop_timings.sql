-- Durées des tours (mises / tirage / résultat, en secondes) par jeu. NULL = valeurs par défaut du code (TIMINGS).
-- Une version de réglages s'applique aux tours à partir du jour suivant sa création (heure d'Haïti), jamais au jour en cours :
-- les numéros de tours et les tickets déjà vendus restent cohérents.
ALTER TABLE shop_settings ADD COLUMN timings JSONB;
