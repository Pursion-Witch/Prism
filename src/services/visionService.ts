import axios, { isAxiosError } from 'axios';
import { DEFAULT_REGION } from '../constants/cebuDefaults';
import { parseJsonResponse, requireEnv, sanitizeText } from './serviceUtils';

export interface VisionDetection {
  detected_name: string;
  detected_price: number | null;
  region_guess: string;
  confidence: number;
}

export type DeepseekImageTextSource = 'deepseek-vl' | 'deepseek-ocr' | 'deepseek-vl+ocr';

export interface ImageTextExtraction {
  text: string;
  confidence: number;
  source: DeepseekImageTextSource;
}

interface ImageTextModelResult {
  text: string;
  confidence: number;
}

type ImageTextMode = 'both' | 'vl-first' | 'ocr-first' | 'vl-only' | 'ocr-only';

const DEFAULT_MODEL = process.env.DEEPSEEK_VISION_MODEL ?? 'deepseek-vl2';
const DEEPSEEK_VL_MODEL = process.env.DEEPSEEK_VL_MODEL ?? DEFAULT_MODEL;
const DEEPSEEK_OCR_MODEL = process.env.DEEPSEEK_OCR_MODEL ?? 'deepseek-ocr';
const DEFAULT_TIMEOUT_MS = Number(process.env.DEEPSEEK_VISION_TIMEOUT_MS ?? 20000);
const IMAGE_TEXT_TIMEOUT_MS = Number(process.env.DEEPSEEK_IMAGE_TEXT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL ?? 'gpt-4o-mini';
const VISION_PROVIDER = String(process.env.VISION_PROVIDER ?? 'auto').toLowerCase();

const PROMPT = [
  'You are a strict product and price extractor from a single image.',
  'Focus on the single closest visible item to the camera.',
  'Prefer the largest clear object near the center as the primary item.',
  'Return JSON only. Do not return markdown.',
  'Output schema:',
  '{',
  '  "detected_name": "string",',
  '  "detected_price": number | null,',
  '  "region_guess": "string",',
  '  "confidence": number',
  '}',
  'Rules:',
  '- If no visible price, set detected_price to null.',
  '- detected_name must be a real item name, not generic words like item or object.',
  '- If no clear item is visible, set detected_name to "unknown" and confidence below 0.2.',
  '- If uncertain, set confidence to less than 0.5.',
  '- Confidence must be between 0 and 1.',
  '- Keep detected_name concise and specific.'
].join('\n');

const IMAGE_TEXT_PROMPT = [
  'You convert a product photo to text for downstream text-only analysis.',
  'Return JSON only. No markdown.',
  'Output schema:',
  '{',
  '  "text": "string",',
  '  "confidence": number',
  '}',
  'Rules:',
  '- Capture visible text from the nearest centered product and nearby price labels.',
  '- Keep the text concise but include important brand, variant, and size words when visible.',
  '- If no readable text exists, return an empty string and confidence below 0.2.',
  '- Confidence must be between 0 and 1.'
].join('\n');

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const clamped = Math.max(0, Math.min(1, value));
  return Number(clamped.toFixed(2));
}

function inferTextConfidence(text: string): number {
  if (!text) {
    return 0;
  }

  if (text.length >= 120) {
    return 0.85;
  }

  if (text.length >= 60) {
    return 0.7;
  }

  if (text.length >= 24) {
    return 0.55;
  }

  return 0.4;
}

