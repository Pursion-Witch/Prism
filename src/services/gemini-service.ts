interface GeminiGeneratePart {
  text?: string;
}

interface GeminiGenerateCandidate {
  content?: {
    parts?: GeminiGeneratePart[];
  };
}

interface GeminiGenerateResponse {
  candidates?: GeminiGenerateCandidate[];
}

export interface GeminiPriceInsight {
  fairValue: number;
  confidenceScore: number;
  summary: string;
  category?: string;
}

interface GeminiPriceInput {
  name: string;
  price: number;
  region: string;
  category: string;
  historicalAverage?: number;
  rawText?: string;
}

interface GeminiParsedPayload {
  fairValue?: unknown;
  confidenceScore?: unknown;
  summary?: unknown;
  category?: unknown;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseJsonObject<T>(raw: string): T | null {
  const cleaned = raw.trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // continue
  }

  const fencedMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    try {
      return JSON.parse(fencedMatch[1].trim()) as T;
    } catch {
      // continue
    }
  }

  const firstCurly = cleaned.indexOf('{');
  const lastCurly = cleaned.lastIndexOf('}');
  if (firstCurly >= 0 && lastCurly > firstCurly) {
    try {
      return JSON.parse(cleaned.slice(firstCurly, lastCurly + 1)) as T;
    } catch {
      return null;
    }
  }

  return null;
}

function buildPrompt(input: GeminiPriceInput): string {
  return [
    'Analyze this product price for a Philippine market-price intelligence app.',
    'Return strict JSON only with keys: fairValue, confidenceScore, summary, category.',
    'confidenceScore must be 0-100.',
    JSON.stringify({
      productName: input.name,
      observedPrice: input.price,
      region: input.region,
      category: input.category,
      historicalAverage: input.historicalAverage ?? null,
      rawText: input.rawText ?? null
    })
  ].join(' ');
}

function normalizeInsight(parsed: GeminiParsedPayload): GeminiPriceInsight | null {
  const fairValueRaw = Number(parsed.fairValue);
  const confidenceRaw = Number(parsed.confidenceScore);
  if (!Number.isFinite(fairValueRaw) || fairValueRaw <= 0) {
    return null;
  }
  if (!Number.isFinite(confidenceRaw)) {
    return null;
  }

  const summary =
    typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim()
      : 'Gemini provided a market comparison.';
  const category =
    typeof parsed.category === 'string' && parsed.category.trim()
      ? parsed.category.trim()
      : undefined;

  return {
    fairValue: Number(fairValueRaw.toFixed(2)),
    confidenceScore: Number(clamp(confidenceRaw, 1, 100).toFixed(2)),
    summary,
    category
  };
}

export async function requestGeminiPriceInsight(input: GeminiPriceInput): Promise<GeminiPriceInsight | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-2.0-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Number(process.env.GEMINI_TIMEOUT_MS ?? 12000));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: buildPrompt(input) }]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json'
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as GeminiGenerateResponse;
    const rawText = payload.candidates?.[0]?.content?.parts
      ?.map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join(' ')
      .trim();

    if (!rawText) {
      return null;
    }

    const parsed = parseJsonObject<GeminiParsedPayload>(rawText);
    if (!parsed) {
      return null;
    }

    return normalizeInsight(parsed);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
