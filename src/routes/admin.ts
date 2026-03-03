import multer, { MulterError } from 'multer';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { withDbClient } from '../db';
import {
  DEFAULT_CATEGORY,
  DEFAULT_MARKET_NAME,
  DEFAULT_REGION,
  DEFAULT_STALL_NAME
} from '../constants/cebuDefaults';
import { ingestDocument } from '../services/documentIngestionService';
import { getAdminAnalytics, getAdminStats, getAllTrackedProducts } from '../services/priceService';
import { ensureProductCatalogSchema, upsertCatalogProductWithDb } from '../services/productCatalogService';

interface OverrideRequestBody {
  name?: unknown;
  price?: unknown;
}

interface ManualProductRequestBody {
  name?: unknown;
  category?: unknown;
  brand_name?: unknown;
  region?: unknown;
  market_name?: unknown;
  stall_name?: unknown;
  srp_price?: unknown;
  price?: unknown;
}

const MAX_DOCUMENT_SIZE_BYTES = 3 * 1024 * 1024;
const INVALID_DOCUMENT_TYPE = 'INVALID_DOCUMENT_TYPE';
const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  'text/plain',
  'text/csv',
  'application/csv',
  'application/json',
  'text/json',
  'application/octet-stream',
  'text/markdown'
]);

const uploadDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES },
  fileFilter: (_req, file, callback) => {
    const mimeType = file.mimetype.toLowerCase();
    const extension = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    const validExtension = ['txt', 'csv', 'json', 'md'].includes(extension);

    if (!ALLOWED_DOCUMENT_MIME_TYPES.has(mimeType) && !validExtension) {
      callback(new Error(INVALID_DOCUMENT_TYPE));
      return;
    }

    callback(null, true);
  }
});

function normalizeRequiredText(value: unknown, fieldName: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }

  return normalized;
}

function normalizeOptionalText(value: unknown, fallbackValue: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallbackValue;
}

function normalizeOptionalNullableText(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function parsePositivePrice(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Please provide a valid positive price.');
  }

  return Number(parsed.toFixed(2));
}

function getUploadErrorMessage(error: unknown): string {
  if (error instanceof MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return 'Document is too large. Maximum upload size is 3MB.';
    }

    return 'Invalid document upload.';
  }

  if (error instanceof Error && error.message === INVALID_DOCUMENT_TYPE) {
    return 'Only txt, csv, json, or md documents are allowed.';
  }

  return 'Invalid document upload.';
}

const router = Router();

router.post('/override', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, price } = req.body as OverrideRequestBody;
    const normalizedName = normalizeRequiredText(name, 'Product name');
    const parsedPrice = parsePositivePrice(price);

    await upsertCatalogProductWithDb(
      {
        name: normalizedName,
        category: DEFAULT_CATEGORY,
        brandName: null,
        region: DEFAULT_REGION,
        marketName: DEFAULT_MARKET_NAME,
        stallName: DEFAULT_STALL_NAME,
        srpPrice: parsedPrice,
        isProtected: false
      },
      { updateExisting: true }
    );

    return res.json({
      name: normalizedName,
      price: parsedPrice,
      message: 'Admin override updated.'
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/products/manual', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as ManualProductRequestBody;

    const result = await upsertCatalogProductWithDb(
      {
        name: normalizeRequiredText(body.name, 'Product name'),
        category: normalizeOptionalText(body.category, DEFAULT_CATEGORY),
        brandName: normalizeOptionalNullableText(body.brand_name),
        region: normalizeOptionalText(body.region, DEFAULT_REGION),
        marketName: normalizeOptionalText(body.market_name, DEFAULT_MARKET_NAME),
        stallName: normalizeOptionalText(body.stall_name, DEFAULT_STALL_NAME),
        srpPrice: parsePositivePrice(body.srp_price ?? body.price),
        isProtected: false
      },
      { updateExisting: true }
    );

    return res.status(result.action === 'inserted' ? 201 : 200).json({
      message: result.action === 'inserted' ? 'Product added.' : 'Product updated.',
      action: result.action,
      product: {
        catalog_code: result.product.catalogCode,
        name: result.product.name,
        category: result.product.category,
        brand_name: result.product.brandName,
        region: result.product.region,
        market_name: result.product.marketName,
        stall_name: result.product.stallName,
        srp_price: result.product.srpPrice
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/products/import', (req: Request, res: Response, next: NextFunction) => {
  uploadDocument.single('document')(req, res, async (uploadError: unknown) => {
    if (uploadError) {
      return res.status(400).json({ message: getUploadErrorMessage(uploadError) });
    }

    try {
      if (!req.file || !req.file.buffer?.length) {
        return res.status(400).json({ message: 'Document file is required.' });
      }

      const result = await ingestDocument(req.file.originalname || 'uploaded-document', req.file.buffer, 'admin-panel');

      return res.status(201).json({
        message: `Imported ${result.record_count} product rows.`,
        filename: result.filename,
        file_type: result.file_type,
        source: result.source,
        imported: result.record_count,
        draft_count: result.draft_count,
        rows_without_price: result.rows_without_price,
        inserted: result.inserted_products,
        updated: result.updated_products,
        ingestion_id: result.ingestion_id,
        records_preview: result.payload.records.slice(0, 12)
      });
    } catch (error) {
      return next(error);
    }
  });
});

router.delete('/products/prices', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await withDbClient(async (client) => {
      await client.query('BEGIN');

      try {
        const clearPricesResult = await client.query(`UPDATE products SET srp_price = NULL WHERE srp_price IS NOT NULL`);
        const clearIngestionsResult = await client.query(`DELETE FROM document_ingestions`);

        await client.query('COMMIT');

        return {
          cleared_prices: clearPricesResult.rowCount ?? 0,
          cleared_ingestions: clearIngestionsResult.rowCount ?? 0
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });

    return res.json({
      message: 'All uploaded prices were cleared.',
      ...result
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/data/user-uploaded', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await withDbClient(async (client) => {
      await client.query('BEGIN');

      try {
        await ensureProductCatalogSchema(client);

        const protectedProductsResult = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM products WHERE COALESCE(is_protected, TRUE) = TRUE`
        );

        const ingestedRecordsResult = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ingested_records`);

        const deletedPriceLogsResult = await client.query(
          `
            DELETE FROM price_logs
            WHERE COALESCE(source, 'system') <> 'system'
               OR product_id IN (
                 SELECT id
                 FROM products
                 WHERE COALESCE(is_protected, TRUE) = FALSE
               )
          `
        );

        const deletedIngestionsResult = await client.query(`DELETE FROM document_ingestions`);
        const deletedUserProductsResult = await client.query(
          `DELETE FROM products WHERE COALESCE(is_protected, TRUE) = FALSE`
        );

        await client.query('COMMIT');

        return {
          protected_products: Number(protectedProductsResult.rows[0]?.count ?? 0),
          deleted_user_products: deletedUserProductsResult.rowCount ?? 0,
          deleted_price_logs: deletedPriceLogsResult.rowCount ?? 0,
          deleted_document_ingestions: deletedIngestionsResult.rowCount ?? 0,
          deleted_ingested_records: Number(ingestedRecordsResult.rows[0]?.count ?? 0)
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });

    return res.json({
      message: 'User-uploaded data wiped. Protected sample catalog records were preserved.',
      ...result
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

router.get('/analytics', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const analytics = await getAdminAnalytics();
    return res.json(analytics);
  } catch (error) {
    return next(error);
  }
});

export default router;
