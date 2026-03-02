import axios, { isAxiosError } from 'axios';
import { DEFAULT_REGION } from '../constants/cebuDefaults';
import { parseJsonResponse, requireEnv, sanitizeText } from './serviceUtils';

export interface VisionDetection {
  detected_name: string;
  detected_price: number | null;
  region_guess: string;
  confidence: number;
}

const DEFAULT_MODEL = process.env.DEEPSEEK_VISION_MODEL ?? 'deepseek-vl2';
const DEFAULT_TIMEOUT_MS = Number(process.env.DEEPSEEK_VISION_TIMEOUT_MS ?? 20000);
const PROMPT = [
  'You are a strict product and price extractor from a single image.',
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
  '- If uncertain, set confidence to less than 0.5.',
  '- Confidence must be between 0 and 1.',
  '- Keep detected_name concise and specific.'
].join('\n');

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

export async function detectFromImage(base64Image: string, mimeType: string): Promise<VisionDetection> {
  if (!base64Image || !sanitizeText(base64Image)) {
    throw new Error('Image payload is empty.');
  }

  if (!mimeType || !sanitizeText(mimeType)) {
    throw new Error('Image MIME type is required.');
  }

  const imageDataUrl = `data:${mimeType};base64,${base64Image}`;

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
    const rawText = response.data?.choices?.[0]?.message?.content;

    if (typeof rawText !== 'string' || !sanitizeText(rawText)) {
      throw new Error('Vision response is empty.');
    }

    const parsed = parseJsonResponse(rawText);
    return validateVisionPayload(parsed);
  } catch (error) {
    if (isAxiosError(error)) {
      const status = error.response?.status;
      const details = status ? `status ${status}` : 'network failure';
      throw new Error(`Vision service unavailable (${details}).`);
    }

    if (error instanceof SyntaxError) {
      throw new Error('Vision AI returned malformed JSON.');
    }

    if (error instanceof Error) {
      throw new Error(`Vision analysis failed: ${error.message}`);
    }

    throw new Error('Vision analysis failed due to an unknown error.');
  }
}
