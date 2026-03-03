import {
  type AnalysisResult,
  type BasicInput,
  MarketStatus,
  type PhilippineRegion,
  type ProductInput
} from '../types';

export const PRISM_MASTER_PROMPT = `You are PRISM Price Intelligence, an AI pricing data extraction engine. Your sole purpose is to convert any user input into clean machine-readable price lines in the format product_name|price|currency|unit|basis|source_note.`;

interface AnalyzeResponsePayload {
  name?: string;
  region?: string;
  scanned_price?: number;
  fair_market_value?: number;
  fairPrice?: number;
  srp_price?: number | null;
  verdict?: string;
  reasoning?: string;
  price_lines?: string[];
}

interface AnalyzeImagePayload {
  market_analysis?: AnalyzeResponsePayload;
  price_lines?: string[];
}

interface TranscribePayload {
  transcribed_text?: string;
  translated_text?: string;
  canonical_text?: string;
  price_lines?: string[];
}

function parseJsonSafe(raw: string): Record<string, unknown> {
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function mapStatus(verdict: string | undefined): MarketStatus {
  const normalized = String(verdict || '').toUpperCase();
  if (normalized.includes('OVERPRICED')) return MarketStatus.OVERPRICED;
  if (normalized.includes('GREAT DEAL')) return MarketStatus.GREAT_DEAL;
  if (normalized.includes('STEAL')) return MarketStatus.GREAT_DEAL;
  if (normalized.includes('PRICE GOUGING')) return MarketStatus.PRICE_GOUGING;
  if (normalized.includes('FAIR')) return MarketStatus.FAIR_VALUE;
  return MarketStatus.UNKNOWN;
}

function toRegion(value: string | undefined): PhilippineRegion {
  const allowed = new Set<PhilippineRegion>([
    'NCR',
    'CAR',
    'Region I',
    'Region II',
    'Region III',
    'Region IV-A',
    'Region IV-B',
    'Region V',
    'Region VI',
    'Region VII',
    'Region VIII',
    'Region IX',
    'Region X',
    'Region XI',
    'Region XII',
    'Caraga',
    'BARMM'
  ]);

  if (value && allowed.has(value as PhilippineRegion)) {
    return value as PhilippineRegion;
  }

  return 'NCR';
}

function buildAnalysisResult(payload: AnalyzeResponsePayload, fallbackName: string): AnalysisResult {
  const now = Date.now();
  const scannedPrice = Number(payload.scanned_price ?? 0);
  const fairValue = Number(payload.fairPrice ?? payload.fair_market_value ?? 0);
  const region = toRegion(payload.region);

  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${now}`,
    timestamp: now,
    productName: payload.name || fallbackName || 'Detected Product',
    inputPrice: Number.isFinite(scannedPrice) ? scannedPrice : 0,
    fairValue: Number.isFinite(fairValue) ? fairValue : 0,
    srp: typeof payload.srp_price === 'number' ? payload.srp_price : null,
    status: mapStatus(payload.verdict),
    confidenceScore: 80,
    reasoning: payload.reasoning || 'DeepSeek market analysis completed.',
    priceTrend: 'Stable',
    historicalData: [],
    alternatives: [],
    region,
    currency: 'PHP',
    compliance: {
      isVatInclusive: true,
      withinSrp: true,
      priceCeiling: null
    },
    priceLines: payload.price_lines || []
  };
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

export async function analyzeProductPrice(input: ProductInput): Promise<AnalysisResult> {
  const payload = await postJson<AnalyzeResponsePayload>('/api/analyze', {
    name: input.name,
    price: Number(input.price),
    region: input.region,
    prompt: PRISM_MASTER_PROMPT,
    show_price: true
  });

  return buildAnalysisResult(payload, input.name);
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export async function analyzeRawProductText(input: BasicInput): Promise<AnalysisResult> {
  if (input.image) {
    const formData = new FormData();
    formData.append('image', base64ToBlob(input.image, 'image/jpeg'), 'capture.jpg');
    formData.append('prompt', PRISM_MASTER_PROMPT);
    formData.append('show_price', 'true');
    if (input.text.trim()) {
      formData.append('name_hint', input.text.trim());
    }

    const response = await fetch('/api/analyze-image', {
      method: 'POST',
      body: formData
    });

    const raw = await response.text();
    const payload = parseJsonSafe(raw) as AnalyzeImagePayload & { message?: string };
    if (!response.ok) {
      throw new Error(payload.message || 'Image analysis failed.');
    }

    const market = payload.market_analysis || {};
    const mapped = buildAnalysisResult(
      {
        ...market,
        price_lines: payload.price_lines || market.price_lines
      },
      input.text || 'Detected Product'
    );
    return mapped;
  }

  const payload = await postJson<AnalyzeResponsePayload>('/api/analyze', {
    name: input.text,
    region: 'NCR',
    prompt: PRISM_MASTER_PROMPT,
    show_price: true
  });
  return buildAnalysisResult(payload, input.text);
}

export async function transcribeAudio(base64Audio: string, mimeType: string, language: string): Promise<TranscribePayload> {
  return postJson<TranscribePayload>('/api/analyze/transcribe-audio', {
    audio_base64: base64Audio,
    mime_type: mimeType,
    language
  });
}

export async function extractPriceLines(text: string): Promise<string[]> {
  const payload = await postJson<{ price_lines?: string[] }>('/api/analyze/extract-price-lines', { text });
  return payload.price_lines || [];
}

