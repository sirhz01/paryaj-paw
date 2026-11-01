-- Plateforme 4 jeux : roulette américaine, Keno jusqu'à 15 numéros, Lucky Six et Lucky 10 (tirages programmés).

-- Journal : remboursement de mise (tirage annulé, gros gain refusé).
ALTER TABLE ledger_entries DROP CONSTRAINT ledger_entries_kind_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_kind_check
  CHECK (kind IN ('deposit', 'withdrawal', 'withdrawal_refund', 'bet', 'win', 'bet_refund', 'adjustment'));

-- Keno : plafond de numéros paramétrable jusqu'à 15.
ALTER TABLE game_settings DROP CONSTRAINT game_settings_max_picks_check;
ALTER TABLE game_settings ADD CONSTRAINT game_settings_max_picks_check CHECK (max_picks BETWEEN 1 AND 15);

-- Graines par joueur : la roulette américaine a les siennes.
ALTER TABLE game_seeds DROP CONSTRAINT game_seeds_game_check;
ALTER TABLE game_seeds ADD CONSTRAINT game_seeds_game_check CHECK (game IN ('keno', 'roulette', 'american_roulette'));

-- Roulette : deux variantes. En américaine, la case 37 représente le 00.
ALTER TABLE roulette_settings ADD COLUMN variant TEXT NOT NULL DEFAULT 'european' CHECK (variant IN ('european', 'american'));
ALTER TABLE roulette_settings ADD COLUMN top_line_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE roulette_settings ALTER COLUMN variant DROP DEFAULT;
ALTER TABLE roulette_settings ALTER COLUMN top_line_enabled DROP DEFAULT;

INSERT INTO roulette_settings (variant, chip_values, bet_limits, max_total_stake_cents, max_payout_cents, la_partage, top_line_enabled)
VALUES (
  'american',
  '[1000, 2500, 5000, 10000, 25000, 50000, 100000]',
  '{
    "straight": { "minCents": 1000, "maxCents": 50000 },
    "split":    { "minCents": 1000, "maxCents": 100000 },
    "street":   { "minCents": 1000, "maxCents": 150000 },
    "corner":   { "minCents": 1000, "maxCents": 200000 },
    "top_line": { "minCents": 1000, "maxCents": 150000 },
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
  false,
  true
);

ALTER TABLE roulette_spins ADD COLUMN variant TEXT NOT NULL DEFAULT 'european' CHECK (variant IN ('european', 'american'));
ALTER TABLE roulette_spins ALTER COLUMN variant DROP DEFAULT;
ALTER TABLE roulette_spins DROP CONSTRAINT roulette_spins_number_check;
ALTER TABLE roulette_spins ADD CONSTRAINT roulette_spins_number_check
  CHECK (number BETWEEN 0 AND 37 AND (variant = 'american' OR number <= 36));
ALTER TABLE roulette_spins DROP CONSTRAINT roulette_spins_user_id_idempotency_key_key;
ALTER TABLE roulette_spins ADD CONSTRAINT roulette_spins_user_variant_key UNIQUE (user_id, variant, idempotency_key);

-- Tirages programmés -----------------------------------------------------------

