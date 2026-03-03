import multer, { MulterError } from 'multer';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { DEFAULT_REGION } from '../constants/cebuDefaults';
import { extractPrimaryItemName } from '../services/itemNameService';
import { extractTextFromImageBuffer } from '../services/ocrService';
import { analyzePrice } from '../services/priceService';
import { extractPriceLinesFromText, type PriceExtractionLine } from '../services/priceExtractionService';
import { inferPriceNormalization } from '../services/unitNormalizationService';
import { detectFromImage, extractImageTextFromDeepseek, type VisionDetection } from '../services/visionService';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const INVALID_TYPE_ERROR = 'INVALID_IMAGE_TYPE';
const MINIMUM_CONFIDENCE = 0.2;
const GENERIC_ITEM_TOKENS = new Set([
  'item',
  'product',
  'object',
  'food',
  'grocery',
  'goods',
  'unknown',
  'unlabeled',
  'unclear',
  'none',
  'na',
  'n/a'
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, callback) => {
    const mimeType = file.mimetype.toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
      callback(new Error(INVALID_TYPE_ERROR));
      return;
    }

    callback(null, true);
  }
});

const router = Router();

type RatioLevel = 'OVERPRICED' | 'FAIR' | 'GREAT DEAL' | 'STEAL';

type VisionSource = 'deepseek-vl' | 'deepseek-ocr' | 'deepseek-vl+ocr' | 'ocr-fallback' | 'ai-vision-fallback';

interface RatioAssessment {
  level: RatioLevel;
  ratio: number | null;
  difference_percent: number | null;
  color: string;
  note: string;
}

function getBestExtractedLine(lines: PriceExtractionLine[]): PriceExtractionLine | null {
  if (!lines.length) {
    return null;
  }

  const sorted = lines
    .slice()
    .sort((left, right) => {
      const leftScore = (left.product_name.toLowerCase() === 'unknown' ? 0 : 1) + (left.price > 0 ? 2 : 0);
      const rightScore = (right.product_name.toLowerCase() === 'unknown' ? 0 : 1) + (right.price > 0 ? 2 : 0);
      return rightScore - leftScore;
    });

  return sorted[0] ?? null;
}

