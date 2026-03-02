import type { PoolClient } from 'pg';
import { withDbClient } from '../db';
import {
  DEFAULT_CATEGORY,
  DEFAULT_MARKET_NAME,
  DEFAULT_REGION,
  DEFAULT_STALL_NAME
} from '../constants/cebuDefaults';

type QueryClient = Pick<PoolClient, 'query'>;

export interface ProductCatalogInput {
  name: string;
  category?: string | null;
  brandName?: string | null;
  region?: string | null;
  marketName?: string | null;
  stallName?: string | null;
  srpPrice?: number | null;
}

export interface NormalizedProductCatalogInput {
  name: string;
  category: string;
  brandName: string | null;
  region: string;
  marketName: string;
  stallName: string;
  srpPrice: number | null;
}

export interface UpsertCatalogProductOptions {
  updateExisting?: boolean;
}

export interface UpsertCatalogProductResult {
  id: string;
  action: 'inserted' | 'updated' | 'unchanged';
  product: NormalizedProductCatalogInput;
}

interface ProductIdRow {
  id: string;
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

function normalizeOptionalText(value: string | null | undefined, fallbackValue: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallbackValue;
}

function normalizeOptionalNullableText(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function normalizeOptionalPrice(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Please provide a valid positive price.');
  }

  return Number(parsed.toFixed(2));
}

export function normalizeCatalogInput(input: ProductCatalogInput): NormalizedProductCatalogInput {
  return {
    name: normalizeRequiredText(input.name, 'Product name'),
    category: normalizeOptionalText(input.category, DEFAULT_CATEGORY),
    brandName: normalizeOptionalNullableText(input.brandName),
    region: normalizeOptionalText(input.region, DEFAULT_REGION),
    marketName: normalizeOptionalText(input.marketName, DEFAULT_MARKET_NAME),
    stallName: normalizeOptionalText(input.stallName, DEFAULT_STALL_NAME),
    srpPrice: normalizeOptionalPrice(input.srpPrice)
  };
}

export async function upsertCatalogProduct(
  client: QueryClient,
  input: ProductCatalogInput,
  options: UpsertCatalogProductOptions = {}
): Promise<UpsertCatalogProductResult> {
  const normalized = normalizeCatalogInput(input);
  const shouldUpdate = options.updateExisting !== false;

  const existingResult = await client.query<ProductIdRow>(
    `
      SELECT id
      FROM products
      WHERE LOWER(name) = LOWER($1)
        AND LOWER(COALESCE(region, '')) = LOWER($2)
        AND LOWER(COALESCE(market_name, '')) = LOWER($3)
        AND LOWER(COALESCE(stall_name, '')) = LOWER($4)
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [normalized.name, normalized.region, normalized.marketName, normalized.stallName]
  );

  if (existingResult.rowCount && existingResult.rows[0]) {
    if (shouldUpdate) {
      await client.query(
        `
          UPDATE products
          SET category = $1,
              brand_name = $2,
              region = $3,
              market_name = $4,
              stall_name = $5,
              srp_price = COALESCE($6, srp_price)
          WHERE id = $7
        `,
        [
          normalized.category,
          normalized.brandName,
          normalized.region,
          normalized.marketName,
          normalized.stallName,
          normalized.srpPrice,
          existingResult.rows[0].id
        ]
      );

      return {
        id: existingResult.rows[0].id,
        action: 'updated',
        product: normalized
      };
    }

    return {
      id: existingResult.rows[0].id,
      action: 'unchanged',
      product: normalized
    };
  }

  const insertResult = await client.query<ProductIdRow>(
    `
      INSERT INTO products (name, category, brand_name, region, market_name, stall_name, srp_price)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `,
    [
      normalized.name,
      normalized.category,
      normalized.brandName,
      normalized.region,
      normalized.marketName,
      normalized.stallName,
      normalized.srpPrice
    ]
  );

  if (!insertResult.rows[0]) {
    throw new Error('Failed to insert product.');
  }

  return {
    id: insertResult.rows[0].id,
    action: 'inserted',
    product: normalized
  };
}

export async function upsertCatalogProductWithDb(
  input: ProductCatalogInput,
  options: UpsertCatalogProductOptions = {}
): Promise<UpsertCatalogProductResult> {
  return withDbClient(async (client) => upsertCatalogProduct(client, input, options));
}
