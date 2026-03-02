import multer, { MulterError } from 'multer';
import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  DEFAULT_CATEGORY,
  DEFAULT_MARKET_NAME,
  DEFAULT_REGION,
  DEFAULT_STALL_NAME
} from '../constants/cebuDefaults';
import { ingestDocument } from '../services/documentIngestionService';
import { getAdminStats, getAllTrackedProducts } from '../services/priceService';
import { upsertCatalogProductWithDb } from '../services/productCatalogService';

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
  'application/octet-stream',
  'text/markdown'
]);

const uploadDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES },
  fileFilter: (_req, file, callback) => {
    const mimeType = file.mimetype.toLowerCase();
    const extension = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    const validExtension = ['txt', 'csv', 'json', 'md', 'tsv'].includes(extension);

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
    return 'Only txt, csv, json, tsv, or md documents are allowed.';
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
        srpPrice: parsedPrice
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
        srpPrice: parsePositivePrice(body.srp_price ?? body.price)
      },
      { updateExisting: true }
    );

    return res.status(result.action === 'inserted' ? 201 : 200).json({
      message: result.action === 'inserted' ? 'Product added.' : 'Product updated.',
      action: result.action,
      product: {
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
        source: result.source,
        imported: result.record_count,
        inserted: result.inserted_products,
        updated: result.updated_products,
        ingestion_id: result.ingestion_id
      });
    } catch (error) {
      return next(error);
    }
  });
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
