import type {
  ImageRecognitionResult,
  PriceLineExtractionResponse,
  TranscribeAudioResponse
} from '../types';

export const PRISM_MASTER_PROMPT = [
  'You are PRISM Price Intelligence, an AI pricing data extraction engine.',
  'Identify only the nearest centered product.',
  'Ignore any visible image price tag and use market lookup for pricing.'
].join(' ');

interface AnalyzeImagePayload {
  message?: string;
  vision_source?: string;
  vision?: {
    detected_name?: string;
    confidence?: number;
    region_guess?: string;
  };
  text_feed?: {
    label?: string;
    raw_label?: string;
    region?: string;
  };
  ocr_text?: string;
  price_lines?: string[];
  price_line_model?: string | null;
}

function parseJsonSafe(raw: string): Record<string, unknown> {
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const raw = await response.text();
  const payload = parseJsonSafe(raw) as T & { message?: string };
  if (!response.ok) {
    throw new Error(payload.message || 'Request failed.');
  }

  return payload as T;
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

export async function transcribeAudio(
  base64Audio: string,
  mimeType: string,
  language: string
): Promise<TranscribeAudioResponse> {
  return postJson<TranscribeAudioResponse>('/api/analyze/transcribe-audio', {
    audio_base64: base64Audio,
    mime_type: mimeType,
    language
  });
}

export async function extractPriceLines(text: string): Promise<PriceLineExtractionResponse> {
  return postJson<PriceLineExtractionResponse>('/api/analyze/extract-price-lines', { text });
}

export async function identifyFromImage(base64Image: string): Promise<ImageRecognitionResult> {
  const formData = new FormData();
  formData.append('image', base64ToBlob(base64Image, 'image/jpeg'), 'capture.jpg');
  formData.append('prompt', `${PRISM_MASTER_PROMPT}`);
  formData.append('show_price', 'false');

  const response = await fetch('/api/analyze-image', {
    method: 'POST',
    body: formData
  });

  const raw = await response.text();
  const payload = parseJsonSafe(raw) as AnalyzeImagePayload;
  if (!response.ok) {
    throw new Error(payload.message || 'Image identification failed.');
  }

  const label = String(payload.text_feed?.label || payload.vision?.detected_name || 'Unknown').trim() || 'Unknown';
  const rawLabel = String(payload.text_feed?.raw_label || payload.vision?.detected_name || label).trim() || label;
  const region = String(payload.text_feed?.region || payload.vision?.region_guess || 'NCR');
  const confidence = Number(payload.vision?.confidence ?? 0);

  return {
    label,
    rawLabel,
    region,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    priceLines: payload.price_lines || [],
    priceLineModel: payload.price_line_model ?? null,
    imageText: payload.ocr_text || undefined,
    visionSource: payload.vision_source || undefined
  };
}
