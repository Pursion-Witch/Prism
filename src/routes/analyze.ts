import { Router, type NextFunction, type Request, type Response } from 'express';
import { DEFAULT_REGION } from '../constants/cebuDefaults';
import { extractPriceFromSentence, extractPrimaryItemName } from '../services/itemNameService';
import { analyzePrice } from '../services/priceService';
import { extractPriceLinesFromText } from '../services/priceExtractionService';
import { transcribeAudioBase64 } from '../services/audioTranscriptionService';
import { normalizeToEnglish } from '../services/translationService';
import { inferPriceNormalization } from '../services/unitNormalizationService';

interface AnalyzeRequestBody {
  name?: unknown;
  price?: unknown;
  region?: unknown;
  prompt?: unknown;
  show_price?: unknown;
  report_flag?: unknown;
}

interface TranslateRequestBody {
  text?: unknown;
}

interface TranscribeAudioRequestBody {
  audio_base64?: unknown;
  mime_type?: unknown;
  language?: unknown;
}

interface ExtractPriceLinesRequestBody {
  text?: unknown;
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

router.post('/translate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { text } = req.body as TranslateRequestBody;
    const rawText = typeof text === 'string' ? text.trim() : '';

    if (!rawText) {
      return res.status(400).json({ message: 'Text is required for translation.' });
    }

    const translated = await normalizeToEnglish(rawText);
    const extracted = await extractPriceLinesFromText(
      translated.canonical_english_text || translated.english_text || rawText
    );
    return res.json({
      original_text: rawText,
      translated_text: translated.english_text || rawText,
      source: translated.source,
      canonical_text: translated.canonical_english_text || translated.english_text || rawText,
      canonical_source: translated.canonical_source,
      price_lines: extracted.lines,
      price_line_model: extracted.model
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/transcribe-audio', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { audio_base64, mime_type, language } = req.body as TranscribeAudioRequestBody;
    const rawAudio = typeof audio_base64 === 'string' ? audio_base64.trim() : '';

    if (!rawAudio) {
      return res.status(400).json({ message: 'Audio payload is required for transcription.' });
    }

    const transcribedText = await transcribeAudioBase64(rawAudio, mime_type, language);
    const translated = await normalizeToEnglish(transcribedText);
    const extracted = await extractPriceLinesFromText(
      translated.canonical_english_text || translated.english_text || transcribedText
    );

    return res.json({
      transcribed_text: transcribedText,
      translated_text: translated.english_text || transcribedText,
      source: translated.source,
      canonical_text: translated.canonical_english_text || translated.english_text || transcribedText,
      canonical_source: translated.canonical_source,
      price_lines: extracted.lines,
      price_line_model: extracted.model
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/extract-price-lines', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { text } = req.body as ExtractPriceLinesRequestBody;
    const rawText = typeof text === 'string' ? text.trim() : '';

    if (!rawText) {
      return res.status(400).json({ message: 'Text is required for extraction.' });
    }

    const translated = await normalizeToEnglish(rawText);
    const baseText = translated.canonical_english_text || translated.english_text || rawText;
    const extraction = await extractPriceLinesFromText(baseText);

    return res.json({
      input_text: rawText,
      normalized_text: baseText,
      translation_source: translated.source,
      canonical_source: translated.canonical_source,
      price_lines: extraction.lines,
      raw_output: extraction.raw_output,
      model: extraction.model
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, price, region, prompt, show_price, report_flag } = req.body as AnalyzeRequestBody;
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedRegion = typeof region === 'string' ? region.trim() : DEFAULT_REGION;
    const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
    const reportFlag =
      typeof report_flag === 'boolean'
        ? report_flag
        : typeof report_flag === 'string'
          ? report_flag.trim().toLowerCase() === 'true'
          : true;
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
    const quantityNormalization =
      parsedPrice !== null ? inferPriceNormalization(normalizedName, analysisName, parsedPrice) : null;

    const result = await analyzePrice({
      name: analysisName,
      price: parsedPrice,
      region: normalizedRegion || DEFAULT_REGION,
      report_flag: reportFlag,
      source: 'user',
      raw_input: normalizedName,
      price_normalization: quantityNormalization
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
      quantity_normalization: quantityNormalization,
      display: {
        show_price: displayPrice
      }
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
