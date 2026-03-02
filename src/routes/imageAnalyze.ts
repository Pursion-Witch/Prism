import multer, { MulterError } from 'multer';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { DEFAULT_REGION } from '../constants/cebuDefaults';
import { extractPriceFromSentence, extractPrimaryItemName } from '../services/itemNameService';
import { extractTextFromImageBuffer } from '../services/ocrService';
import { analyzePrice } from '../services/priceService';
import { inferPriceNormalization } from '../services/unitNormalizationService';
import { detectFromImage, type VisionDetection } from '../services/visionService';

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

interface RatioAssessment {
  level: RatioLevel;
  ratio: number | null;
  difference_percent: number | null;
  color: string;
  note: string;
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
      let vision: VisionDetection | null = null;
      let ocrText = '';
      let visionSource: 'ai-vision' | 'ocr-fallback' = 'ai-vision';

      try {
        vision = await detectFromImage(req.file.buffer.toString('base64'), mimeType);
      } catch {
        vision = null;
      }

      if (!vision || !vision.detected_name || vision.confidence < MINIMUM_CONFIDENCE || isGenericItemName(vision.detected_name)) {
        try {
          ocrText = await extractTextFromImageBuffer(req.file.buffer);
        } catch {
          return imageCannotBeAnalyzedResponse(res);
        }

        if (!ocrText) {
          return imageCannotBeAnalyzedResponse(res);
        }

        const ocrExtractedItem = await extractPrimaryItemName(ocrText);
        const ocrName = ocrExtractedItem.item_name || '';
        if (!ocrName || isGenericItemName(ocrName)) {
          return imageCannotBeAnalyzedResponse(res);
        }

        vision = {
          detected_name: ocrName,
          detected_price: extractPriceFromSentence(ocrText),
          region_guess: DEFAULT_REGION,
          confidence: 0.35
        };
        visionSource = 'ocr-fallback';
      }

      const detectedVision = vision;

      const extractedItem = await extractPrimaryItemName(detectedVision.detected_name);
      const analysisName = extractedItem.item_name || detectedVision.detected_name;
      if (!analysisName || isGenericItemName(analysisName)) {
        return imageCannotBeAnalyzedResponse(res);
      }

      const region = detectedVision.region_guess || DEFAULT_REGION;
      const scannedPrice = detectedVision.detected_price ?? null;
      const rawScanText = ocrText || detectedVision.detected_name;
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
        ...(ocrText ? { ocr_text: ocrText } : {}),
        ...(detectedVision.confidence < 0.4 ? { low_confidence: true } : {})
      });
    } catch (error) {
      return next(error);
    }
  });
});

export default router;
