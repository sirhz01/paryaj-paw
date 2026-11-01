-- Montants en centimes de gourde (BIGINT) : 100 = 1 HTG.

CREATE FUNCTION forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME;
END
$$ LANGUAGE plpgsql;

-- Joueurs ---------------------------------------------------------------------

CREATE TABLE users (
  id                        BIGSERIAL PRIMARY KEY,
  phone                     TEXT NOT NULL UNIQUE,
  password_hash             TEXT NOT NULL,
  full_name                 TEXT,
  birth_date                DATE NOT NULL,
  language                  TEXT NOT NULL DEFAULT 'ht' CHECK (language IN ('ht', 'fr', 'en')),
  status                    TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  kyc_status                TEXT NOT NULL DEFAULT 'none' CHECK (kyc_status IN ('none', 'pending', 'verified', 'rejected')),
  self_excluded_until       TIMESTAMPTZ,
  daily_loss_limit_cents    BIGINT CHECK (daily_loss_limit_cents > 0),
  daily_deposit_limit_cents BIGINT CHECK (daily_deposit_limit_cents > 0),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE otp_codes (
  id          BIGSERIAL PRIMARY KEY,
  phone       TEXT NOT NULL,
  purpose     TEXT NOT NULL CHECK (purpose IN ('register', 'reset_password')),
  code_hash   TEXT NOT NULL,
  attempts    INT NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_lookup ON otp_codes (phone, purpose, created_at DESC);

CREATE TABLE refresh_tokens (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users (id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Portefeuille ----------------------------------------------------------------

CREATE TABLE wallets (
  user_id       BIGINT PRIMARY KEY REFERENCES users (id),
  balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES users (id),
  kind                TEXT NOT NULL CHECK (kind IN ('deposit', 'withdrawal', 'withdrawal_refund', 'bet', 'win', 'adjustment')),
  amount_cents        BIGINT NOT NULL CHECK (amount_cents <> 0),
  balance_after_cents BIGINT NOT NULL CHECK (balance_after_cents >= 0),
  ref_type            TEXT NOT NULL,
  ref_id              TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_user ON ledger_entries (user_id, id DESC);
CREATE INDEX ledger_entries_ref ON ledger_entries (ref_type, ref_id);
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE payments (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users (id),
  direction       TEXT NOT NULL CHECK (direction IN ('deposit', 'withdrawal')),
  provider        TEXT NOT NULL CHECK (provider IN ('moncash', 'natcash', 'fake')),
  amount_cents    BIGINT NOT NULL CHECK (amount_cents > 0),
  status          TEXT NOT NULL CHECK (status IN ('pending', 'awaiting_approval', 'processing', 'completed', 'failed', 'rejected')),
  idempotency_key TEXT NOT NULL,
  provider_ref    TEXT,
  failure_reason  TEXT,
  reviewed_by     BIGINT,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX payments_status ON payments (direction, status, created_at);

-- Keno ------------------------------------------------------------------------

-- Une ligne par version : la plus récente est active, les anciennes servent d'historique.
CREATE TABLE game_settings (
  version          SERIAL PRIMARY KEY,
  min_stake_cents  BIGINT NOT NULL CHECK (min_stake_cents > 0),
  max_stake_cents  BIGINT NOT NULL,
  max_picks        SMALLINT NOT NULL CHECK (max_picks BETWEEN 1 AND 10),
  max_payout_cents BIGINT NOT NULL CHECK (max_payout_cents > 0),
  paytable         JSONB NOT NULL,
  created_by       BIGINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (max_stake_cents >= min_stake_cents)
);
CREATE TRIGGER game_settings_append_only BEFORE UPDATE OR DELETE ON game_settings
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Table de gains par défaut : RTP de 91,6 % à 93 % selon le nombre de numéros.
-- À faire valider par le rapport mathématique certifié avant lancement.
INSERT INTO game_settings (min_stake_cents, max_stake_cents, max_picks, max_payout_cents, paytable)
VALUES (1000, 500000, 10, 100000000, '{
  "1":  [0, 3.7],
  "2":  [0, 1, 9.1],
  "3":  [0, 0, 3, 37],
  "4":  [0, 0, 1.4, 6.8, 110],
  "5":  [0, 0, 0.6, 3.3, 17, 440],
  "6":  [0, 0, 0, 2, 7.9, 79, 1500],
  "7":  [0, 0, 0, 1.1, 4.5, 23, 225, 5650],
  "8":  [0, 0, 0, 0.5, 2.2, 11, 88, 1100, 10000],
  "9":  [0, 0, 0, 0.5, 1.6, 5.4, 33, 270, 2700, 10000],
  "10": [1.1, 0, 0, 0, 1.1, 3.3, 16, 110, 1100, 5400, 10000]
}');

-- Graine serveur secrète tant que la paire est active ; son hash est publié avant chaque tirage.
CREATE TABLE keno_seeds (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL REFERENCES users (id),
  server_seed      TEXT NOT NULL,
  server_seed_hash TEXT NOT NULL,
  client_seed      TEXT NOT NULL,
  next_nonce       INT NOT NULL DEFAULT 0,
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  revealed_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX keno_seeds_one_active ON keno_seeds (user_id) WHERE active;

CREATE TABLE keno_bets (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL REFERENCES users (id),
  idempotency_key  TEXT NOT NULL,
  seed_id          BIGINT NOT NULL REFERENCES keno_seeds (id),
  nonce            INT NOT NULL,
  picks            SMALLINT[] NOT NULL,
  drawn            SMALLINT[] NOT NULL,
  hits             SMALLINT NOT NULL,
  stake_cents      BIGINT NOT NULL CHECK (stake_cents > 0),
  multiplier       NUMERIC(12, 2) NOT NULL,
  payout_cents     BIGINT NOT NULL CHECK (payout_cents >= 0),
  settings_version INT NOT NULL REFERENCES game_settings (version),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  UNIQUE (seed_id, nonce)
);
CREATE INDEX keno_bets_user ON keno_bets (user_id, id DESC);
CREATE INDEX keno_bets_created ON keno_bets (created_at);
CREATE TRIGGER keno_bets_append_only BEFORE UPDATE OR DELETE ON keno_bets
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Back-office -----------------------------------------------------------------

CREATE TABLE staff (
  id                BIGSERIAL PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  role              TEXT NOT NULL CHECK (role IN ('super_admin', 'finance', 'support', 'auditor')),
  totp_secret       TEXT NOT NULL,
  totp_last_counter BIGINT NOT NULL DEFAULT 0,
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  staff_id    BIGINT NOT NULL REFERENCES staff (id),
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  details     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
