import { DEFAULT_CATEGORY, DEFAULT_MARKET_NAME, DEFAULT_STALL_NAME } from '../constants/cebuDefaults';
import { query } from '../db';
import { analyzeWithDeepseek, type DeepseekAnalysis } from './deepseekiService';
import { upsertCatalogProductWithDb } from './productCatalogService';

interface ProductRow {
  id: string;
  name: string;
  category: string | null;
  region: string | null;
  srp_price: string | number | null;
  brand_name?: string | null;
  market_name?: string | null;
  stall_name?: string | null;
}

interface AnalyzePriceInput {
  name: string;
  price?: number | null;
  region: string;
  category?: string | null;
  brand_name?: string | null;
  market_name?: string | null;
  stall_name?: string | null;
  persist_submission?: boolean;
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
  brand_name: string | null;
  region: string | null;
  market_name: string | null;
  stall_name: string | null;
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

function toOptionalScannedPrice(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = toNonNegativeNumber(value);
  if (parsed === 0) {
    return null;
  }

  return parsed;
}

function normalizeText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

interface ProductLookupResult {
  product: ProductRow | null;
  exactRegionMatch: boolean;
}

async function findProductByNameAndRegion(name: string, region: string): Promise<ProductLookupResult> {
  const exactMatch = await query<ProductRow>(
    `
      SELECT id, name, category, region, srp_price, brand_name, market_name, stall_name
      FROM products
      WHERE LOWER(name) = LOWER($1)
        AND LOWER(region) = LOWER($2)
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [name, region]
  );

  if (exactMatch.rowCount && exactMatch.rows[0]) {
    return {
      product: exactMatch.rows[0],
      exactRegionMatch: true
    };
  }

  const fallbackMatch = await query<ProductRow>(
    `
      SELECT id, name, category, region, srp_price, brand_name, market_name, stall_name
      FROM products
      WHERE LOWER(name) = LOWER($1)
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [name]
  );

  if (fallbackMatch.rowCount && fallbackMatch.rows[0]) {
    return {
      product: fallbackMatch.rows[0],
      exactRegionMatch: false
    };
  }

  return {
    product: null,
    exactRegionMatch: false
  };
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

async function findHistoricalAveragePrice(name: string, region: string): Promise<number | null> {
  const srpByRegion = await query<{ average_price: string | null }>(
    `
      SELECT ROUND(AVG(p.srp_price)::numeric, 2)::text AS average_price
      FROM products p
      WHERE LOWER(p.name) = LOWER($1)
        AND LOWER(COALESCE(p.region, '')) = LOWER($2)
        AND p.srp_price IS NOT NULL
    `,
    [name, region]
  );

  const regionValue = Number(srpByRegion.rows[0]?.average_price ?? NaN);
  if (Number.isFinite(regionValue) && regionValue > 0) {
    return Number(regionValue.toFixed(2));
  }

  const srpFallback = await query<{ average_price: string | null }>(
    `
      SELECT ROUND(AVG(p.srp_price)::numeric, 2)::text AS average_price
      FROM products p
      WHERE LOWER(p.name) = LOWER($1)
        AND p.srp_price IS NOT NULL
    `,
    [name]
  );

  const fallbackValue = Number(srpFallback.rows[0]?.average_price ?? NaN);
  if (Number.isFinite(fallbackValue) && fallbackValue > 0) {
    return Number(fallbackValue.toFixed(2));
  }

  return null;
}

async function persistSubmissionAsProduct(
  input: AnalyzePriceInput,
  fairMarketValue: number
): Promise<string | null> {
  if (input.persist_submission === false) {
    return null;
  }

  const upsertResult = await upsertCatalogProductWithDb(
    {
      name: input.name,
      category: input.category ?? DEFAULT_CATEGORY,
      brandName: input.brand_name ?? null,
      region: input.region,
      marketName: input.market_name ?? DEFAULT_MARKET_NAME,
      stallName: input.stall_name ?? DEFAULT_STALL_NAME,
      srpPrice: fairMarketValue
    },
    { updateExisting: false }
  );

  return upsertResult.id;
}

export async function analyzePrice(input: AnalyzePriceInput): Promise<AnalyzePriceResponse> {
  const name = normalizeText(input.name, 'Product name');
  const region = normalizeText(input.region, 'Region');
  const scannedPrice = toOptionalScannedPrice(input.price);

  const lookup = await findProductByNameAndRegion(name, region);
  const product = lookup.product;
  const srpPrice =
    product?.srp_price === null || product?.srp_price === undefined ? null : Number(product.srp_price);

  if (scannedPrice === null) {
    const inferredFairPrice = srpPrice ?? (await findHistoricalAveragePrice(name, region));
    const fairMarketValue = inferredFairPrice ?? 0;
    const reasoning = inferredFairPrice
      ? 'No scanned price was provided, so PRISM used existing market records for this product.'
      : 'No scanned price was provided and there is no tracked price yet. Add a price to generate full anomaly analysis.';

    return {
      name,
      region,
      scanned_price: 0,
      srp_price: srpPrice === null ? null : Number(srpPrice.toFixed(2)),
      verdict: 'FAIR',
      fair_market_value: fairMarketValue,
      reasoning
    };
  }

  const aiResult = await analyzeWithDeepseek({
    name,
    price: scannedPrice,
    region,
    srp_price: srpPrice
  });

  let productId = product?.id ?? null;
  if (!productId || !lookup.exactRegionMatch) {
    productId = await persistSubmissionAsProduct(
      {
        ...input,
        name,
        region
      },
      aiResult.fair_market_value
    );
  }

  await insertPriceLog(productId, scannedPrice, aiResult.verdict);

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
      SELECT id, name, category, brand_name, region, market_name, stall_name, srp_price, created_at
      FROM products
      ORDER BY created_at DESC
    `
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    brand_name: row.brand_name ?? null,
    region: row.region,
    market_name: row.market_name ?? null,
    stall_name: row.stall_name ?? null,
    srp_price:
      row.srp_price === null || row.srp_price === undefined ? null : Number(Number(row.srp_price).toFixed(2)),
    created_at: row.created_at
  }));
}
