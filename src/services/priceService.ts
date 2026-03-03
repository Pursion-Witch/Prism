import { DEFAULT_CATEGORY, DEFAULT_MARKET_NAME, DEFAULT_STALL_NAME } from '../constants/cebuDefaults';
import { query } from '../db';
import { analyzeWithDeepseek, type DeepseekAnalysis } from './deepseekService';
import { lookupAveragePriceOnline } from './onlinePriceService';
import { buildCatalogCode, upsertCatalogProductWithDb } from './productCatalogService';
import { normalizeToEnglish } from './translationService';
import { inferQuantityHint, type PriceNormalizationResult } from './unitNormalizationService';

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
  report_flag?: boolean;
  source?: string;
  raw_input?: string | null;
  price_normalization?: PriceNormalizationResult | null;
}

export interface AnalyzePriceResponse {
  name: string;
  normalized_name?: string;
  translation_source?: string;
  canonical_name?: string;
  canonical_source?: string;
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
  catalog_code: string;
  name: string;
  category: string | null;
  brand_name: string | null;
  region: string | null;
  market_name: string | null;
  stall_name: string | null;
  srp_price: number | null;
  created_at: string;
}

export interface AdminCategoryInsight {
  category: string;
  scan_count: number;
  avg_scanned_price: number | null;
  avg_srp_price: number | null;
  avg_diff_percent: number | null;
  overpriced_count: number;
  fair_count: number;
  great_deal_count: number;
  steal_count: number;
}

export type AdminAlertSeverity = 'critical' | 'high' | 'warning' | 'good';

export interface AdminAlertInsight {
  type: 'MALICIOUS_SPIKE' | 'POSSIBLE_FALSE_REPORT' | 'OVERPRICED' | 'GOOD_DEAL';
  severity: AdminAlertSeverity;
  product_name: string;
  category: string;
  market_name: string;
  stall_name: string;
  scanned_price: number;
  srp_price: number;
  difference_percent: number;
  verdict: string;
  created_at: string;
}

export interface MonthlyPriceReportRecord {
  month: string;
  scan_count: number;
  avg_scanned_price: number | null;
  avg_srp_price: number | null;
  avg_diff_percent: number | null;
  overpriced_count: number;
  deal_count: number;
  suspicious_count: number;
  status: 'good' | 'watch' | 'bad';
}

export interface AdminTrendPoint {
  label: string;
  value: number;
}

export interface AdminItemInsight {
  item_name: string;
  category: string;
  scan_count: number;
  reported_count: number;
  avg_scanned_price: number | null;
  avg_normalized_price: number | null;
  normalized_unit: string;
  avg_diff_percent: number | null;
  overpriced_count: number;
  great_deal_count: number;
}

export interface AdminAnalyticsResponse {
  totals: {
    total_products: number;
    total_scans: number;
    overpriced_reports: number;
    deal_reports: number;
    avg_diff_percent: number | null;
    reported_flags: number;
  };
  category_insights: AdminCategoryInsight[];
  item_insights: AdminItemInsight[];
  alerts: AdminAlertInsight[];
  monthly_report: MonthlyPriceReportRecord[];
  trend_points: AdminTrendPoint[];
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

function toOptionalNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Number(parsed.toFixed(2));
}

interface ProductLookupResult {
  product: ProductRow | null;
  exactRegionMatch: boolean;
}

let priceLogSchemaReadyPromise: Promise<void> | null = null;