-- Une ligne par version et par jeu ; `config` est validé par l'application.
CREATE TABLE draw_game_settings (
  version    SERIAL PRIMARY KEY,
  game       TEXT NOT NULL CHECK (game IN ('lucky_six', 'lucky_ten')),
  config     JSONB NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER draw_game_settings_append_only BEFORE UPDATE OR DELETE ON draw_game_settings
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Hypothèses à confirmer par l'exploitant et le rapport mathématique (RTP visé : 92,5 %).
-- Lucky Six : la table « du marché » du cahier des charges donne un RTP de 101,9 % ; celle-ci
-- garde les quatre premiers coefficients et multiplie les suivants par 0,907.
INSERT INTO draw_game_settings (game, config) VALUES
('lucky_six', '{
  "intervalMinutes": 5,
  "closeBeforeSeconds": 10,
  "minStakeCents": 100,
  "maxStakeCents": 100000,
  "maxDrawsPerTicket": 10,
  "maxPayoutCents": 100000000,
  "reviewThresholdCents": 5000000,
  "positionCoefficients": [10000, 7500, 5000, 2500, 905, 455, 270, 180, 135, 91, 82, 73, 63, 54, 45, 36, 27, 23, 18, 14,
                           9.1, 8.2, 7.3, 6.3, 5.4, 4.5, 3.6, 2.7, 1.8, 0.9],
  "sideBets": {
    "first_even": 1.85, "first_odd": 1.85, "first_low": 1.85, "first_high": 1.85, "first_color": 7.4,
    "sum5_under": 1.85, "sum5_over": 1.85, "more_even5": 1.85, "more_odd5": 1.85
  }
}'),
('lucky_ten', '{
  "intervalMinutes": 5,
  "closeBeforeSeconds": 10,
  "minStakeCents": 100,
  "maxStakeCents": 100000,
  "maxDrawsPerTicket": 20,
  "maxPicks": 10,
  "maxPayoutCents": 100000000,
  "reviewThresholdCents": 5000000,
  "luckyNumberMultiplier": 2,
  "paytable": {
    "1":  [0, 3.5],
    "2":  [0, 0.9, 8.6],
    "3":  [0, 0, 2.6, 33],
    "4":  [0, 0, 1.2, 5.9, 95],
    "5":  [0, 0, 0.5, 2.8, 14, 375],
    "6":  [0, 0, 0, 1.6, 6.5, 65, 1250],
    "7":  [0, 0, 0, 0.9, 3.6, 18, 180, 4550],
    "8":  [0, 0, 0, 0.4, 1.7, 8.7, 69, 865, 10000],
    "9":  [0, 0, 0, 0.4, 1.3, 4.2, 26, 210, 2100, 10000],
    "10": [0.9, 0, 0, 0, 0.9, 2.6, 12, 85, 850, 4150, 10000]
  },
  "sideBets": {
    "more_even": 2.32, "more_odd": 2.32, "more_low": 2.32, "more_high": 2.32,
    "sum_under": 1.84, "sum_over": 1.86, "first_even": 1.85, "first_odd": 1.85, "first_color": 7.4
  }
}');

-- La graine est tirée et son hash publié à la création du tirage ; elle n'est révélée qu'après le tirage.
CREATE TABLE draws (
  id               BIGSERIAL PRIMARY KEY,
  game             TEXT NOT NULL CHECK (game IN ('lucky_six', 'lucky_ten')),
  scheduled_at     TIMESTAMPTZ NOT NULL,
  closes_at        TIMESTAMPTZ NOT NULL,
  server_seed      TEXT NOT NULL,
  server_seed_hash TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'drawn', 'settled', 'cancelled')),
  balls            SMALLINT[],
  drawn_at         TIMESTAMPTZ,
  settled_at       TIMESTAMPTZ,
  cancel_reason    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game, scheduled_at),
  CHECK (closes_at < scheduled_at)
);
CREATE INDEX draws_due ON draws (game, status, scheduled_at);

-- Graine, horaire et résultat d'un tirage ne changent plus une fois écrits.
CREATE FUNCTION draws_sealed() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'table draws is append-only';
  END IF;
  IF NEW.game IS DISTINCT FROM OLD.game
     OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
     OR NEW.closes_at IS DISTINCT FROM OLD.closes_at
     OR NEW.server_seed IS DISTINCT FROM OLD.server_seed
     OR NEW.server_seed_hash IS DISTINCT FROM OLD.server_seed_hash
     OR (OLD.balls IS NOT NULL AND NEW.balls IS DISTINCT FROM OLD.balls) THEN
    RAISE EXCEPTION 'draw % is sealed', OLD.id;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
CREATE TRIGGER draws_sealed BEFORE UPDATE OR DELETE ON draws FOR EACH ROW EXECUTE FUNCTION draws_sealed();

-- Un ticket = un pari sur un ou plusieurs tirages consécutifs, payé d'avance.
CREATE TABLE tickets (
  id                   BIGSERIAL PRIMARY KEY,
  code                 TEXT NOT NULL UNIQUE,
  user_id              BIGINT NOT NULL REFERENCES users (id),
  game                 TEXT NOT NULL CHECK (game IN ('lucky_six', 'lucky_ten')),
  idempotency_key      TEXT NOT NULL,
  bet                  JSONB NOT NULL,
  stake_per_draw_cents BIGINT NOT NULL CHECK (stake_per_draw_cents > 0),
  total_stake_cents    BIGINT NOT NULL CHECK (total_stake_cents > 0),
  settings_version     INT NOT NULL REFERENCES draw_game_settings (version),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX tickets_user ON tickets (user_id, id DESC);
CREATE INDEX tickets_created ON tickets (created_at);
CREATE TRIGGER tickets_append_only BEFORE UPDATE OR DELETE ON tickets
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Participation d'un ticket à un tirage. `review` : gros gain calculé, en attente de validation.
CREATE TABLE ticket_entries (
  id           BIGSERIAL PRIMARY KEY,
  ticket_id    BIGINT NOT NULL REFERENCES tickets (id),
  draw_id      BIGINT NOT NULL REFERENCES draws (id),
  user_id      BIGINT NOT NULL REFERENCES users (id),
  stake_cents  BIGINT NOT NULL CHECK (stake_cents > 0),
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'won', 'lost', 'review', 'rejected', 'refunded')),
  payout_cents BIGINT NOT NULL DEFAULT 0 CHECK (payout_cents >= 0),
  settled_at   TIMESTAMPTZ,
  reviewed_by  BIGINT REFERENCES staff (id),
  reviewed_at  TIMESTAMPTZ,
  review_note  TEXT,
  UNIQUE (ticket_id, draw_id)
);
CREATE INDEX ticket_entries_draw ON ticket_entries (draw_id, status);
CREATE INDEX ticket_entries_review ON ticket_entries (id) WHERE status = 'review';
