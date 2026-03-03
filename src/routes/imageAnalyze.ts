import multer, { MulterError } from 'multer';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { DEFAULT_REGION } from '../constants/cebuDefaults';
import { fuzzyMatchBaseline, fuzzyMatchBaselineMultiple } from '../services/baselineMatchService';
import { classifyConfidence, DetectionCandidate, ensembleConfidence, hasStrongConsensus } from '../services/confidenceService';
import { analyzeImageQuality, isImageAcceptable, preprocessImageForScan } from '../services/imageQualityService';
import { extractPrimaryItemName } from '../services/itemNameService';
import { extractTextFromImageBuffer } from '../services/ocrService';
import { analyzePrice } from '../services/priceService';
import { extractPriceLinesFromText, type PriceExtractionLine } from '../services/priceExtractionService';
import { inferPriceNormalization } from '../services/unitNormalizationService';
import { detectFromImage, extractImageTextFromDeepseek, type VisionDetection } from '../services/visionService';

const DEFAULT_IMAGE_UPLOAD_MAX_MB = 15;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const INVALID_TYPE_ERROR = 'INVALID_IMAGE_TYPE';
const MINIMUM_CONFIDENCE_HIGH = 0.82; // Strict threshold for automatic approval
const MINIMUM_CONFIDENCE_MEDIUM = 0.62; // Medium confidence - show to user for verification
const MINIMUM_CONFIDENCE_LOW = 0.25; // Absolute minimum before full rejection
const EXPOSE_SCAN_DIAGNOSTICS = String(process.env.EXPOSE_SCAN_DIAGNOSTICS ?? 'true').toLowerCase() !== 'false';
const GENERIC_ITEM_TOKENS = new Set([
  'unknown',
  'unlabeled',
  'unclear',
  'none',
  'na',
  'n/a',
  'item',
  'product',
  'object',
  'food',
  'drink',
  'grocery',
  'goods',
  'snack'
]);

function resolveImageUploadMaxMb(): number {
  const raw = Number(process.env.IMAGE_UPLOAD_MAX_MB ?? DEFAULT_IMAGE_UPLOAD_MAX_MB);
  if (!Number.isFinite(raw) || raw < 1) {
    return DEFAULT_IMAGE_UPLOAD_MAX_MB;
  }

  return Math.floor(raw);
}

