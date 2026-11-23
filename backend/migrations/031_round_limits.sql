-- Limites par tour, réglables dans l'administration (Réglages → Mises et limites) :
--  * max_number_stake_cents : mise totale acceptée sur un même numéro dans un tour, toutes caisses confondues
--    (roulette : pari simple ; Keno / Lucky : chaque numéro choisi). 2 500 HTG par défaut.
--  * max_round_payout_cents : pire somme à payer sur un tour de roulette (case la plus chargée). Une vente qui
--    l'aggraverait au-delà du plafond est refusée. 100 000 HTG par défaut. Pas appliqué aux jeux de numéros :
--    leurs gros lots (Keno 10 numéros…) dépassent à eux seuls tout plafond raisonnable.
-- Les limites ne regardent que les mises, jamais le résultat du tour.
ALTER TABLE shop_settings
  ADD COLUMN max_number_stake_cents BIGINT NOT NULL DEFAULT 250000 CHECK (max_number_stake_cents > 0),
  ADD COLUMN max_round_payout_cents BIGINT NOT NULL DEFAULT 10000000 CHECK (max_round_payout_cents > 0);
