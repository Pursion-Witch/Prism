import multer, { MulterError } from 'multer';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { analyzePrice } from '../services/priceService';
import { detectFromImage } from '../services/visionService';

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

      const vision = await detectFromImage(req.file.buffer.toString('base64'), mimeType);

      if (!vision.detected_name) {
        return res.status(400).json({ message: 'Could not detect a product name from the image.' });
      }

      const region = vision.region_guess || 'Metro Manila';
      const scannedPrice = vision.detected_price ?? 0;
      const marketAnalysis = await analyzePrice({
        name: vision.detected_name,
        price: scannedPrice,
        region
      });

      return res.json({
        vision,
        market_analysis: marketAnalysis,
        ...(vision.confidence < 0.4 ? { low_confidence: true } : {})
      });
    } catch (error) {
      return next(error);
    }
  });
});

export default router;