function clampConfidence(value: number, minimum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  const clamped = Math.max(minimum, Math.min(1, value));
  return Number(clamped.toFixed(2));
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

function normalizeItemToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericItemName(value: string): boolean {
  const normalized = normalizeItemToken(value);
  if (!normalized) {
    return true;
  }

  if (GENERIC_ITEM_TOKENS.has(normalized)) {
    return true;
  }

  const tokens = normalized.split(' ').filter(Boolean);
  if (!tokens.length) {
    return true;
  }

  if (tokens.length <= 2 && tokens.every((token) => GENERIC_ITEM_TOKENS.has(token))) {
    return true;
  }

  return false;
}

function imageCannotBeAnalyzedResponse(res: Response): Response {
  return res.status(422).json({
    message: 'Image cannot be analyzed. Keep the closest item centered, clear, and well-lit, then try again.'
  });
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

function getUploadErrorMessage(error: unknown): string {
  if (error instanceof MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return 'Image file is too large. Maximum upload size is 5MB.';
    }

    return 'Invalid image upload.';
  }

  if (error instanceof Error && error.message === INVALID_TYPE_ERROR) {
    return 'Only jpeg, jpg, png, and webp image files are allowed.';
  }

  return 'Invalid image upload.';
}

router.post('/analyze-image', (req: Request, res: Response, next: NextFunction) => {
  upload.single('image')(req, res, async (uploadError: unknown) => {
    if (uploadError) {
      return res.status(400).json({ message: getUploadErrorMessage(uploadError) });
    }

    try {
      if (!req.file || !req.file.buffer?.length) {
        return res.status(400).json({ message: 'Image file is required.' });
      }

      const mimeType = req.file.mimetype.toLowerCase();
      if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
        return res.status(400).json({ message: 'Only jpeg, jpg, png, and webp image files are allowed.' });
      }

      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
      const displayPrice = shouldShowPrice(prompt, req.body?.show_price);
      const base64Image = req.file.buffer.toString('base64');

      let vision: VisionDetection | null = null;
      let imageText = '';
      let textConfidence = 0;
      let visionSource: VisionSource = 'deepseek-vl';
      let extractedPriceLines: string[] = [];
      let extractedPriceModel: string | null = null;
      let extractedPriceBest: PriceExtractionLine | null = null;

      try {
        const textExtraction = await extractImageTextFromDeepseek(base64Image, mimeType);
        imageText = textExtraction.text;
        textConfidence = textExtraction.confidence;
        visionSource = textExtraction.source;
      } catch {
        imageText = '';
      }

      if (!imageText) {
        try {
          imageText = await extractTextFromImageBuffer(req.file.buffer);
          if (imageText) {
            textConfidence = 0.28;
            visionSource = 'ocr-fallback';
          }
        } catch {
          imageText = '';
        }
      }

      if (imageText) {
        const extractedFromPrompt = await extractPriceLinesFromText(imageText);
        extractedPriceLines = extractedFromPrompt.lines;
        extractedPriceModel = extractedFromPrompt.model;
        extractedPriceBest = getBestExtractedLine(extractedFromPrompt.parsed);

        const extractedFromText = await extractPrimaryItemName(imageText);
        const extractedName = extractedFromText.item_name || '';
        const fallbackName = extractedPriceBest?.product_name || '';
        if (extractedName && !isGenericItemName(extractedName)) {
          vision = {
            detected_name: extractedName,
            detected_price: null,
            region_guess: DEFAULT_REGION,
            confidence: clampConfidence(textConfidence, 0.35)
          };
        } else if (fallbackName && !isGenericItemName(fallbackName)) {
          vision = {
            detected_name: fallbackName,
            detected_price: null,
            region_guess: DEFAULT_REGION,
            confidence: clampConfidence(textConfidence, 0.3)
          };
        }
      }

      if (!vision) {
        try {
          vision = await detectFromImage(base64Image, mimeType);
          visionSource = 'ai-vision-fallback';
        } catch {
          return imageCannotBeAnalyzedResponse(res);
        }
      }

      if (!vision || !vision.detected_name || vision.confidence < MINIMUM_CONFIDENCE || isGenericItemName(vision.detected_name)) {
        return imageCannotBeAnalyzedResponse(res);
      }

      const detectedVision: VisionDetection = {
        ...vision,
        detected_price: null
      };
      const extractedItem = await extractPrimaryItemName(detectedVision.detected_name);
      const analysisName = extractedItem.item_name || detectedVision.detected_name;
      if (!analysisName || isGenericItemName(analysisName)) {
        return imageCannotBeAnalyzedResponse(res);
      }

      const region = detectedVision.region_guess || DEFAULT_REGION;
      const scannedPrice = null;
      const rawScanText = imageText || detectedVision.detected_name;
      const quantityNormalization =
        scannedPrice !== null ? inferPriceNormalization(rawScanText, analysisName, scannedPrice) : null;
      const marketAnalysis = await analyzePrice({
        name: analysisName,
        price: scannedPrice,
        region,
        persist_submission: true,
        report_flag: true,
        source: visionSource,
        raw_input: rawScanText,
        price_normalization: quantityNormalization
      });
      const ratioAssessment = buildRatioAssessment(
        Number(marketAnalysis.scanned_price ?? scannedPrice ?? 0),
        Number(marketAnalysis.fair_market_value ?? 0)
      );
      const marketPriceNormalization =
        marketAnalysis.fair_market_value > 0
          ? inferPriceNormalization(`${analysisName} ${rawScanText}`, analysisName, marketAnalysis.fair_market_value)
          : null;
      const marketUnit = marketPriceNormalization?.normalized_unit || 'piece';
      const marketPriceLines =
        marketAnalysis.fair_market_value > 0
          ? [
              `${analysisName}|${Number(marketAnalysis.fair_market_value).toFixed(
                2
              )}|PHP|${marketUnit}|estimate|market average`
            ]
          : [];

      return res.json({
        vision: detectedVision,
        vision_source: visionSource,
        market_analysis: marketAnalysis,
        ratio_assessment: ratioAssessment,
        text_feed: {
          label: analysisName,
          raw_label: detectedVision.detected_name,
          prompt: prompt || null,
          region
        },
        item_extraction: extractedItem,
        quantity_normalization: quantityNormalization,
        display: {
          show_price: displayPrice
        },
        price_lines: marketPriceLines,
        price_line_model: marketPriceLines.length ? 'market-derived' : extractedPriceModel,
        image_price_ignored: true,
        ...(imageText ? { ocr_text: imageText, image_text_source: visionSource } : {}),
        ...(detectedVision.confidence < 0.4 ? { low_confidence: true } : {})
      });
    } catch (error) {
      return next(error);
    }
  });
});

export default router;