function validateVisionPayload(payload: unknown): VisionDetection {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Vision response is not a valid JSON object.');
  }

  const record = payload as Record<string, unknown>;
  const detectedName = typeof record.detected_name === 'string' ? sanitizeText(record.detected_name) : '';
  const regionGuess = typeof record.region_guess === 'string' ? sanitizeText(record.region_guess) : '';
  const confidence = Number(record.confidence);

  let detectedPrice: number | null = null;
  if (record.detected_price !== null && record.detected_price !== undefined) {
    const parsedPrice = Number(record.detected_price);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      throw new Error('Vision response has invalid detected_price.');
    }
    detectedPrice = Number(parsedPrice.toFixed(2));
  }

  if (!detectedName) {
    throw new Error('Vision response missing detected_name.');
  }

  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('Vision response has invalid confidence.');
  }

  return {
    detected_name: detectedName,
    detected_price: detectedPrice,
    region_guess: regionGuess || DEFAULT_REGION,
    confidence: Number(confidence.toFixed(2))
  };
}

function validateImageTextPayload(payload: unknown): ImageTextModelResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Image text response is not a valid JSON object.');
  }

  const record = payload as Record<string, unknown>;
  const rawText =
    typeof record.text === 'string'
      ? record.text
      : typeof record.extracted_text === 'string'
        ? record.extracted_text
        : typeof record.ocr_text === 'string'
          ? record.ocr_text
          : '';
  const text = sanitizeText(rawText);
  const confidenceValue = Number(record.confidence);
  const confidence =
    Number.isFinite(confidenceValue) && confidenceValue >= 0 && confidenceValue <= 1
      ? clampConfidence(confidenceValue)
      : clampConfidence(inferTextConfidence(text));

  return {
    text,
    confidence: text ? confidence : Math.min(confidence, 0.2)
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Vision request timed out.')), timeoutMs);
    })
  ]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

function extractAxiosErrorMessage(error: unknown): string {
  if (!isAxiosError(error)) {
    return error instanceof Error ? error.message : 'unknown error';
  }

  const status = error.response?.status;
  const payload = error.response?.data as
    | string
    | { error?: { message?: string }; message?: string }
    | undefined;
  const rawMessage =
    typeof payload === 'string'
      ? payload
      : typeof payload?.error?.message === 'string'
        ? payload.error.message
        : typeof payload?.message === 'string'
          ? payload.message
          : '';
  const compact = sanitizeText(rawMessage || '');

  if (compact) {
    return status ? `status ${status}: ${compact}` : compact;
  }

  return status ? `status ${status}` : 'network failure';
}

function parseVisionContent(rawText: unknown): VisionDetection {
  if (typeof rawText !== 'string' || !sanitizeText(rawText)) {
    throw new Error('Vision response is empty.');
  }

  const parsed = parseJsonResponse(rawText);
  return validateVisionPayload(parsed);
}

function parseImageTextContent(rawText: unknown): ImageTextModelResult {
  if (typeof rawText !== 'string' || !sanitizeText(rawText)) {
    return { text: '', confidence: 0 };
  }

  const cleaned = sanitizeText(rawText);

  try {
    const parsed = parseJsonResponse(cleaned);
    return validateImageTextPayload(parsed);
  } catch {
    return {
      text: cleaned,
      confidence: clampConfidence(inferTextConfidence(cleaned))
    };
  }
}

function mergeImageText(primary: string, secondary: string): string {
  const normalizedPrimary = sanitizeText(primary);
  const normalizedSecondary = sanitizeText(secondary);

  if (!normalizedPrimary) {
    return normalizedSecondary;
  }

  if (!normalizedSecondary) {
    return normalizedPrimary;
  }

  if (normalizedPrimary.toLowerCase() === normalizedSecondary.toLowerCase()) {
    return normalizedPrimary;
  }

  const lines = `${normalizedPrimary}\n${normalizedSecondary}`
    .split(/\r?\n/)
    .map((line) => sanitizeText(line))
    .filter(Boolean);
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(line);
  }

  return deduped.join('\n');
}

function getImageTextMode(): ImageTextMode {
  const mode = sanitizeText(String(process.env.DEEPSEEK_IMAGE_TEXT_MODE ?? 'both')).toLowerCase();

  if (mode === 'vl-first' || mode === 'ocr-first' || mode === 'vl-only' || mode === 'ocr-only') {
    return mode;
  }

  return 'both';
}

