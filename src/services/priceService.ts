import { query } from '../db';
import { analyzeWithDeepseek, type DeepseekAnalysis } from './deepseekiService';

interface ProductRow {
  id: string;
  name: string;
  category: string | null;
  region: string | null;
  srp_price: string | number | null;
}

interface AnalyzePriceInput {
  name: string;
  price: number;
  region: string;
}

export interface AnalyzePriceResponse {
  name: string;
  region: string;
  scanned_price: number;
  srp_price: number | null;
  verdict: DeepseekAnalysis['verdict'];
  fair_market_value: number;
  reasoning: string;
}

export interface AdminStatsResponse {
  total_scans: number;
  most_overpriced_category: string | null;
  average_regional_price: Array<{ region: string; average_price: number }>;
}

export interface AdminProductRecord {
  id: string;
  name: string;
  category: string | null;
  region: string | null;
  srp_price: number | null;
  created_at: string;
}

function toNonNegativeNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('Price must be a non-negative number.');
  }

  return Number(parsed.toFixed(2));
}

function normalizeText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

async function findProductByNameAndRegion(name: string, region: string): Promise<ProductRow | null> {
  const exactMatch = await query<ProductRow>(
    `
      SELECT id, name, category, region, srp_price
      FROM products
      WHERE LOWER(name) = LOWER($1)
        AND LOWER(region) = LOWER($2)
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [name, region]
  );

  if (exactMatch.rowCount && exactMatch.rows[0]) {
    return exactMatch.rows[0];
  }

  const fallbackMatch = await query<ProductRow>(
    `
      SELECT id, name, category, region, srp_price
      FROM products
      WHERE LOWER(name) = LOWER($1)
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [name]
  );

  if (fallbackMatch.rowCount && fallbackMatch.rows[0]) {
    return fallbackMatch.rows[0];
  }

  return null;
}

async function insertPriceLog(productId: string | null, scannedPrice: number, verdict: string): Promise<void> {
  await query(
    `
      INSERT INTO price_logs (product_id, scanned_price, verdict)
      VALUES ($1, $2, $3)
    `,
    [productId, scannedPrice, verdict]
  );
}

export async function analyzePrice(input: AnalyzePriceInput): Promise<AnalyzePriceResponse> {
  const name = normalizeText(input.name, 'Product name');
  const region = normalizeText(input.region, 'Region');
  const scannedPrice = toNonNegativeNumber(input.price);

  const product = await findProductByNameAndRegion(name, region);
  const srpPrice = product?.srp_price === null || product?.srp_price === undefined
    ? null
    : Number(product.srp_price);

  const aiResult = await analyzeWithDeepseek({
    name,
    price: scannedPrice,
    region,
    srp_price: srpPrice
  });

  await insertPriceLog(product?.id ?? null, scannedPrice, aiResult.verdict);

  return {
    name,
    region,
    scanned_price: scannedPrice,
    srp_price: srpPrice === null ? null : Number(srpPrice.toFixed(2)),
    verdict: aiResult.verdict,
    fair_market_value: aiResult.fair_market_value,
    reasoning: aiResult.reasoning
  };
}

export async function getAdminStats(): Promise<AdminStatsResponse> {
  const [totalScansResult, overpricedCategoryResult, regionalAverageResult] = await Promise.all([
    query<{ count: string }>('SELECT COUNT(*)::text AS count FROM price_logs'),
    query<{ category: string | null }>(
      `
        SELECT COALESCE(p.category, 'UNCATEGORIZED') AS category
        FROM price_logs pl
        LEFT JOIN products p ON p.id = pl.product_id
        WHERE pl.verdict = 'OVERPRICED'
        GROUP BY COALESCE(p.category, 'UNCATEGORIZED')
        ORDER BY COUNT(*) DESC
        LIMIT 1
      `
    ),
    query<{ region: string | null; average_price: string }>(
      `
        SELECT
          COALESCE(p.region, 'UNKNOWN') AS region,
          ROUND(AVG(pl.scanned_price)::numeric, 2)::text AS average_price
        FROM price_logs pl
        LEFT JOIN products p ON p.id = pl.product_id
        GROUP BY COALESCE(p.region, 'UNKNOWN')
        ORDER BY COALESCE(p.region, 'UNKNOWN') ASC
      `
    )
  ]);

  return {
    total_scans: Number(totalScansResult.rows[0]?.count ?? 0),
    most_overpriced_category: overpricedCategoryResult.rows[0]?.category ?? null,
    average_regional_price: regionalAverageResult.rows.map((row) => ({
      region: row.region ?? 'UNKNOWN',
      average_price: Number(row.average_price)
    }))
  };
}

export async function getAllTrackedProducts(): Promise<AdminProductRecord[]> {
  const result = await query<ProductRow & { created_at: string }>(
    `
      SELECT id, name, category, region, srp_price, created_at
      FROM products
      ORDER BY created_at DESC
    `
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    region: row.region,
    srp_price:
      row.srp_price === null || row.srp_price === undefined ? null : Number(Number(row.srp_price).toFixed(2)),
    created_at: row.created_at
  }));
}
