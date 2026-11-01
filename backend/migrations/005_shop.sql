-- Boutique : tours chronométrés communs (Roulette américaine, Keno 20/80, Lucky Six, Lucky X),
-- tickets vendus en caisse, règlement et décaissement. Montants en centimes de gourde.

-- Caissier : compte du back-office limité à la vente et au décaissement.
ALTER TABLE staff DROP CONSTRAINT staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check
  CHECK (role IN ('super_admin', 'finance', 'support', 'auditor', 'cashier'));

-- Paramètres versionnés : la version la plus récente s'applique, chaque ticket garde la sienne.
-- paytables : { keno: { "<numéros choisis>": { "<trouvés>": coefficient } },
--               luckysix: [coefficient de la boule 6, …, de la boule 35],
--               luckyx: { single: coefficient, tiers: { "<numéros>": coefficient } } }
CREATE TABLE shop_settings (
  version                  SERIAL PRIMARY KEY,
  point_of_sale            TEXT NOT NULL,
  issuer                   TEXT NOT NULL,
  terminals                JSONB NOT NULL,
  stakes_cents             JSONB NOT NULL,
  min_stake_cents          BIGINT NOT NULL CHECK (min_stake_cents > 0),
  max_stake_cents          BIGINT NOT NULL,
  max_ticket_cents         BIGINT NOT NULL,
  max_payout_cents         BIGINT NOT NULL CHECK (max_payout_cents > 0),
  approval_threshold_cents BIGINT NOT NULL CHECK (approval_threshold_cents > 0),
  top_line_enabled         BOOLEAN NOT NULL,
  paytables                JSONB NOT NULL,
  created_by               BIGINT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (max_stake_cents >= min_stake_cents),
  CHECK (max_ticket_cents >= max_stake_cents)
);
CREATE TRIGGER shop_settings_append_only BEFORE UPDATE OR DELETE ON shop_settings
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Valeurs de l'écran de la boutique (js/config.js). Les tables Keno 6/7/8/10 et Lucky X sont des valeurs DEMO ;
-- plusieurs lignes ont un RTP très éloigné de 90-95 % (voir GET /admin/shop/settings) : à remplacer par le
-- rapport mathématique certifié avant ouverture. Plafonds et seuil de validation : hypothèses de l'exploitant.
INSERT INTO shop_settings (point_of_sale, issuer, terminals, stakes_cents, min_stake_cents, max_stake_cents,
                           max_ticket_cents, max_payout_cents, approval_threshold_cents, top_line_enabled, paytables)
VALUES (
  'PRONO Limonade, Rue Prison, Roucou',
  'Limo prono by Mme Jean Gilles',
  '["CAISSE #1", "CAISSE #2", "CAISSE #3"]',
  '[2500, 5000, 10000, 25000, 50000, 100000]',
  2500, 500000, 2000000, 100000000, 1000000, true,
  '{
    "keno": {
      "1":  { "1": 3 },
      "2":  { "2": 19 },
      "3":  { "2": 2, "3": 25 },
      "4":  { "2": 1, "3": 5, "4": 80 },
      "5":  { "3": 3, "4": 15, "5": 400 },
      "6":  { "3": 1, "4": 4, "5": 20, "6": 300 },
      "7":  { "4": 2, "5": 10, "6": 60, "7": 800 },
      "8":  { "4": 1, "5": 5, "6": 25, "7": 200, "8": 2000 },
      "9":  { "0": 1, "4": 2, "5": 10, "6": 25, "7": 125, "8": 1000, "9": 5000 },
      "10": { "5": 2, "6": 10, "7": 50, "8": 300, "9": 2500, "10": 10000 }
    },
    "luckysix": [10000, 7500, 5000, 2500, 1000, 500, 300, 200, 150, 100,
                 80, 60, 40, 30, 25, 20, 18, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
    "luckyx": {
      "single": 6,
      "tiers": { "2": 6, "3": 13, "4": 19, "5": 70, "6": 250, "7": 700, "8": 2000, "9": 3000, "10": 20000 }
    }
  }'
);

-- Un tour = une ligne, créée avant le début du tirage (jamais après coup). La graine reste secrète jusqu'à la fin
-- du tirage ; son hash est publié dès la création, donc avant la fermeture des mises.
CREATE TABLE shop_rounds (
  game             TEXT NOT NULL CHECK (game IN ('roulette', 'keno', 'luckysix', 'luckyx')),
  day              DATE NOT NULL,
  round_no         INT NOT NULL CHECK (round_no > 0),
  server_seed      TEXT NOT NULL,
  server_seed_hash TEXT NOT NULL,
  result           JSONB NOT NULL,
  draw_starts_at   TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game, day, round_no)
);
CREATE TRIGGER shop_rounds_append_only BEFORE UPDATE OR DELETE ON shop_rounds
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Le ticket ne change jamais ; son résultat et son paiement sont dans deux tables à part.
CREATE TABLE shop_tickets (
  id               TEXT PRIMARY KEY,
  staff_id         BIGINT NOT NULL REFERENCES staff (id),
  terminal         TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL,
  game             TEXT NOT NULL,
  day              DATE NOT NULL,
  round_no         INT NOT NULL,
  lines            JSONB NOT NULL,
  stake_cents      BIGINT NOT NULL CHECK (stake_cents > 0),
  settings_version INT NOT NULL REFERENCES shop_settings (version),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (game, day, round_no) REFERENCES shop_rounds (game, day, round_no),
  UNIQUE (staff_id, idempotency_key)
);
CREATE INDEX shop_tickets_round ON shop_tickets (game, day, round_no);
CREATE INDEX shop_tickets_created ON shop_tickets (created_at);
CREATE TRIGGER shop_tickets_append_only BEFORE UPDATE OR DELETE ON shop_tickets
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

CREATE TABLE shop_ticket_results (
  ticket_id  TEXT PRIMARY KEY REFERENCES shop_tickets (id),
  win_cents  BIGINT NOT NULL CHECK (win_cents >= 0),
  settled_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER shop_ticket_results_append_only BEFORE UPDATE OR DELETE ON shop_ticket_results
  FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- La clé primaire interdit tout double décaissement.
CREATE TABLE shop_payouts (
  ticket_id    TEXT PRIMARY KEY REFERENCES shop_tickets (id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  staff_id     BIGINT NOT NULL REFERENCES staff (id),
  terminal     TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX shop_payouts_created ON shop_payouts (created_at);
CREATE TRIGGER shop_payouts_append_only BEFORE UPDATE OR DELETE ON shop_payouts
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