interface ImageTextAttempt {
  source: 'deepseek-vl' | 'deepseek-ocr';
  model: string;
}

function buildImageTextAttempts(mode: ImageTextMode): ImageTextAttempt[] {
  if (mode === 'vl-only') {
    return [{ source: 'deepseek-vl', model: DEEPSEEK_VL_MODEL }];
  }

  if (mode === 'ocr-only') {
    return [{ source: 'deepseek-ocr', model: DEEPSEEK_OCR_MODEL }];
  }

  if (mode === 'ocr-first') {
    return [
      { source: 'deepseek-ocr', model: DEEPSEEK_OCR_MODEL },
      { source: 'deepseek-vl', model: DEEPSEEK_VL_MODEL }
    ];
  }

  return [
    { source: 'deepseek-vl', model: DEEPSEEK_VL_MODEL },
    { source: 'deepseek-ocr', model: DEEPSEEK_OCR_MODEL }
  ];
}

async function requestDeepseekImageText(imageDataUrl: string, model: string): Promise<ImageTextModelResult> {
  try {
    const requestPromise = axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: IMAGE_TEXT_PROMPT
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extract product text from this image and return strict JSON.' },
              { type: 'image_url', image_url: { url: imageDataUrl } }
            ]
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${requireEnv('DEEPSEEK_API_KEY')}`,
          'Content-Type': 'application/json'
        },
        timeout: IMAGE_TEXT_TIMEOUT_MS
      }
    );

    const response = await withTimeout(requestPromise, IMAGE_TEXT_TIMEOUT_MS);
    return parseImageTextContent(response.data?.choices?.[0]?.message?.content);
  } catch (error) {
    if (isAxiosError(error)) {
      throw new Error(`DeepSeek image text unavailable (${extractAxiosErrorMessage(error)}).`);
    }

    if (error instanceof Error) {
      throw new Error(`DeepSeek image text failed: ${error.message}`);
    }

    throw new Error('DeepSeek image text failed due to an unknown error.');
  }
}

export async function extractImageTextFromDeepseek(base64Image: string, mimeType: string): Promise<ImageTextExtraction> {
  if (!base64Image || !sanitizeText(base64Image)) {
    throw new Error('Image payload is empty.');
  }

  if (!mimeType || !sanitizeText(mimeType)) {
    throw new Error('Image MIME type is required.');
  }

  const mode = getImageTextMode();
  const imageDataUrl = `data:${mimeType};base64,${base64Image}`;
  const attempts = buildImageTextAttempts(mode);
  const failures: string[] = [];
  const successes: Array<{ source: 'deepseek-vl' | 'deepseek-ocr'; result: ImageTextModelResult }> = [];

  for (const attempt of attempts) {
    try {
      const result = await requestDeepseekImageText(imageDataUrl, attempt.model);
      if (!result.text) {
        continue;
      }

      successes.push({ source: attempt.source, result });

      const modeWantsBoth = mode === 'both';
      const shouldStopEarly = !modeWantsBoth && result.confidence >= 0.3;
      if (shouldStopEarly) {
        break;
      }
    } catch (error) {
      failures.push(`${attempt.source} (${attempt.model}): ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  if (!successes.length) {
    if (!failures.length) {
      throw new Error('DeepSeek image text extraction returned no readable text.');
    }

    throw new Error(`DeepSeek image text extraction failed. ${failures.join(' | ')}`);
  }

  if (mode === 'both' && successes.length >= 2) {
    const fromVl = successes.find((entry) => entry.source === 'deepseek-vl');
    const fromOcr = successes.find((entry) => entry.source === 'deepseek-ocr');

    if (fromVl && fromOcr) {
      return {
        text: mergeImageText(fromVl.result.text, fromOcr.result.text),
        confidence: clampConfidence(Math.max(fromVl.result.confidence, fromOcr.result.confidence)),
        source: 'deepseek-vl+ocr'
      };
    }
  }

  const best = successes
    .slice()
    .sort((left, right) => right.result.confidence - left.result.confidence)[0];

  return {
    text: best.result.text,
    confidence: clampConfidence(best.result.confidence),
    source: best.source
  };
}