async function ensurePriceLogSchema(): Promise<void> {
  if (!priceLogSchemaReadyPromise) {
    priceLogSchemaReadyPromise = (async () => {
      await query(`ALTER TABLE price_logs ADD COLUMN IF NOT EXISTS report_flag BOOLEAN NOT NULL DEFAULT FALSE`);
      await query(`ALTER TABLE price_logs ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'system'`);
      await query(`ALTER TABLE price_logs ADD COLUMN IF NOT EXISTS raw_input TEXT`);
      await query(`ALTER TABLE price_logs ADD COLUMN IF NOT EXISTS submitted_quantity NUMERIC NOT NULL DEFAULT 1`);
      await query(`ALTER TABLE price_logs ADD COLUMN IF NOT EXISTS submitted_unit TEXT NOT NULL DEFAULT 'piece'`);
      await query(`ALTER TABLE price_logs ADD COLUMN IF NOT EXISTS normalized_quantity NUMERIC NOT NULL DEFAULT 1`);
      await query(`ALTER TABLE price_logs ADD COLUMN IF NOT EXISTS normalized_unit TEXT NOT NULL DEFAULT 'piece'`);
      await query(`ALTER TABLE price_logs ADD COLUMN IF NOT EXISTS normalized_price NUMERIC`);
    })();
  }

  await priceLogSchemaReadyPromise;
}

function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const name of names) {
    const normalized = name.trim();
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(normalized);
  }

  return output;
}

async function findProductByNameAndRegion(names: string[], region: string): Promise<ProductLookupResult> {
  const candidates = dedupeNames(names);

  for (const name of candidates) {
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
  }

  for (const name of candidates) {
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
  }

  return {
    product: null,
    exactRegionMatch: false
  };
}

async function insertPriceLog(
  productId: string | null,
  scannedPrice: number,
  verdict: string,
  input: AnalyzePriceInput
): Promise<void> {
  await ensurePriceLogSchema();

  const normalization = input.price_normalization;
  const reportFlag = input.report_flag === true;
  const source = typeof input.source === 'string' && input.source.trim() ? input.source.trim() : 'system';
  const rawInput = typeof input.raw_input === 'string' && input.raw_input.trim() ? input.raw_input.trim() : null;
  const submittedQuantity = normalization?.submitted_quantity ?? 1;
  const submittedUnit = normalization?.submitted_unit ?? 'piece';
  const normalizedQuantity = normalization?.normalized_quantity ?? 1;
  const normalizedUnit = normalization?.normalized_unit ?? 'piece';
  const normalizedPrice = normalization?.normalized_price ?? scannedPrice;

  await query(
    `
      INSERT INTO price_logs (
        product_id,
        scanned_price,
        verdict,
        report_flag,
        source,
        raw_input,
        submitted_quantity,
        submitted_unit,
        normalized_quantity,
        normalized_unit,
        normalized_price
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `,
    [
      productId,
      scannedPrice,
      verdict,
      reportFlag,
      source,
      rawInput,
      submittedQuantity,
      submittedUnit,
      normalizedQuantity,
      normalizedUnit,
      normalizedPrice
    ]
  );
}

async function findHistoricalAveragePrice(names: string[], region: string): Promise<number | null> {
  const candidates = dedupeNames(names);

  for (const name of candidates) {
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
  }

  for (const name of candidates) {
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
  }

  return null;
}

async function findHistoricalNormalizedUnitPrice(
  names: string[],
  region: string,
  normalizedUnit: string
): Promise<number | null> {
  const candidates = dedupeNames(names);
  if (!candidates.length || !normalizedUnit) {
    return null;
  }

  for (const name of candidates) {
    const regionResult = await query<{ average_price: string | null }>(
      `
        SELECT ROUND(AVG(pl.normalized_price)::numeric, 2)::text AS average_price
        FROM price_logs pl
        JOIN products p ON p.id = pl.product_id
        WHERE LOWER(p.name) = LOWER($1)
          AND LOWER(COALESCE(p.region, '')) = LOWER($2)
          AND LOWER(COALESCE(pl.normalized_unit, '')) = LOWER($3)
          AND pl.normalized_price IS NOT NULL
      `,
      [name, region, normalizedUnit]
    );

    const regionValue = Number(regionResult.rows[0]?.average_price ?? NaN);
    if (Number.isFinite(regionValue) && regionValue > 0) {
      return Number(regionValue.toFixed(2));
    }
  }

  for (const name of candidates) {
    const fallbackResult = await query<{ average_price: string | null }>(
      `
        SELECT ROUND(AVG(pl.normalized_price)::numeric, 2)::text AS average_price
        FROM price_logs pl
        JOIN products p ON p.id = pl.product_id
        WHERE LOWER(p.name) = LOWER($1)
          AND LOWER(COALESCE(pl.normalized_unit, '')) = LOWER($2)
          AND pl.normalized_price IS NOT NULL
      `,
      [name, normalizedUnit]
    );

    const fallbackValue = Number(fallbackResult.rows[0]?.average_price ?? NaN);
    if (Number.isFinite(fallbackValue) && fallbackValue > 0) {
      return Number(fallbackValue.toFixed(2));
    }
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
      srpPrice: fairMarketValue,
      isProtected: false
    },
    { updateExisting: false }
  );

  return upsertResult.id;
}