const IMAGE_UPLOAD_MAX_MB = resolveImageUploadMaxMb();
const MAX_FILE_SIZE_BYTES = IMAGE_UPLOAD_MAX_MB * 1024 * 1024;

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

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const clamped = Math.max(0, Math.min(1, value));
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
    // strip common size/unit words that aren't helpful for identification
    .replace(/\b(?:kg|g|ml|l|ltr|litre|liter|pack|pcs|piece|bottle|can|box|jar|carton|roll|bar)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toDisplayProductName(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  const keepLower = new Set(['ml', 'kg', 'g', 'l']);
  return normalized
    .split(' ')
    .filter(Boolean)
    .map((token) => {
      const cleaned = token.trim();
      if (!cleaned) {
        return '';
      }

      const lower = cleaned.toLowerCase();
      if (keepLower.has(lower)) {
        return lower;
      }

      if (/^\d+(?:\.\d+)?(?:ml|kg|g|l)$/i.test(cleaned)) {
        return cleaned.toLowerCase();
      }

      if (/^[A-Z0-9]{2,}$/.test(cleaned)) {
        return cleaned;
      }

      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
    })
    .join(' ');
}

function isGenericItemName(value: string): boolean {
  const normalized = normalizeItemToken(value);
  if (!normalized) {
    return true;
  }

  // If the product exists in our baseline, it's definitely not generic
  const match = fuzzyMatchBaseline(normalized);
  if (match && match.match_score >= 0.75) {
    return false; // Found in database, not generic
  }

  if (GENERIC_ITEM_TOKENS.has(normalized)) {
    return true;
  }

  const tokens = normalized.split(' ').filter(Boolean);
  if (!tokens.length) {
    return true;
  }

  // Only reject if ALL tokens are generic
  if (tokens.length <= 2 && tokens.every((token) => GENERIC_ITEM_TOKENS.has(token))) {
    return true;
  }

  return false;
}

function imageCannotBeAnalyzedResponse(
  res: Response,
  options?: {
    reason?: string;
    diagnostics?: Record<string, unknown>;
  }
): Response {
  const payload: Record<string, unknown> = {
    message: 'Image cannot be analyzed. Keep the closest item centered, clear, and well-lit, then try again.',
    reason: options?.reason ?? 'unknown'
  };

  if (EXPOSE_SCAN_DIAGNOSTICS && options?.diagnostics) {
    payload.diagnostics = options.diagnostics;
  }

  return res.status(422).json(payload);
}

function hasModelConfigFailure(message: unknown): boolean {
  if (typeof message !== 'string') {
    return false;
  }

  const normalized = message.toLowerCase();
  return normalized.includes('model not exist') || normalized.includes('no configured vision provider');
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
      return `Image file is too large. Maximum upload size is ${IMAGE_UPLOAD_MAX_MB}MB.`;
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

      const qualityAnalysis = await analyzeImageQuality(req.file.buffer);
      const imageIsAcceptable = isImageAcceptable(qualityAnalysis);
      const qualityPenalty = imageIsAcceptable ? 0 : 0.1;
      const diagnostics: Record<string, unknown> = {
        quality_acceptable: imageIsAcceptable,
        quality_penalty: qualityPenalty,
        quality_issues: qualityAnalysis.recommendations
      };

      let workingBuffer = req.file.buffer;
      try {
        const preprocessed = await preprocessImageForScan(req.file.buffer);
        workingBuffer = preprocessed.buffer;
      } catch {
        // Continue with original buffer when preprocessing fails.
      }

      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
      const displayPrice = shouldShowPrice(prompt, req.body?.show_price);
      const base64Image = workingBuffer.toString('base64');

      // Collection of detection candidates for ensemble voting
      const detectionCandidates: DetectionCandidate[] = [];

      let imageText = '';
      let textConfidence = 0;
      let visionSource: VisionSource = 'deepseek-vl';
      let imageTextError: string | null = null;
      let visionError: string | null = null;
      let extractedPriceModel: string | null = null;
      let extractedPriceBest: PriceExtractionLine | null = null;

      // ========== STEP 1: Try to extract text from image ==========
      try {
        const textExtraction = await extractImageTextFromDeepseek(base64Image, mimeType);
        imageText = textExtraction.text;
        textConfidence = textExtraction.confidence;
        visionSource = textExtraction.source;
        diagnostics.image_text_source = textExtraction.source;
        diagnostics.image_text_confidence = textExtraction.confidence;
      } catch {
        imageText = '';
        imageTextError = 'DeepSeek image text extraction failed';
        diagnostics.image_text_error = 'DeepSeek image text extraction failed';
      }

      // Fallback to Tesseract OCR if Deepseek didn't extract text
      if (!imageText) {
        try {
          imageText = await extractTextFromImageBuffer(workingBuffer);
          if (imageText) {
            textConfidence = 0.3;
            visionSource = 'ocr-fallback';
            diagnostics.ocr_fallback_used = true;
          }
        } catch (error) {
          imageText = '';
          imageTextError = error instanceof Error ? error.message : 'OCR failed';
          diagnostics.ocr_error = error instanceof Error ? error.message : 'OCR failed';
        }
      }

      // ========== STEP 2: Extract product name and details from text ==========
      if (imageText) {
        // Extract price lines from text
        try {
          const extractedFromPrompt = await extractPriceLinesFromText(imageText);
          extractedPriceModel = extractedFromPrompt.model;
          extractedPriceBest = getBestExtractedLine(extractedFromPrompt.parsed);
        } catch {
          // Price extraction is optional
        }

        // Extract primary item name from text
        const extractedFromText = await extractPrimaryItemName(imageText);
        const extractedName = extractedFromText.item_name || '';
        const fallbackName = extractedPriceBest?.product_name || '';

        if (extractedName && !isGenericItemName(extractedName)) {
          detectionCandidates.push({
            source: 'ai-extraction',
            name: extractedName,
            confidence: clampConfidence(textConfidence * 0.95 - qualityPenalty),
            rawText: imageText
          });
        }

        if (fallbackName && !isGenericItemName(fallbackName) && fallbackName !== extractedName) {
          detectionCandidates.push({
            source: 'price-extraction',
            name: fallbackName,
            confidence: clampConfidence(textConfidence * 0.8 - qualityPenalty),
            rawText: imageText
          });
        }
      }

      // ========== STEP 3: Try vision API for additional detection ==========
      let visionDetection: VisionDetection | null = null;
      try {
        visionDetection = await detectFromImage(base64Image, mimeType);
        visionSource = visionDetection.confidence >= 0.3 ? visionSource : 'ai-vision-fallback';
        diagnostics.vision_confidence = visionDetection.confidence;

        if (visionDetection.detected_name && !isGenericItemName(visionDetection.detected_name)) {
          detectionCandidates.push({
            source: 'vision',
            name: visionDetection.detected_name,
            confidence: clampConfidence(visionDetection.confidence - qualityPenalty),
            rawText: visionDetection.detected_name
          });

          if (visionDetection.alternatives && visionDetection.alternatives.length) {
            for (const alt of visionDetection.alternatives) {
              if (!isGenericItemName(alt.name)) {
                detectionCandidates.push({
                  source: 'vision',
                  name: alt.name,
                  confidence: clampConfidence(alt.confidence - qualityPenalty),
                  rawText: visionDetection.detected_name
                });
              }
            }
          }
        }
      } catch (error) {
        visionError = error instanceof Error ? error.message : 'Vision detection failed';
        diagnostics.vision_error = error instanceof Error ? error.message : 'Vision detection failed';
      }

      // Before voting, enrich candidates with database matches
      if (detectionCandidates.length > 0) {
        for (const cand of [...detectionCandidates]) {
          try {
            const dbMatch = fuzzyMatchBaseline(cand.name);
            if (dbMatch && dbMatch.match_score >= cand.confidence) {
              detectionCandidates.push({
                source: 'database-match',
                name: dbMatch.canonical_name,
                confidence: dbMatch.match_score,
                rawText: cand.rawText
              });
            }
          } catch {
            // ignore any errors
          }
        }
      }

      // ========== STEP 4: Ensemble voting on all candidates ==========
      if (detectionCandidates.length === 0) {
        // No candidates from any source
        diagnostics.candidates_count = 0;
        diagnostics.ocr_text_present = Boolean(imageText);
        return imageCannotBeAnalyzedResponse(res, {
          reason: 'no_candidates',
          diagnostics
        });
      }

      const ensembleResult = ensembleConfidence(detectionCandidates);

      // ========== STEP 5: Try to match against baseline database ==========
      const baselineMatch = fuzzyMatchBaseline(ensembleResult.name);
      const finalConfidence = baselineMatch && baselineMatch.match_score >= 0.75
        ? Math.max(ensembleResult.confidence, baselineMatch.match_score)
        : ensembleResult.confidence;
      const finalProductName = baselineMatch?.canonical_name || ensembleResult.name;
      const finalProductDisplayName = toDisplayProductName(finalProductName);

      // ========== STEP 6: Check confidence level and decide next action ==========
      const confidenceLevel = classifyConfidence({
        ...ensembleResult,
        confidence: finalConfidence
      });

      if (finalConfidence < MINIMUM_CONFIDENCE_LOW) {
        if (hasModelConfigFailure(visionError) && !process.env.OPENAI_API_KEY) {
          return res.status(503).json({
            message:
              'Vision provider is misconfigured. DeepSeek model is unavailable and OpenAI fallback is not configured.',
            reason: 'vision_provider_unavailable',
            diagnostics: {
              vision_error: visionError,
              image_text_error: imageTextError,
              suggestion:
                'Set a valid DEEPSEEK_VISION_MODEL/DEEPSEEK_VL_MODEL and DEEPSEEK_OCR_MODEL, or configure OPENAI_API_KEY.'
            }
          });
        }

        // Too low confidence, reject
        diagnostics.candidates_count = detectionCandidates.length;
        diagnostics.final_confidence = finalConfidence;
        diagnostics.final_name = finalProductDisplayName || finalProductName;
        return imageCannotBeAnalyzedResponse(res, {
          reason: 'low_confidence',
          diagnostics
        });
      }

      if (finalConfidence < MINIMUM_CONFIDENCE_MEDIUM && !baselineMatch) {
        // Low confidence and not in database - suggest alternatives
        const alternatives = fuzzyMatchBaselineMultiple(finalProductName, 3);
        return res.status(422).json({
          message: 'Product detection uncertain. Please confirm from the list below.',
          detected_name: finalProductName,
          confidence: finalConfidence,
          confidence_level: confidenceLevel,
          requires_confirmation: true,
          alternatives: alternatives.map((m) => ({
            name: m.canonical_name,
            match_score: m.match_score,
            known_price: m.known_price
          }))
        });
      }

      if (isGenericItemName(finalProductName)) {
        diagnostics.candidates_count = detectionCandidates.length;
        diagnostics.final_confidence = finalConfidence;
        diagnostics.final_name = finalProductDisplayName || finalProductName;
        return imageCannotBeAnalyzedResponse(res, {
          reason: 'generic_name',
          diagnostics
        });
      }

      // ========== STEP 7: Analyze price ==========
      const region = DEFAULT_REGION;
      const scannedPrice = null;
      const rawScanText = imageText || finalProductName;
      const quantityNormalization =
        scannedPrice !== null ? inferPriceNormalization(rawScanText, finalProductName, scannedPrice) : null;

      const marketAnalysis = await analyzePrice({
        name: finalProductDisplayName || finalProductName,
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
          ? inferPriceNormalization(`${finalProductName} ${rawScanText}`, finalProductName, marketAnalysis.fair_market_value)
          : null;
      const marketUnit = marketPriceNormalization?.normalized_unit || 'piece';
      const marketPriceLines =
        marketAnalysis.fair_market_value > 0
          ? [
              `${finalProductDisplayName || finalProductName}|${Number(marketAnalysis.fair_market_value).toFixed(
                2
              )}|PHP|${marketUnit}|estimate|market average`
            ]
          : [];

      // ========== STEP 8: Build response ==========
      const responseData: Record<string, unknown> = {
        vision: {
          detected_name: finalProductDisplayName || finalProductName,
          detected_price: null,
          region_guess: region,
          confidence: finalConfidence,
          canonicalized: baselineMatch ? true : false,
          original_detection: ensembleResult.name,
          display_name: finalProductDisplayName || finalProductName
        },
        detection_ensemble: {
          method: 'multi-source-voting',
          sources: ensembleResult.sources,
          votes: ensembleResult.votes,
          alternatives: ensembleResult.alternatives
        },
        vision_source: visionSource,
        quality: qualityAnalysis,
        confidence_level: confidenceLevel,
        market_analysis: marketAnalysis,
        ratio_assessment: ratioAssessment,
        text_feed: {
          label: finalProductDisplayName || finalProductName,
          display_label: finalProductDisplayName || finalProductName,
          raw_label: ensembleResult.name,
          prompt: prompt || null,
          region
        },
        quantity_normalization: quantityNormalization,
        display: {
          show_price: displayPrice
        },
        price_lines: marketPriceLines,
        price_line_model: marketPriceLines.length ? 'market-derived' : extractedPriceModel,
        image_price_ignored: true
      };

      if (imageText) {
        responseData.ocr_text = imageText;
        responseData.image_text_source = visionSource;
      }

      if (finalConfidence < MINIMUM_CONFIDENCE_HIGH) {
        responseData.low_confidence = true;
      }

      if (!imageIsAcceptable) {
        responseData.quality_warning = qualityAnalysis.recommendations[0] || 'Image quality may reduce detection accuracy.';
      }

      if (!hasStrongConsensus(ensembleResult)) {
        responseData.low_consensus = true;
      }

      return res.json(responseData);
    } catch (error) {
      return next(error);
    }
  });
});

export default router;
