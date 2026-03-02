import { query, withTransaction } from '../index';
import type {
  MarketIndexRow,
  PriceAnalysisHistoryRow,
  PriceProductRow,
  PriceTransactionRow
} from '../types';

interface AvgPriceRow {
  avg_price: string | null;
}

export interface RecordPriceAnalysisInput {
  name: string;
  category: string;
  fairValue: number;
  price: number;
  region: string;
  anomalyScore: number;
  source: string;
  rawText?: string;
}

export interface RecordPriceAnalysisResult {
  product: PriceProductRow;
  transaction: PriceTransactionRow;
}

function normalizeProductName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function clampLimit(limit: number, fallback: number, max: number): number {
  if (!Number.isFinite(limit)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.floor(limit)));
}

export async function getHistoricalAveragePrice(productName: string): Promise<number | null> {
  const normalizedName = normalizeProductName(productName);
  if (!normalizedName) {
    return null;
  }

  const result = await query<AvgPriceRow>(
    `
      SELECT ROUND(AVG(t.price)::numeric, 2) AS avg_price
      FROM price_transactions t
      INNER JOIN price_products p ON p.id = t.product_id
      WHERE LOWER(TRIM(p.name)) = $1
    `,
    [normalizedName]
  );

  const value = result.rows[0]?.avg_price;
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : null;
}

export async function recordPriceAnalysis(input: RecordPriceAnalysisInput): Promise<RecordPriceAnalysisResult> {
  return withTransaction(async (client) => {
    const productResult = await client.query<PriceProductRow>(
      `
        INSERT INTO price_products (name, category, avg_market_price, last_updated)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (name)
        DO UPDATE
          SET category = EXCLUDED.category,
              avg_market_price = EXCLUDED.avg_market_price,
              last_updated = NOW()
        RETURNING id, name, category, avg_market_price, last_updated, created_at
      `,
      [input.name.trim(), input.category.trim(), input.fairValue]
    );

    const product = productResult.rows[0];

    const transactionResult = await client.query<PriceTransactionRow>(
      `
        INSERT INTO price_transactions (product_id, price, region, anomaly_score, source, raw_text)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, product_id, price, region, anomaly_score, source, raw_text, created_at
      `,
      [product.id, input.price, input.region, input.anomalyScore, input.source, input.rawText ?? null]
    );

    return {
      product,
      transaction: transactionResult.rows[0]
    };
  });
}

export async function listAnalysisHistory(limit = 20): Promise<PriceAnalysisHistoryRow[]> {
  const safeLimit = clampLimit(limit, 20, 200);
  const result = await query<PriceAnalysisHistoryRow>(
    `
      SELECT
        t.id,
        t.product_id,
        p.name AS product_name,
        p.category,
        t.price,
        p.avg_market_price AS fair_value,
        t.region,
        t.anomaly_score,
        t.source,
        t.raw_text,
        t.created_at
      FROM price_transactions t
      INNER JOIN price_products p ON p.id = t.product_id
      ORDER BY t.created_at DESC
      LIMIT $1
    `,
    [safeLimit]
  );

  return result.rows;
}

export async function listMarketIndex(limit = 12): Promise<MarketIndexRow[]> {
  const safeLimit = clampLimit(limit, 12, 50);
  const result = await query<MarketIndexRow>(
    `
      SELECT
        p.category,
        COUNT(t.id)::INT AS sample_count,
        ROUND(AVG(t.price)::numeric, 2) AS avg_observed_price,
        ROUND(AVG(p.avg_market_price)::numeric, 2) AS avg_fair_value,
        MAX(t.created_at) AS last_updated
      FROM price_transactions t
      INNER JOIN price_products p ON p.id = t.product_id
      GROUP BY p.category
      ORDER BY MAX(t.created_at) DESC
      LIMIT $1
    `,
    [safeLimit]
  );

  return result.rows;
}
