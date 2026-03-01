import { randomUUID } from 'node:crypto';
import { query } from '../index';
import type { CreateProductInput, ProductRow } from '../types';

interface ListProductsOptions {
  limit?: number;
  offset?: number;
}

export async function listProducts(options: ListProductsOptions = {}): Promise<ProductRow[]> {
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(200, Number(options.limit))) : 50;
  const offset = Number.isFinite(options.offset) ? Math.max(0, Number(options.offset)) : 0;

  const result = await query<ProductRow>(
    `
      SELECT id, name, price, seller_id, created_at, updated_at
      FROM products
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `,
    [limit, offset]
  );

  return result.rows;
}

export async function createProduct(input: CreateProductInput): Promise<ProductRow> {
  const id = input.id ?? randomUUID();
  const createdAt = input.createdAt ?? new Date();

  const result = await query<ProductRow>(
    `
      INSERT INTO products (id, name, price, seller_id, created_at)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, price, seller_id, created_at, updated_at
    `,
    [id, input.name, input.price, input.sellerId, createdAt]
  );

  return result.rows[0];
}
