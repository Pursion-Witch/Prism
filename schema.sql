CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT,
  region TEXT,
  brand_name TEXT,
  market_name TEXT,
  stall_name TEXT,
  srp_price NUMERIC,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE products ADD COLUMN IF NOT EXISTS brand_name TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS market_name TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS stall_name TEXT;

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
CREATE INDEX IF NOT EXISTS idx_products_market_name ON products (LOWER(market_name));
CREATE INDEX IF NOT EXISTS idx_products_stall_name ON products (LOWER(stall_name));

WITH cebu_goods(name, category, brand_name, market_name, stall_name, srp_price) AS (
  VALUES
    ('Sinandomeng Rice', 'RICE', NULL, 'Carbon Public Market', 'Stall R-01', 52.00),
    ('Dinorado Rice', 'RICE', NULL, 'Carbon Public Market', 'Stall R-02', 60.00),
    ('Jasmine Rice', 'RICE', NULL, 'Carbon Public Market', 'Stall R-03', 58.00),
    ('Well-Milled Rice', 'RICE', NULL, 'Carbon Public Market', 'Stall R-04', 48.00),
    ('Brown Rice', 'RICE', NULL, 'Carbon Public Market', 'Stall R-05', 72.00),
    ('NFA Rice', 'RICE', NULL, 'Carbon Public Market', 'Stall R-06', 43.00),
    ('Malagkit Rice', 'RICE', NULL, 'Carbon Public Market', 'Stall R-07', 68.00),
    ('Corn Grits White', 'GRAINS', NULL, 'Carbon Public Market', 'Stall G-01', 39.00),
    ('Corn Grits Yellow', 'GRAINS', NULL, 'Carbon Public Market', 'Stall G-02', 41.00),
    ('Adlai Grain', 'GRAINS', NULL, 'Carbon Public Market', 'Stall G-03', 95.00),
    ('Galunggong Round Scad', 'FISH', NULL, 'Pasil Fish Market', 'Stall F-01', 215.00),
    ('Tamban Sardinella Fresh', 'FISH', NULL, 'Pasil Fish Market', 'Stall F-02', 165.00),
    ('Bangus Milkfish', 'FISH', NULL, 'Pasil Fish Market', 'Stall F-03', 240.00),
    ('Tilapia Fresh', 'FISH', NULL, 'Pasil Fish Market', 'Stall F-04', 195.00),
    ('Bisugo Threadfin Bream', 'FISH', NULL, 'Pasil Fish Market', 'Stall F-05', 310.00),
    ('Maya-Maya Snapper', 'FISH', NULL, 'Pasil Fish Market', 'Stall F-06', 360.00),
    ('Tulingan Mackerel Tuna', 'FISH', NULL, 'Pasil Fish Market', 'Stall F-07', 230.00),
    ('Hasa-Hasa Short Mackerel', 'FISH', NULL, 'Pasil Fish Market', 'Stall F-08', 205.00),
    ('Danggit Cebu', 'DRIED_FISH', NULL, 'Taboan Public Market', 'Stall D-01', 780.00),
    ('Dried Pusit Squid', 'DRIED_FISH', NULL, 'Taboan Public Market', 'Stall D-02', 860.00),
    ('Dried Dilis Anchovy', 'DRIED_FISH', NULL, 'Taboan Public Market', 'Stall D-03', 430.00),
    ('Fresh Squid Medium', 'SEAFOOD', NULL, 'Pasil Fish Market', 'Stall F-09', 320.00),
    ('Shrimp Medium', 'SEAFOOD', NULL, 'Pasil Fish Market', 'Stall F-10', 420.00),
    ('Blue Crab Alimango', 'SEAFOOD', NULL, 'Pasil Fish Market', 'Stall F-11', 540.00),
    ('Mussels Tahong', 'SEAFOOD', NULL, 'Pasil Fish Market', 'Stall F-12', 140.00),
    ('Clams Halaan', 'SEAFOOD', NULL, 'Pasil Fish Market', 'Stall F-13', 120.00),
    ('Seaweed Lato', 'SEAFOOD', NULL, 'Pasil Fish Market', 'Stall F-14', 85.00),
    ('Tuna Panga Cut', 'FISH', NULL, 'Pasil Fish Market', 'Stall F-15', 280.00),
    ('Salmon Belly Imported', 'FISH', NULL, 'Pasil Fish Market', 'Stall F-16', 690.00),
    ('Sardines Fresh', 'FISH', NULL, 'Pasil Fish Market', 'Stall F-17', 155.00),
    ('Pork Liempo', 'MEAT', NULL, 'Carbon Public Market', 'Stall M-01', 370.00),
    ('Pork Kasim', 'MEAT', NULL, 'Carbon Public Market', 'Stall M-02', 335.00),
    ('Pork Giniling Lean', 'MEAT', NULL, 'Carbon Public Market', 'Stall M-03', 355.00),
    ('Beef Brisket', 'MEAT', NULL, 'Carbon Public Market', 'Stall M-04', 460.00),
    ('Beef Sirloin', 'MEAT', NULL, 'Carbon Public Market', 'Stall M-05', 510.00),
    ('Ground Beef', 'MEAT', NULL, 'Carbon Public Market', 'Stall M-06', 430.00),
    ('Whole Chicken Dressed', 'POULTRY', NULL, 'Carbon Public Market', 'Stall P-01', 210.00),
    ('Chicken Leg Quarter', 'POULTRY', NULL, 'Carbon Public Market', 'Stall P-02', 195.00),
    ('Chicken Breast Fillet', 'POULTRY', NULL, 'Carbon Public Market', 'Stall P-03', 245.00),
    ('Native Chicken Bisaya', 'POULTRY', NULL, 'Carbon Public Market', 'Stall P-04', 320.00),
    ('Duck Whole', 'POULTRY', NULL, 'Carbon Public Market', 'Stall P-05', 295.00),
    ('Chicken Eggs Large Dozen', 'EGGS', NULL, 'Carbon Public Market', 'Stall E-01', 108.00),
    ('Chicken Eggs Medium Dozen', 'EGGS', NULL, 'Carbon Public Market', 'Stall E-02', 96.00),
    ('Quail Eggs Tray 30', 'EGGS', NULL, 'Carbon Public Market', 'Stall E-03', 88.00),
    ('Chorizo de Cebu', 'MEAT', NULL, 'Carbon Public Market', 'Stall M-07', 420.00),
    ('Red Onion Local', 'VEGETABLES', NULL, 'Carbon Public Market', 'Stall V-01', 175.00),
    ('White Onion Imported', 'VEGETABLES', NULL, 'Carbon Public Market', 'Stall V-02', 165.00),
    ('Garlic Native', 'VEGETABLES', NULL, 'Carbon Public Market', 'Stall V-03', 255.00),
    ('Ginger Native', 'VEGETABLES', NULL, 'Carbon Public Market', 'Stall V-04', 145.00),
    ('Tomato Ripe', 'VEGETABLES', NULL, 'Carbon Public Market', 'Stall V-05', 110.00),
    ('Carrot', 'VEGETABLES', NULL, 'Carbon Public Market', 'Stall V-06', 125.00),
    ('Potato', 'VEGETABLES', NULL, 'Carbon Public Market', 'Stall V-07', 115.00),
    ('Cabbage', 'VEGETABLES', NULL, 'Carbon Public Market', 'Stall V-08', 78.00),
    ('Eggplant Long Purple', 'VEGETABLES', NULL, 'Carbon Public Market', 'Stall V-09', 92.00),
    ('Okra', 'VEGETABLES', NULL, 'Carbon Public Market', 'Stall V-10', 88.00),
    ('Ampalaya Bitter Gourd', 'VEGETABLES', NULL, 'Carbon Public Market', 'Stall V-11', 98.00),
    ('Sitaw String Beans', 'VEGETABLES', NULL, 'Carbon Public Market', 'Stall V-12', 90.00),
    ('Kalabasa Squash', 'VEGETABLES', NULL, 'Carbon Public Market', 'Stall V-13', 62.00),
    ('Pechay', 'VEGETABLES', NULL, 'Carbon Public Market', 'Stall V-14', 54.00),
    ('Kangkong', 'VEGETABLES', NULL, 'Carbon Public Market', 'Stall V-15', 42.00),
    ('Lettuce Iceberg', 'VEGETABLES', NULL, 'Carbon Public Market', 'Stall V-16', 145.00),
    ('Sayote Chayote', 'VEGETABLES', NULL, 'Carbon Public Market', 'Stall V-17', 58.00),
    ('Bell Pepper Green', 'VEGETABLES', NULL, 'Carbon Public Market', 'Stall V-18', 175.00),
    ('Bell Pepper Red', 'VEGETABLES', NULL, 'Carbon Public Market', 'Stall V-19', 225.00),
    ('Siling Labuyo Chili', 'VEGETABLES', NULL, 'Carbon Public Market', 'Stall V-20', 390.00),
    ('Banana Lakatan', 'FRUITS', NULL, 'Carbon Public Market', 'Stall FR-01', 92.00),
    ('Banana Saba', 'FRUITS', NULL, 'Carbon Public Market', 'Stall FR-02', 58.00),
    ('Mango Carabao', 'FRUITS', NULL, 'Carbon Public Market', 'Stall FR-03', 145.00),
    ('Pineapple Formosa', 'FRUITS', NULL, 'Carbon Public Market', 'Stall FR-04', 88.00),
    ('Papaya Solo', 'FRUITS', NULL, 'Carbon Public Market', 'Stall FR-05', 72.00),
    ('Watermelon Red', 'FRUITS', NULL, 'Carbon Public Market', 'Stall FR-06', 55.00),
    ('Calamansi', 'FRUITS', NULL, 'Carbon Public Market', 'Stall FR-07', 95.00),
    ('Pomelo Cebu', 'FRUITS', NULL, 'Carbon Public Market', 'Stall FR-08', 120.00),
    ('Avocado Local', 'FRUITS', NULL, 'Carbon Public Market', 'Stall FR-09', 110.00),
    ('Coconut Mature', 'FRUITS', NULL, 'Carbon Public Market', 'Stall FR-10', 42.00),
    ('Lucky Me Pancit Canton Original 60g', 'PANTRY', 'Lucky Me', 'Mandaue Public Market', 'Stall S-01', 15.00),
    ('Nissin Cup Noodles Beef 60g', 'PANTRY', 'Nissin', 'Mandaue Public Market', 'Stall S-02', 32.00),
    ('UFC Banana Ketchup 550g', 'PANTRY', 'UFC', 'Mandaue Public Market', 'Stall S-03', 58.00),
    ('Datu Puti Soy Sauce 385ml', 'PANTRY', 'Datu Puti', 'Mandaue Public Market', 'Stall S-04', 29.00),
    ('Datu Puti Vinegar 1L', 'PANTRY', 'Datu Puti', 'Mandaue Public Market', 'Stall S-05', 46.00),
    ('Silver Swan Soy Sauce 1L', 'PANTRY', 'Silver Swan', 'Mandaue Public Market', 'Stall S-06', 72.00),
    ('Purefoods Corned Beef 150g', 'CANNED', 'Purefoods', 'Mandaue Public Market', 'Stall S-07', 48.00),
    ('Argentina Corned Beef 150g', 'CANNED', 'Argentina', 'Mandaue Public Market', 'Stall S-08', 40.00),
    ('Century Tuna Flakes in Oil 180g', 'CANNED', 'Century Tuna', 'Mandaue Public Market', 'Stall S-09', 48.00),
    ('Mega Sardines Green 155g', 'CANNED', 'Mega', 'Mandaue Public Market', 'Stall S-10', 27.00),
    ('555 Sardines Tomato 155g', 'CANNED', '555', 'Mandaue Public Market', 'Stall S-11', 25.00),
    ('Del Monte Pineapple Juice 1L', 'BEVERAGES', 'Del Monte', 'Mandaue Public Market', 'Stall S-12', 89.00),
    ('Coca-Cola Mismo 295ml', 'BEVERAGES', 'Coca-Cola', 'Mandaue Public Market', 'Stall S-13', 18.00),
    ('Sprite Mismo 295ml', 'BEVERAGES', 'Sprite', 'Mandaue Public Market', 'Stall S-14', 18.00),
    ('C2 Green Tea Apple 355ml', 'BEVERAGES', 'C2', 'Mandaue Public Market', 'Stall S-15', 22.00),
    ('Kopiko Brown 3in1 10 Sachets', 'COFFEE', 'Kopiko', 'Mandaue Public Market', 'Stall S-16', 78.00),
    ('Nescafe Classic 50g', 'COFFEE', 'Nescafe', 'Mandaue Public Market', 'Stall S-17', 95.00),
    ('Bear Brand Powdered Milk 320g', 'DAIRY', 'Bear Brand', 'Mandaue Public Market', 'Stall S-18', 168.00),
    ('Alaska Evaporada 370ml', 'DAIRY', 'Alaska', 'Mandaue Public Market', 'Stall S-19', 38.00),
    ('Ladys Choice Mayonnaise 220ml', 'PANTRY', 'Ladys Choice', 'Mandaue Public Market', 'Stall S-20', 89.00),
    ('Magnolia Nutri Oil 1L', 'PANTRY', 'Magnolia', 'Mandaue Public Market', 'Stall S-21', 118.00),
    ('Bounty Fresh Cooking Oil 1L', 'PANTRY', 'Bounty Fresh', 'Mandaue Public Market', 'Stall S-22', 125.00),
    ('White Sugar Refined 1kg', 'PANTRY', NULL, 'Mandaue Public Market', 'Stall S-23', 86.00),
    ('Brown Sugar Washed 1kg', 'PANTRY', NULL, 'Mandaue Public Market', 'Stall S-24', 78.00),
    ('Iodized Salt Fine 1kg', 'PANTRY', NULL, 'Mandaue Public Market', 'Stall S-25', 28.00)
)
INSERT INTO products (name, category, brand_name, region, market_name, stall_name, srp_price)
SELECT
  g.name,
  g.category,
  g.brand_name,
  'Cebu City',
  g.market_name,
  g.stall_name,
  g.srp_price
FROM cebu_goods AS g
WHERE NOT EXISTS (
  SELECT 1
  FROM products AS p
  WHERE LOWER(p.name) = LOWER(g.name)
    AND LOWER(COALESCE(p.region, '')) = LOWER('Cebu City')
    AND LOWER(COALESCE(p.market_name, '')) = LOWER(g.market_name)
    AND LOWER(COALESCE(p.stall_name, '')) = LOWER(g.stall_name)
);

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
