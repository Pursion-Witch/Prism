import { Router, type NextFunction, type Request, type Response } from 'express';
import { query } from '../db';
import { getAdminStats, getAllTrackedProducts } from '../services/priceService';

interface OverrideRequestBody {
  name?: unknown;
  price?: unknown;
}

const router = Router();

router.post('/override', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, price } = req.body as OverrideRequestBody;
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const parsedPrice = typeof price === 'number' ? price : Number(price);

    if (!normalizedName || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      return res.status(400).json({
        message: 'Please provide a valid product name and positive override price.'
      });
    }

    const productResult = await query<{ id: string }>(
      `
        SELECT id
        FROM products
        WHERE LOWER(name) = LOWER($1)
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [normalizedName]
    );

    if (productResult.rowCount && productResult.rows[0]) {
      await query(
        `
          UPDATE products
          SET srp_price = $1
          WHERE id = $2
        `,
        [parsedPrice, productResult.rows[0].id]
      );
    } else {
      await query(
        `
          INSERT INTO products (name, category, region, srp_price)
          VALUES ($1, 'UNCATEGORIZED', 'UNKNOWN', $2)
        `,
        [normalizedName, parsedPrice]
      );
    }

    return res.json({
      name: normalizedName,
      price: Number(parsedPrice.toFixed(2)),
      message: 'Admin override updated.'
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await getAdminStats();
    return res.json(stats);
  } catch (error) {
    return next(error);
  }
});

router.get('/products', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const products = await getAllTrackedProducts();
    return res.json(products);
  } catch (error) {
    return next(error);
  }
});

export default router;
