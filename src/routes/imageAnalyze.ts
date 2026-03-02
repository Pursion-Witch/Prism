import multer, { MulterError } from 'multer';
import { Router, type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { DEFAULT_REGION } from '../constants/cebuDefaults';
import { analyzePrice } from '../services/priceService';
import { detectFromImage, type VisionDetection } from '../services/visionService';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const INVALID_TYPE_ERROR = 'INVALID_IMAGE_TYPE';

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

function normalizeFallbackName(value: string): string {
  return value
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/(?:php|p)\s*[0-9][0-9,]*(?:\.[0-9]+)?/gi, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function deriveFallbackName(nameHint: string, prompt: string, originalFilename: string): string | null {
  const candidates = [nameHint, prompt, path.parse(originalFilename).name]
    .map((candidate) => normalizeFallbackName(candidate))
    .filter((candidate) => /[a-z]/i.test(candidate));

  return candidates[0] ?? null;
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
      const nameHint = typeof req.body?.name_hint === 'string' ? req.body.name_hint.trim() : '';
      const displayPrice = shouldShowPrice(prompt, req.body?.show_price);
      let fallbackWarning: string | null = null;
      let vision: VisionDetection;

      try {
        vision = await detectFromImage(req.file.buffer.toString('base64'), mimeType);
      } catch (visionError) {
        const fallbackName = deriveFallbackName(nameHint, prompt, req.file.originalname || 'captured-item');
        if (!fallbackName) {
          throw visionError;
        }

        fallbackWarning =
          visionError instanceof Error ? visionError.message : 'Vision service unavailable. Fallback label used.';
        vision = {
          detected_name: fallbackName,
          detected_price: null,
          region_guess: DEFAULT_REGION,
          confidence: 0.1
        };
      }

      if (!vision.detected_name) {
        return res.status(400).json({ message: 'Could not detect a product name from the image.' });
      }

      const region = vision.region_guess || DEFAULT_REGION;
      const scannedPrice = vision.detected_price ?? null;
      const marketAnalysis = await analyzePrice({
        name: vision.detected_name,
        price: scannedPrice,
        region,
        persist_submission: true
      });

      return res.json({
        vision,
        market_analysis: marketAnalysis,
        text_feed: {
          label: vision.detected_name,
          prompt: prompt || null,
          region
        },
        display: {
          show_price: displayPrice
        },
        ...(fallbackWarning ? { vision_warning: fallbackWarning } : {}),
        ...(vision.confidence < 0.4 ? { low_confidence: true } : {})
      });
    } catch (error) {
      return next(error);
    }
  });
});

export default router;
