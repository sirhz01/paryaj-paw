-- Graines communes à tous les jeux : une paire active par joueur et par jeu.
ALTER TABLE keno_seeds RENAME TO game_seeds;
ALTER TABLE game_seeds ADD COLUMN game TEXT NOT NULL DEFAULT 'keno' CHECK (game IN ('keno', 'roulette'));
ALTER TABLE game_seeds ALTER COLUMN game DROP DEFAULT;
DROP INDEX keno_seeds_one_active;
CREATE UNIQUE INDEX game_seeds_one_active ON game_seeds (user_id, game) WHERE active;

-- Une ligne par version : la plus récente est active.
-- bet_limits : { "<type de mise>": { "minCents": …, "maxCents": … } }, montant par position du tapis.
CREATE TABLE roulette_settings (
  version               SERIAL PRIMARY KEY,
  chip_values           JSONB NOT NULL,
  bet_limits            JSONB NOT NULL,
  max_total_stake_cents BIGINT NOT NULL CHECK (max_total_stake_cents > 0),
  max_payout_cents      BIGINT NOT NULL CHECK (max_payout_cents > 0),
  la_partage            BOOLEAN NOT NULL,
  created_by            BIGINT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER roulette_settings_append_only BEFORE UPDATE OR DELETE ON roulette_settings
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Hypothèses à confirmer par l'exploitant : jetons de 10 à 1 000 HTG, 50 000 HTG misés au plus par tour,
-- 1 000 000 HTG de gain au plus par tour, La Partage désactivée (RTP 97,30 %).
INSERT INTO roulette_settings (chip_values, bet_limits, max_total_stake_cents, max_payout_cents, la_partage)
VALUES (
  '[1000, 2500, 5000, 10000, 25000, 50000, 100000]',
  '{
    "straight": { "minCents": 1000, "maxCents": 50000 },
    "split":    { "minCents": 1000, "maxCents": 100000 },
    "street":   { "minCents": 1000, "maxCents": 150000 },
    "corner":   { "minCents": 1000, "maxCents": 200000 },
    "line":     { "minCents": 1000, "maxCents": 300000 },
    "dozen":    { "minCents": 1000, "maxCents": 1000000 },
    "column":   { "minCents": 1000, "maxCents": 1000000 },
    "red":      { "minCents": 1000, "maxCents": 1500000 },
    "black":    { "minCents": 1000, "maxCents": 1500000 },
    "even":     { "minCents": 1000, "maxCents": 1500000 },
    "odd":      { "minCents": 1000, "maxCents": 1500000 },
    "low":      { "minCents": 1000, "maxCents": 1500000 },
    "high":     { "minCents": 1000, "maxCents": 1500000 }
  }',
  5000000,
  100000000,
  false
);

-- bets : mises du tour après dépliage de la piste, avec ce que chacune a rapporté.
CREATE TABLE roulette_spins (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            BIGINT NOT NULL REFERENCES users (id),
  idempotency_key    TEXT NOT NULL,
  seed_id            BIGINT NOT NULL REFERENCES game_seeds (id),
  nonce              INT NOT NULL,
  number             SMALLINT NOT NULL CHECK (number BETWEEN 0 AND 36),
  bets               JSONB NOT NULL,
  total_stake_cents  BIGINT NOT NULL CHECK (total_stake_cents > 0),
  total_payout_cents BIGINT NOT NULL CHECK (total_payout_cents >= 0),
  covers_all         BOOLEAN NOT NULL,
  settings_version   INT NOT NULL REFERENCES roulette_settings (version),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  UNIQUE (seed_id, nonce)
);
CREATE INDEX roulette_spins_user ON roulette_spins (user_id, id DESC);
CREATE INDEX roulette_spins_created ON roulette_spins (created_at);
CREATE INDEX roulette_spins_covers_all ON roulette_spins (created_at) WHERE covers_all;
CREATE TRIGGER roulette_spins_append_only BEFORE UPDATE OR DELETE ON roulette_spins
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
