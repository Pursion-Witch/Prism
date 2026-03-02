import { Router, type NextFunction, type Request, type Response } from 'express';
import { DEFAULT_REGION } from '../constants/cebuDefaults';
import { extractPriceFromSentence, extractPrimaryItemName } from '../services/itemNameService';
import { analyzePrice } from '../services/priceService';

interface AnalyzeRequestBody {
  name?: unknown;
  price?: unknown;
  region?: unknown;
  prompt?: unknown;
  show_price?: unknown;
}

const router = Router();

type RatioLevel = 'OVERPRICED' | 'FAIR' | 'GREAT DEAL' | 'STEAL';

interface RatioAssessment {
  level: RatioLevel;
  ratio: number | null;
  difference_percent: number | null;
  color: string;
  note: string;
}

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

function buildRatioAssessment(scannedPrice: number, fairPrice: number): RatioAssessment {
  if (!Number.isFinite(scannedPrice) || scannedPrice <= 0 || !Number.isFinite(fairPrice) || fairPrice <= 0) {
    return {
      level: 'FAIR',
      ratio: null,
      difference_percent: null,
      color: '#8f8f8f',
      note: 'No submitted price to compare.'
    };
  }

  const ratio = scannedPrice / fairPrice;
  const differencePercent = ((scannedPrice - fairPrice) / fairPrice) * 100;

  if (ratio >= 1.15) {
    return {
      level: 'OVERPRICED',
      ratio: Number(ratio.toFixed(4)),
      difference_percent: Number(differencePercent.toFixed(2)),
      color: '#ff5f5f',
      note: 'Submitted price is significantly above fair market.'
    };
  }

  if (ratio >= 0.9) {
    return {
      level: 'FAIR',
      ratio: Number(ratio.toFixed(4)),
      difference_percent: Number(differencePercent.toFixed(2)),
      color: '#1ed760',
      note: 'Submitted price is within fair range.'
    };
  }

  if (ratio >= 0.75) {
    return {
      level: 'GREAT DEAL',
      ratio: Number(ratio.toFixed(4)),
      difference_percent: Number(differencePercent.toFixed(2)),
      color: '#24c9c3',
      note: 'Submitted price is below fair market.'
    };
  }

  return {
    level: 'STEAL',
    ratio: Number(ratio.toFixed(4)),
    difference_percent: Number(differencePercent.toFixed(2)),
    color: '#2f9bff',
    note: 'Submitted price is far below market and may need verification.'
  };
}

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, price, region, prompt, show_price } = req.body as AnalyzeRequestBody;
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedRegion = typeof region === 'string' ? region.trim() : DEFAULT_REGION;
    const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
    const explicitPrice = parseOptionalPrice(price);
    const sentenceDetectedPrice = explicitPrice === null ? extractPriceFromSentence(normalizedName) : null;
    const parsedPrice = explicitPrice ?? sentenceDetectedPrice;

    if (!normalizedName) {
      return res.status(400).json({
        message: 'Please provide a valid product name.'
      });
    }

    const extractedItem = await extractPrimaryItemName(normalizedName);
    const analysisName = extractedItem.item_name || normalizedName;

    const result = await analyzePrice({
      name: analysisName,
      price: parsedPrice,
      region: normalizedRegion || DEFAULT_REGION
    });

    const fairPrice = result.fair_market_value;
    const scannedPrice = result.scanned_price;
    const anomalyScore = fairPrice > 0 && scannedPrice > 0 ? Math.abs(scannedPrice - fairPrice) / fairPrice : 0;
    const ratioAssessment = buildRatioAssessment(scannedPrice, fairPrice);
    const displayPrice = shouldShowPrice(normalizedPrompt, show_price);

    return res.json({
      ...result,
      fairPrice: Number(fairPrice.toFixed(2)),
      anomalyScore: Number(anomalyScore.toFixed(6)),
      ratio_assessment: ratioAssessment,
      input_price_source:
        explicitPrice !== null ? 'explicit' : sentenceDetectedPrice !== null ? 'sentence-detected' : 'none',
      item_extraction: extractedItem,
      display: {
        show_price: displayPrice
      }
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
