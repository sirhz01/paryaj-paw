-- Retrait de la roulette européenne : seule la roulette américaine reste.
-- Les paramètres, graines et tours européens déjà enregistrés sont conservés (traçabilité de 5 ans),
-- mais plus aucun ne peut être créé (contraintes NOT VALID : les lignes existantes ne sont pas revérifiées).
ALTER TABLE roulette_settings ADD CONSTRAINT roulette_settings_american_only CHECK (variant = 'american') NOT VALID;
ALTER TABLE roulette_spins ADD CONSTRAINT roulette_spins_american_only CHECK (variant = 'american') NOT VALID;
ALTER TABLE game_seeds ADD CONSTRAINT game_seeds_no_european_roulette CHECK (game <> 'roulette') NOT VALID;
