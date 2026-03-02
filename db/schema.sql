CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  seller_id UUID NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS live_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS price_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  avg_market_price NUMERIC(12, 2) NOT NULL CHECK (avg_market_price >= 0),
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS price_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES price_products(id) ON UPDATE CASCADE ON DELETE CASCADE,
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  region TEXT NOT NULL DEFAULT 'National',
  anomaly_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'heuristic',
  raw_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_seller_id ON products (seller_id);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_user_id_occurred_at ON alerts (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_occurred_at ON alerts (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_metrics_metric_recorded_at ON live_metrics (metric, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_products_category_updated_at ON price_products (category, last_updated DESC);
CREATE INDEX IF NOT EXISTS idx_price_transactions_product_created_at ON price_transactions (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_transactions_created_at ON price_transactions (created_at DESC);

CREATE OR REPLACE FUNCTION set_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_set_updated_at ON products;
CREATE TRIGGER trg_products_set_updated_at
BEFORE UPDATE ON products
FOR EACH ROW
EXECUTE FUNCTION set_products_updated_at();

CREATE OR REPLACE FUNCTION notify_alert_insert()
RETURNS TRIGGER AS $$
DECLARE
  payload JSON;
BEGIN
  payload = json_build_object(
    'id', NEW.id,
    'user_id', NEW.user_id,
    'type', NEW.type,
    'message', NEW.message,
    'occurred_at', NEW.occurred_at,
    'created_at', NEW.created_at
  );
  PERFORM pg_notify('alerts_inserted', payload::TEXT);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_alert_notify_insert ON alerts;
CREATE TRIGGER trg_alert_notify_insert
AFTER INSERT ON alerts
FOR EACH ROW
EXECUTE FUNCTION notify_alert_insert();

CREATE OR REPLACE FUNCTION notify_live_metric_insert()
RETURNS TRIGGER AS $$
DECLARE
  payload JSON;
BEGIN
  payload = json_build_object(
    'id', NEW.id,
    'metric', NEW.metric,
    'value', NEW.value,
    'recorded_at', NEW.recorded_at,
    'created_at', NEW.created_at
  );
  PERFORM pg_notify('metrics_inserted', payload::TEXT);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_live_metrics_notify_insert ON live_metrics;
CREATE TRIGGER trg_live_metrics_notify_insert
AFTER INSERT ON live_metrics
FOR EACH ROW
EXECUTE FUNCTION notify_live_metric_insert();
