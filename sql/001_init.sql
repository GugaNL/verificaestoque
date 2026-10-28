CREATE TABLE IF NOT EXISTS stock_notifications (
  id                 BIGSERIAL PRIMARY KEY,
  site_id            TEXT        NOT NULL,
  product_id         TEXT        NOT NULL,
  sku_id             TEXT        NOT NULL,
  email              TEXT        NOT NULL,
  profile_id         TEXT,
  organization_id    TEXT,
  locale             TEXT        NOT NULL DEFAULT 'pt-BR',
  product_name       TEXT,
  product_url        TEXT,
  product_image      TEXT,
  -- pending | sending | sent | expired | error | unsubscribed
  status             TEXT        NOT NULL DEFAULT 'pending',
  unsubscribe_token  TEXT        NOT NULL,
  attempts           INT         NOT NULL DEFAULT 0,
  last_error         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL,
  sent_at            TIMESTAMPTZ
);

-- Um e-mail só pode ter uma inscrição ativa por SKU/site
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_notifications_active
  ON stock_notifications (site_id, sku_id, lower(email))
  WHERE status IN ('pending', 'sending');

CREATE INDEX IF NOT EXISTS idx_stock_notifications_pending_sku
  ON stock_notifications (sku_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_notifications_unsubscribe_token
  ON stock_notifications (unsubscribe_token);
