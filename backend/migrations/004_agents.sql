-- Points de vente : agents, crédit de vente (« float »), commissions, tickets anonymes, dépôts et retraits au guichet.

-- Le solde d'un agent est son crédit de vente : il baisse quand il encaisse du liquide (ticket, dépôt joueur),
-- il monte quand il en décaisse (gain payé, retrait joueur) et avec ses commissions. Il peut descendre
-- jusqu'à −credit_limit_cents si la finance lui accorde un crédit.
CREATE TABLE agents (
  id                    BIGSERIAL PRIMARY KEY,
  code                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  phone                 TEXT NOT NULL UNIQUE,
  password_hash         TEXT NOT NULL,
  location              TEXT,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  balance_cents         BIGINT NOT NULL DEFAULT 0,
  credit_limit_cents    BIGINT NOT NULL DEFAULT 0 CHECK (credit_limit_cents >= 0),
  -- Commissions en points de base : 500 = 5 %.
  ticket_commission_bp  INT NOT NULL CHECK (ticket_commission_bp BETWEEN 0 AND 2000),
  deposit_commission_bp INT NOT NULL CHECK (deposit_commission_bp BETWEEN 0 AND 1000),
  created_by            BIGINT REFERENCES staff (id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agents_credit_limit CHECK (balance_cents >= -credit_limit_cents)
);

CREATE TABLE agent_ledger (
  id                  BIGSERIAL PRIMARY KEY,
  agent_id            BIGINT NOT NULL REFERENCES agents (id),
  kind                TEXT NOT NULL CHECK (kind IN ('float_topup', 'float_withdrawal', 'ticket_sale', 'ticket_payout',
                                                    'player_deposit', 'player_withdrawal', 'commission')),
  amount_cents        BIGINT NOT NULL CHECK (amount_cents <> 0),
  balance_after_cents BIGINT NOT NULL,
  ref_type            TEXT NOT NULL,
  ref_id              TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agent_ledger_agent ON agent_ledger (agent_id, id DESC);
CREATE INDEX agent_ledger_created ON agent_ledger (created_at);
CREATE TRIGGER agent_ledger_append_only BEFORE UPDATE OR DELETE ON agent_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Un ticket appartient soit à un joueur (payé depuis son portefeuille), soit à un agent (vendu au guichet).
ALTER TABLE tickets ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE tickets ADD COLUMN agent_id BIGINT REFERENCES agents (id);
ALTER TABLE tickets ADD COLUMN commission_bp INT NOT NULL DEFAULT 0 CHECK (commission_bp BETWEEN 0 AND 2000);
ALTER TABLE tickets ADD CONSTRAINT tickets_one_owner CHECK ((user_id IS NULL) <> (agent_id IS NULL));
CREATE UNIQUE INDEX tickets_agent_key ON tickets (agent_id, idempotency_key) WHERE agent_id IS NOT NULL;
CREATE INDEX tickets_agent ON tickets (agent_id, id DESC) WHERE agent_id IS NOT NULL;

ALTER TABLE ticket_entries ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE ticket_entries ADD COLUMN agent_id BIGINT REFERENCES agents (id);
ALTER TABLE ticket_entries ADD COLUMN commission_cents BIGINT NOT NULL DEFAULT 0 CHECK (commission_cents >= 0);
ALTER TABLE ticket_entries ADD CONSTRAINT ticket_entries_one_owner CHECK ((user_id IS NULL) <> (agent_id IS NULL));

-- Paiement au guichet d'un ticket d'agent : une seule fois (clé primaire), par n'importe quel agent.
CREATE TABLE ticket_redemptions (
  ticket_id    BIGINT PRIMARY KEY REFERENCES tickets (id),
  agent_id     BIGINT NOT NULL REFERENCES agents (id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER ticket_redemptions_append_only BEFORE UPDATE OR DELETE ON ticket_redemptions
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Dépôts faits par un agent et retraits en liquide au guichet (code de retrait généré par le joueur).
ALTER TABLE payments DROP CONSTRAINT payments_provider_check;
ALTER TABLE payments ADD CONSTRAINT payments_provider_check CHECK (provider IN ('moncash', 'natcash', 'fake', 'agent'));
ALTER TABLE payments ADD COLUMN agent_id BIGINT REFERENCES agents (id);
ALTER TABLE payments ADD COLUMN pickup_code_hash TEXT;
ALTER TABLE payments ADD COLUMN pickup_expires_at TIMESTAMPTZ;
CREATE INDEX payments_pickup ON payments (user_id, pickup_code_hash) WHERE pickup_code_hash IS NOT NULL;