async function requestDeepseekVision(imageDataUrl: string): Promise<VisionDetection> {
  try {
    const requestPromise = axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: DEFAULT_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: PROMPT
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyze this image and return strict JSON.' },
              { type: 'image_url', image_url: { url: imageDataUrl } }
            ]
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${requireEnv('DEEPSEEK_API_KEY')}`,
          'Content-Type': 'application/json'
        },
        timeout: DEFAULT_TIMEOUT_MS
      }
    );

    const response = await withTimeout(requestPromise, DEFAULT_TIMEOUT_MS);
    return parseVisionContent(response.data?.choices?.[0]?.message?.content);
  } catch (error) {
    if (isAxiosError(error)) {
      throw new Error(`DeepSeek vision unavailable (${extractAxiosErrorMessage(error)}).`);
    }

    if (error instanceof SyntaxError) {
      throw new Error('DeepSeek vision returned malformed JSON.');
    }

    if (error instanceof Error) {
      throw new Error(`DeepSeek vision failed: ${error.message}`);
    }

    throw new Error('DeepSeek vision failed due to an unknown error.');
  }
}

async function requestOpenAiVision(imageDataUrl: string): Promise<VisionDetection> {
  try {
    const requestPromise = axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: OPENAI_VISION_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: PROMPT
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyze this image and return strict JSON.' },
              { type: 'image_url', image_url: { url: imageDataUrl } }
            ]
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${requireEnv('OPENAI_API_KEY')}`,
          'Content-Type': 'application/json'
        },
        timeout: DEFAULT_TIMEOUT_MS
      }
    );

    const response = await withTimeout(requestPromise, DEFAULT_TIMEOUT_MS);
    return parseVisionContent(response.data?.choices?.[0]?.message?.content);
  } catch (error) {
    if (isAxiosError(error)) {
      throw new Error(`OpenAI vision unavailable (${extractAxiosErrorMessage(error)}).`);
    }

    if (error instanceof SyntaxError) {
      throw new Error('OpenAI vision returned malformed JSON.');
    }

    if (error instanceof Error) {
      throw new Error(`OpenAI vision failed: ${error.message}`);
    }

    throw new Error('OpenAI vision failed due to an unknown error.');
  }
}

function shouldTryDeepseek(): boolean {
  return VISION_PROVIDER === 'auto' || VISION_PROVIDER === 'deepseek';
}

function shouldTryOpenAi(): boolean {
  return VISION_PROVIDER === 'auto' || VISION_PROVIDER === 'openai';
}

export async function detectFromImage(base64Image: string, mimeType: string): Promise<VisionDetection> {
  if (!base64Image || !sanitizeText(base64Image)) {
    throw new Error('Image payload is empty.');
  }

  if (!mimeType || !sanitizeText(mimeType)) {
    throw new Error('Image MIME type is required.');
  }

  const imageDataUrl = `data:${mimeType};base64,${base64Image}`;
  const failures: string[] = [];

  if (shouldTryDeepseek()) {
    try {
      return await requestDeepseekVision(imageDataUrl);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'DeepSeek vision failed.');
    }
  }

  if (shouldTryOpenAi()) {
    if (!process.env.OPENAI_API_KEY) {
      failures.push('OpenAI vision unavailable (OPENAI_API_KEY is not configured).');
    } else {
      try {
        return await requestOpenAiVision(imageDataUrl);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : 'OpenAI vision failed.');
      }
    }
  }

  if (!failures.length) {
    failures.push(
      'No configured vision provider. Set VISION_PROVIDER=auto and configure at least one provider API key.'
    );
  }

  throw new Error(`Vision service unavailable. ${failures.join(' | ')}`);
}
