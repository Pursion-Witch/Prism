import type { Request, Response } from 'express';
import { createProduct } from '../db/queries/products';
import { AppError } from '../errors/app-error';
import { requireFiniteNumber, requireNonEmptyString } from '../utils/validation';

export async function createProductHandler(req: Request, res: Response): Promise<void> {
  const payload = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;

  const name = requireNonEmptyString(payload.name, 'name');
  const sellerId = requireNonEmptyString(payload.seller_id, 'seller_id');
  const price = requireFiniteNumber(payload.price, 'price');

  if (price < 0) {
    throw new AppError(400, '"price" must be greater than or equal to 0.');
  }

  const product = await createProduct({
    name,
    sellerId,
    price
  });

  res.status(201).json({
    id: product.id,
    name: product.name,
    price: Number(product.price),
    seller_id: product.seller_id,
    created_at: product.created_at.toISOString(),
    updated_at: product.updated_at.toISOString()
  });
}
