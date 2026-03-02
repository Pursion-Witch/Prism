CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT,
  region TEXT,
  srp_price NUMERIC,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS price_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  scanned_price NUMERIC NOT NULL,
  verdict TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS market_indices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  average_price NUMERIC NOT NULL,
  region TEXT NOT NULL,
  recorded_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_name ON products (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_products_region ON products (region);
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);

CREATE INDEX IF NOT EXISTS idx_market_indices_region ON market_indices (region);
CREATE INDEX IF NOT EXISTS idx_market_indices_category ON market_indices (category);

CREATE TABLE IF NOT EXISTS document_ingestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  source TEXT,
  file_type TEXT NOT NULL,
  extracted_text TEXT NOT NULL,
  parsed_json JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingested_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_id UUID NOT NULL REFERENCES document_ingestions(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  category TEXT,
  region TEXT,
  srp_price NUMERIC,
  raw_record JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_ingestions_created_at ON document_ingestions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingested_records_ingestion_id ON ingested_records (ingestion_id);
CREATE INDEX IF NOT EXISTS idx_ingested_records_product_name ON ingested_records (LOWER(product_name));
