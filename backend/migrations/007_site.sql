-- Site public : messages du formulaire de contact et audience anonyme (sans cookie, sans IP, sans identifiant).
CREATE TABLE contact_messages (
  id         BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  message    TEXT NOT NULL,
  handled_at TIMESTAMPTZ
);

CREATE TABLE site_pageviews (
  day   DATE NOT NULL,
  path  TEXT NOT NULL,
  views INT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path)
);