async function enrichMissingSrpFromOnline(
  name: string,
  region: string,
  existingCategory: string | null | undefined,
  existingBrandName: string | null | undefined
): Promise<number | null> {
  const isEnabled = String(process.env.ONLINE_PRICE_LOOKUP_ENABLED ?? 'true').toLowerCase() !== 'false';
  if (!isEnabled) {
    return null;
  }

  const lookup = await lookupAveragePriceOnline(name, region);
  if (!lookup || lookup.average_price <= 0) {
    return null;
  }

  await upsertCatalogProductWithDb(
    {
      name,
      category: existingCategory ?? DEFAULT_CATEGORY,
      brandName: existingBrandName ?? null,
      region,
      marketName: 'Cebu Online Listings',
      stallName: 'Stall O-01',
      srpPrice: lookup.average_price,
      isProtected: false
    },
    { updateExisting: true }
  );

  return lookup.average_price;
}

export async function analyzePrice(input: AnalyzePriceInput): Promise<AnalyzePriceResponse> {
  const inputName = normalizeText(input.name, 'Product name');
  const region = normalizeText(input.region, 'Region');
  const scannedPrice = toOptionalScannedPrice(input.price);
  const translation = await normalizeToEnglish(inputName);
  const normalizedName = translation.english_text || inputName;
  const canonicalName = translation.canonical_english_text || normalizedName;
  const nameCandidates = dedupeNames([inputName, normalizedName, canonicalName]);
  const effectiveName = canonicalName;

  const lookup = await findProductByNameAndRegion(nameCandidates, region);
  const product = lookup.product;
  let srpPrice =
    product?.srp_price === null || product?.srp_price === undefined ? null : Number(product.srp_price);

  let onlineDiscoveredPrice: number | null = null;
  if (srpPrice === null) {
    onlineDiscoveredPrice = await enrichMissingSrpFromOnline(
      effectiveName,
      region,
      product?.category,
      product?.brand_name
    );
    if (onlineDiscoveredPrice !== null) {
      srpPrice = onlineDiscoveredPrice;
    }
  }

  if (scannedPrice === null) {
    const quantityHint = inferQuantityHint(input.raw_input ?? '', effectiveName);
    const unitPrice = await findHistoricalNormalizedUnitPrice(
      nameCandidates,
      region,
      quantityHint.normalized_unit
    );
    const quantityAdjustedFairPrice =
      unitPrice && quantityHint.normalized_quantity > 0
        ? Number((unitPrice * quantityHint.normalized_quantity).toFixed(2))
        : null;

    const inferredFairPrice = quantityAdjustedFairPrice ?? srpPrice ?? (await findHistoricalAveragePrice(nameCandidates, region));
    const fairMarketValue = inferredFairPrice ?? 0;
    const reasoning = quantityAdjustedFairPrice
      ? `No scanned price was provided. PRISM estimated package fair value using historical ${quantityHint.normalized_unit} unit pricing and detected quantity.`
      : inferredFairPrice
      ? onlineDiscoveredPrice !== null
        ? 'No scanned price was provided. PRISM used web listings to estimate the average price and stored it in the local database.'
        : 'No scanned price was provided, so PRISM used existing market records for this product.'
      : 'No scanned price was provided and there is no tracked price yet. Add a price to generate full anomaly analysis.';

    return {
      name: inputName,
      normalized_name: normalizedName,
      translation_source: translation.source,
      canonical_name: canonicalName,
      canonical_source: translation.canonical_source,
      region,
      scanned_price: 0,
      srp_price: srpPrice === null ? null : Number(srpPrice.toFixed(2)),
      verdict: 'FAIR',
      fair_market_value: fairMarketValue,
      reasoning
    };
  }

  const aiResult = await analyzeWithDeepseek({
    name: effectiveName,
    price: scannedPrice,
    region,
    srp_price: srpPrice
  });

  let productId = product?.id ?? null;
  if (!productId || !lookup.exactRegionMatch) {
    productId = await persistSubmissionAsProduct(
      {
        ...input,
        name: effectiveName,
        region
      },
      aiResult.fair_market_value
    );
  }

  await insertPriceLog(productId, scannedPrice, aiResult.verdict, input);

  return {
    name: inputName,
    normalized_name: normalizedName,
    translation_source: translation.source,
    canonical_name: canonicalName,
    canonical_source: translation.canonical_source,
    region,
    scanned_price: scannedPrice,
    srp_price: srpPrice === null ? null : Number(srpPrice.toFixed(2)),
    verdict: aiResult.verdict,
    fair_market_value: aiResult.fair_market_value,
    reasoning:
      onlineDiscoveredPrice !== null
        ? `${aiResult.reasoning} Reference price was auto-added from online listing averages.`
        : aiResult.reasoning
  };
}

