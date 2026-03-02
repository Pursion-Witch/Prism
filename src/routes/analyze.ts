import { Router, type NextFunction, type Request, type Response } from 'express';
import { DEFAULT_REGION } from '../constants/cebuDefaults';
import { analyzePrice } from '../services/priceService';

interface AnalyzeRequestBody {
  name?: unknown;
  price?: unknown;
  region?: unknown;
  prompt?: unknown;
  show_price?: unknown;
}

const router = Router();

function parseOptionalPrice(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('Price must be a non-negative number when provided.');
  }

  if (parsed === 0) {
    return null;
  }

  return Number(parsed.toFixed(2));
}

function shouldShowPrice(prompt: string, explicitFlag: unknown): boolean {
  if (typeof explicitFlag === 'boolean') {
    return explicitFlag;
  }
  if (typeof explicitFlag === 'string') {
    const normalizedFlag = explicitFlag.trim().toLowerCase();
    if (normalizedFlag === 'true') {
      return true;
    }
    if (normalizedFlag === 'false') {
      return false;
    }
  }

  const normalizedPrompt = prompt.trim().toLowerCase();
  if (!normalizedPrompt) {
    return true;
  }

  const hideTokens = ['hide price', 'no price', 'without price', 'name only', 'label only', 'identify only'];
  return !hideTokens.some((token) => normalizedPrompt.includes(token));
}

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, price, region, prompt, show_price } = req.body as AnalyzeRequestBody;
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedRegion = typeof region === 'string' ? region.trim() : DEFAULT_REGION;
    const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
    const parsedPrice = parseOptionalPrice(price);

    if (!normalizedName) {
      return res.status(400).json({
        message: 'Please provide a valid product name.'
      });
    }

    const result = await analyzePrice({
      name: normalizedName,
      price: parsedPrice,
      region: normalizedRegion || DEFAULT_REGION
    });

    const fairPrice = result.fair_market_value;
    const scannedPrice = result.scanned_price;
    const anomalyScore = fairPrice > 0 && scannedPrice > 0 ? Math.abs(scannedPrice - fairPrice) / fairPrice : 0;
    const displayPrice = shouldShowPrice(normalizedPrompt, show_price);

    return res.json({
      ...result,
      fairPrice: Number(fairPrice.toFixed(2)),
      anomalyScore: Number(anomalyScore.toFixed(6)),
      display: {
        show_price: displayPrice
      }
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