export async function getAdminStats(): Promise<AdminStatsResponse> {
  await ensurePriceLogSchema();

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
    catalog_code: buildCatalogCode(row.name, row.category ?? DEFAULT_CATEGORY),
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

interface TopAnomalyRow {
  name: string;
  category: string;
  market_name: string;
  stall_name: string;
  scanned_price: string;
  srp_price: string | null;
  verdict: string;
  diff_percent: string | null;
  report_flag: string;
  created_at: string;
}

function deriveMonthlyStatus(avgDiffPercent: number | null): 'good' | 'watch' | 'bad' {
  if (avgDiffPercent === null) {
    return 'watch';
  }

  if (avgDiffPercent >= 12) {
    return 'bad';
  }

  if (avgDiffPercent >= 4) {
    return 'watch';
  }

  return 'good';
}

function deriveAlertFromAnomaly(row: TopAnomalyRow): AdminAlertInsight | null {
  const scannedPrice = Number(row.scanned_price);
  const srpPrice = Number(row.srp_price);
  const differencePercent = Number(row.diff_percent);

  if (!Number.isFinite(scannedPrice) || !Number.isFinite(srpPrice) || srpPrice <= 0 || !Number.isFinite(differencePercent)) {
    return null;
  }

  const ratio = scannedPrice / srpPrice;
  if (ratio >= 1.6) {
    return {
      type: 'MALICIOUS_SPIKE',
      severity: 'critical',
      product_name: row.name,
      category: row.category,
      market_name: row.market_name,
      stall_name: row.stall_name,
      scanned_price: Number(scannedPrice.toFixed(2)),
      srp_price: Number(srpPrice.toFixed(2)),
      difference_percent: Number(differencePercent.toFixed(2)),
      verdict: row.verdict,
      created_at: row.created_at
    };
  }

  if (ratio <= 0.5) {
    return {
      type: 'POSSIBLE_FALSE_REPORT',
      severity: 'warning',
      product_name: row.name,
      category: row.category,
      market_name: row.market_name,
      stall_name: row.stall_name,
      scanned_price: Number(scannedPrice.toFixed(2)),
      srp_price: Number(srpPrice.toFixed(2)),
      difference_percent: Number(differencePercent.toFixed(2)),
      verdict: row.verdict,
      created_at: row.created_at
    };
  }

  if (ratio >= 1.15) {
    return {
      type: 'OVERPRICED',
      severity: 'high',
      product_name: row.name,
      category: row.category,
      market_name: row.market_name,
      stall_name: row.stall_name,
      scanned_price: Number(scannedPrice.toFixed(2)),
      srp_price: Number(srpPrice.toFixed(2)),
      difference_percent: Number(differencePercent.toFixed(2)),
      verdict: row.verdict,
      created_at: row.created_at
    };
  }

  if (ratio <= 0.85) {
    return {
      type: 'GOOD_DEAL',
      severity: 'good',
      product_name: row.name,
      category: row.category,
      market_name: row.market_name,
      stall_name: row.stall_name,
      scanned_price: Number(scannedPrice.toFixed(2)),
      srp_price: Number(srpPrice.toFixed(2)),
      difference_percent: Number(differencePercent.toFixed(2)),
      verdict: row.verdict,
      created_at: row.created_at
    };
  }

  return null;
}

export async function getAdminAnalytics(): Promise<AdminAnalyticsResponse> {
  await ensurePriceLogSchema();

  const [
    totalsResult,
    categoryResult,
    anomalyResult,
    monthlyResult,
    itemResult
  ] = await Promise.all([
    query<{
      total_products: string;
      total_scans: string;
      overpriced_reports: string;
      deal_reports: string;
      avg_diff_percent: string | null;
      reported_flags: string;
    }>(
      `
        SELECT
          (SELECT COUNT(*)::text FROM products) AS total_products,
          (SELECT COUNT(*)::text FROM price_logs) AS total_scans,
          (SELECT COUNT(*)::text FROM price_logs WHERE verdict = 'OVERPRICED') AS overpriced_reports,
          (SELECT COUNT(*)::text FROM price_logs WHERE verdict IN ('GREAT DEAL', 'STEAL')) AS deal_reports,
          (SELECT COUNT(*)::text FROM price_logs WHERE report_flag = TRUE) AS reported_flags,
          (
            SELECT ROUND(
              AVG(
                CASE
                  WHEN p.srp_price > 0 THEN ((pl.scanned_price - p.srp_price) / p.srp_price) * 100
                  ELSE NULL
                END
              )::numeric,
              2
            )::text
            FROM price_logs pl
            LEFT JOIN products p ON p.id = pl.product_id
          ) AS avg_diff_percent
      `
    ),
    query<{
      category: string;
      scan_count: string;
      avg_scanned_price: string | null;
      avg_srp_price: string | null;
      avg_diff_percent: string | null;
      overpriced_count: string;
      fair_count: string;
      great_deal_count: string;
      steal_count: string;
    }>(
      `
        SELECT
          COALESCE(p.category, 'GENERAL') AS category,
          COUNT(*)::text AS scan_count,
          ROUND(AVG(pl.scanned_price)::numeric, 2)::text AS avg_scanned_price,
          ROUND(AVG(p.srp_price)::numeric, 2)::text AS avg_srp_price,
          ROUND(
            AVG(
              CASE
                WHEN p.srp_price > 0 THEN ((pl.scanned_price - p.srp_price) / p.srp_price) * 100
                ELSE NULL
              END
            )::numeric,
            2
          )::text AS avg_diff_percent,
          SUM(CASE WHEN pl.verdict = 'OVERPRICED' THEN 1 ELSE 0 END)::text AS overpriced_count,
          SUM(CASE WHEN pl.verdict = 'FAIR' THEN 1 ELSE 0 END)::text AS fair_count,
          SUM(CASE WHEN pl.verdict = 'GREAT DEAL' THEN 1 ELSE 0 END)::text AS great_deal_count,
          SUM(CASE WHEN pl.verdict = 'STEAL' THEN 1 ELSE 0 END)::text AS steal_count
        FROM price_logs pl
        LEFT JOIN products p ON p.id = pl.product_id
        GROUP BY COALESCE(p.category, 'GENERAL')
        ORDER BY COUNT(*) DESC
        LIMIT 12
      `
    ),
    query<TopAnomalyRow>(
      `
        SELECT
          COALESCE(p.name, 'Unknown Item') AS name,
          COALESCE(p.category, 'GENERAL') AS category,
          COALESCE(p.market_name, 'Unknown Market') AS market_name,
          COALESCE(p.stall_name, 'Unknown Stall') AS stall_name,
          pl.scanned_price::text AS scanned_price,
          p.srp_price::text AS srp_price,
          pl.verdict AS verdict,
          ROUND(
            CASE
              WHEN p.srp_price > 0 THEN ((pl.scanned_price - p.srp_price) / p.srp_price) * 100
              ELSE NULL
            END::numeric,
            2
          )::text AS diff_percent,
          COALESCE(pl.report_flag, FALSE)::text AS report_flag,
          pl.created_at::text AS created_at
        FROM price_logs pl
        LEFT JOIN products p ON p.id = pl.product_id
        ORDER BY
          COALESCE(pl.report_flag, FALSE) DESC,
          ABS(COALESCE((pl.scanned_price - p.srp_price) / NULLIF(p.srp_price, 0), 0)) DESC,
          pl.created_at DESC
        LIMIT 30
      `
    ),
    query<{
      month: string;
      scan_count: string;
      avg_scanned_price: string | null;
      avg_srp_price: string | null;
      avg_diff_percent: string | null;
      overpriced_count: string;
      deal_count: string;
      suspicious_count: string;
    }>(
      `
        SELECT
          TO_CHAR(DATE_TRUNC('month', pl.created_at), 'YYYY-MM') AS month,
          COUNT(*)::text AS scan_count,
          ROUND(AVG(pl.scanned_price)::numeric, 2)::text AS avg_scanned_price,
          ROUND(AVG(p.srp_price)::numeric, 2)::text AS avg_srp_price,
          ROUND(
            AVG(
              CASE
                WHEN p.srp_price > 0 THEN ((pl.scanned_price - p.srp_price) / p.srp_price) * 100
                ELSE NULL
              END
            )::numeric,
            2
          )::text AS avg_diff_percent,
          SUM(CASE WHEN pl.verdict = 'OVERPRICED' THEN 1 ELSE 0 END)::text AS overpriced_count,
          SUM(CASE WHEN pl.verdict IN ('GREAT DEAL', 'STEAL') THEN 1 ELSE 0 END)::text AS deal_count,
          SUM(
            CASE
              WHEN p.srp_price > 0
                AND ((pl.scanned_price / p.srp_price) >= 1.6 OR (pl.scanned_price / p.srp_price) <= 0.5)
              THEN 1
              ELSE 0
            END
          )::text AS suspicious_count
        FROM price_logs pl
        LEFT JOIN products p ON p.id = pl.product_id
        GROUP BY DATE_TRUNC('month', pl.created_at)
        ORDER BY DATE_TRUNC('month', pl.created_at) DESC
        LIMIT 12
      `
    ),
    query<{
      item_name: string;
      category: string;
      scan_count: string;
      reported_count: string;
      avg_scanned_price: string | null;
      avg_normalized_price: string | null;
      normalized_unit: string;
      avg_diff_percent: string | null;
      overpriced_count: string;
      great_deal_count: string;
    }>(
      `
        SELECT
          COALESCE(p.name, 'Unknown Item') AS item_name,
          COALESCE(p.category, 'GENERAL') AS category,
          COUNT(*)::text AS scan_count,
          SUM(CASE WHEN COALESCE(pl.report_flag, FALSE) THEN 1 ELSE 0 END)::text AS reported_count,
          ROUND(AVG(pl.scanned_price)::numeric, 2)::text AS avg_scanned_price,
          ROUND(AVG(COALESCE(pl.normalized_price, pl.scanned_price))::numeric, 2)::text AS avg_normalized_price,
          COALESCE(
            NULLIF(MAX(CASE WHEN pl.normalized_unit IS NOT NULL AND pl.normalized_unit <> '' THEN pl.normalized_unit END), ''),
            'piece'
          ) AS normalized_unit,
          ROUND(
            AVG(
              CASE
                WHEN p.srp_price > 0 THEN ((pl.scanned_price - p.srp_price) / p.srp_price) * 100
                ELSE NULL
              END
            )::numeric,
            2
          )::text AS avg_diff_percent,
          SUM(CASE WHEN pl.verdict = 'OVERPRICED' THEN 1 ELSE 0 END)::text AS overpriced_count,
          SUM(CASE WHEN pl.verdict IN ('GREAT DEAL', 'STEAL') THEN 1 ELSE 0 END)::text AS great_deal_count
        FROM price_logs pl
        LEFT JOIN products p ON p.id = pl.product_id
        GROUP BY COALESCE(p.name, 'Unknown Item'), COALESCE(p.category, 'GENERAL')
        ORDER BY COUNT(*) DESC, COALESCE(p.name, 'Unknown Item') ASC
        LIMIT 50
      `
    )
  ]);

  const totalsRow = totalsResult.rows[0];
  const categoryInsights: AdminCategoryInsight[] = categoryResult.rows.map((row) => ({
    category: row.category,
    scan_count: Number(row.scan_count),
    avg_scanned_price: toOptionalNumber(row.avg_scanned_price),
    avg_srp_price: toOptionalNumber(row.avg_srp_price),
    avg_diff_percent: toOptionalNumber(row.avg_diff_percent),
    overpriced_count: Number(row.overpriced_count),
    fair_count: Number(row.fair_count),
    great_deal_count: Number(row.great_deal_count),
    steal_count: Number(row.steal_count)
  }));

  const alerts = anomalyResult.rows
    .map((row) => deriveAlertFromAnomaly(row))
    .filter((row): row is AdminAlertInsight => Boolean(row))
    .slice(0, 12);

  const monthlyReport: MonthlyPriceReportRecord[] = monthlyResult.rows.map((row) => {
    const avgDiffPercent = toOptionalNumber(row.avg_diff_percent);
    return {
      month: row.month,
      scan_count: Number(row.scan_count),
      avg_scanned_price: toOptionalNumber(row.avg_scanned_price),
      avg_srp_price: toOptionalNumber(row.avg_srp_price),
      avg_diff_percent: avgDiffPercent,
      overpriced_count: Number(row.overpriced_count),
      deal_count: Number(row.deal_count),
      suspicious_count: Number(row.suspicious_count),
      status: deriveMonthlyStatus(avgDiffPercent)
    };
  });

  const trendPoints: AdminTrendPoint[] = monthlyReport
    .slice()
    .reverse()
    .map((row) => ({
      label: row.month,
      value: row.avg_diff_percent ?? 0
    }));

  const itemInsights: AdminItemInsight[] = itemResult.rows.map((row) => ({
    item_name: row.item_name,
    category: row.category,
    scan_count: Number(row.scan_count),
    reported_count: Number(row.reported_count),
    avg_scanned_price: toOptionalNumber(row.avg_scanned_price),
    avg_normalized_price: toOptionalNumber(row.avg_normalized_price),
    normalized_unit: row.normalized_unit || 'piece',
    avg_diff_percent: toOptionalNumber(row.avg_diff_percent),
    overpriced_count: Number(row.overpriced_count),
    great_deal_count: Number(row.great_deal_count)
  }));

  return {
    totals: {
      total_products: Number(totalsRow?.total_products ?? 0),
      total_scans: Number(totalsRow?.total_scans ?? 0),
      overpriced_reports: Number(totalsRow?.overpriced_reports ?? 0),
      deal_reports: Number(totalsRow?.deal_reports ?? 0),
      avg_diff_percent: toOptionalNumber(totalsRow?.avg_diff_percent ?? null),
      reported_flags: Number(totalsRow?.reported_flags ?? 0)
    },
    category_insights: categoryInsights,
    item_insights: itemInsights,
    alerts,
    monthly_report: monthlyReport,
    trend_points: trendPoints
  };
}
