import axios, { isAxiosError } from 'axios';
import { parseJsonResponse, requireEnv, sanitizeText } from './serviceUtils';
import {
  DEFAULT_CATEGORY,
  DEFAULT_MARKET_NAME,
  DEFAULT_REGION,
  defaultStallNameFromIndex
} from '../constants/cebuDefaults';

export interface ImportedProductEntry {
  name: string;
  category: string;
  brand_name: string | null;
  market_name: string;
  stall_name: string;
  region: string;
  srp_price: number;
}

const MAX_IMPORT_ITEMS = 200;

function normalizePositivePrice(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Number(parsed.toFixed(2));
}

function safeText(value: unknown): string {
  return typeof value === 'string' ? sanitizeText(value) : '';
}

function normalizeEntry(raw: Record<string, unknown>, fallbackIndex: number): ImportedProductEntry | null {
  const name = safeText(raw.name ?? raw.product_name ?? raw.item);
  const category = safeText(raw.category) || DEFAULT_CATEGORY;
  const brandName = safeText(raw.brand_name ?? raw.brand) || null;
  const region = safeText(raw.region) || DEFAULT_REGION;
  const marketName = safeText(raw.market_name ?? raw.market) || DEFAULT_MARKET_NAME;
  const stallName = safeText(raw.stall_name ?? raw.stall) || defaultStallNameFromIndex(fallbackIndex);
  const srpPrice = normalizePositivePrice(raw.srp_price ?? raw.price ?? raw.average_price);

  if (!name || !srpPrice) {
    return null;
  }

  return {
    name,
    category,
    brand_name: brandName,
    market_name: marketName,
    stall_name: stallName,
    region,
    srp_price: srpPrice
  };
}

function validateAiPayload(payload: unknown): ImportedProductEntry[] {
  let rows: unknown[] = [];

  if (Array.isArray(payload)) {
    rows = payload;
  } else if (payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).products)) {
    rows = (payload as Record<string, unknown>).products as unknown[];
  } else {
    throw new Error('AI import response did not contain a products array.');
  }

  const entries = rows
    .map((row, index) => (row && typeof row === 'object' && !Array.isArray(row) ? normalizeEntry(row as Record<string, unknown>, index) : null))
    .filter((entry): entry is ImportedProductEntry => entry !== null);

  if (!entries.length) {
    throw new Error('AI import response returned no valid products.');
  }

  return entries.slice(0, MAX_IMPORT_ITEMS);
}

function buildImportPrompt(): string {
  return [
    'You extract product rows from Cebu pricing documents.',
    'Return JSON only. No markdown. No extra text.',
    'Preferred output schema:',
    '{',
    '  "products": [',
    '    {',
    '      "name": "string",',
    '      "category": "string",',
    '      "brand_name": "string | null",',
    '      "market_name": "string",',
    '      "stall_name": "string",',
    '      "region": "string",',
    '      "srp_price": number',
    '    }',
    '  ]',
    '}',
    'Rules:',
    '- Keep region as Cebu City when not explicitly provided.',
    '- Infer Cebu market/stall names when possible from context.',
    '- srp_price must be a positive number.',
    '- Ignore rows with missing product name or missing price.'
  ].join('\n');
}

function parseDelimitedLine(line: string, index: number): ImportedProductEntry | null {
  const cleaned = line.trim();
  if (!cleaned) {
    return null;
  }

  const csvParts = cleaned.split(',').map((part) => part.trim());
  if (csvParts.length >= 2) {
    const candidate = normalizeEntry(
      {
        name: csvParts[0],
        srp_price: csvParts[1]?.replace(/php\s*/i, ''),
        category: csvParts[2] || DEFAULT_CATEGORY,
        brand_name: csvParts[3] || null,
        market_name: csvParts[4] || DEFAULT_MARKET_NAME,
        stall_name: csvParts[5] || defaultStallNameFromIndex(index),
        region: csvParts[6] || DEFAULT_REGION
      },
      index
    );

    if (candidate) {
      return candidate;
    }
  }

  const match = cleaned.match(/^(.+?)\s*[:|\-]\s*(?:php\s*)?([0-9][0-9,]*(?:\.[0-9]{1,2})?)$/i);
  if (!match) {
    return null;
  }

  return normalizeEntry(
    {
      name: match[1],
      srp_price: match[2].replace(/,/g, ''),
      category: DEFAULT_CATEGORY,
      market_name: DEFAULT_MARKET_NAME,
      region: DEFAULT_REGION
    },
    index
  );
}

function parseFallbackRows(documentText: string): ImportedProductEntry[] {
  const normalizedText = documentText.trim();
  if (!normalizedText) {
    return [];
  }

  try {
    const jsonPayload = JSON.parse(normalizedText);
    if (Array.isArray(jsonPayload)) {
      return jsonPayload
        .map((row, index) =>
          row && typeof row === 'object' && !Array.isArray(row) ? normalizeEntry(row as Record<string, unknown>, index) : null
        )
        .filter((entry): entry is ImportedProductEntry => entry !== null)
        .slice(0, MAX_IMPORT_ITEMS);
    }
  } catch {
    // Not JSON, continue with line parsing.
  }

  const dedupe = new Map<string, ImportedProductEntry>();

  const lines = normalizedText.split(/\r?\n/);
  lines.forEach((line, index) => {
    const entry = parseDelimitedLine(line, index);
    if (!entry) {
      return;
    }

    const key = `${entry.name.toLowerCase()}|${entry.region.toLowerCase()}|${entry.market_name.toLowerCase()}|${entry.stall_name.toLowerCase()}`;
    dedupe.set(key, entry);
  });

  return [...dedupe.values()].slice(0, MAX_IMPORT_ITEMS);
}

export async function extractProductsFromDocument(
  documentText: string
): Promise<{ entries: ImportedProductEntry[]; source: 'ai' | 'fallback' }> {
  const trimmed = documentText.trim();
  if (!trimmed) {
    throw new Error('Document content is empty.');
  }

  try {
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: buildImportPrompt()
          },
          {
            role: 'user',
            content: JSON.stringify({
              region_hint: DEFAULT_REGION,
              document_text: trimmed.slice(0, 15000)
            })
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${requireEnv('DEEPSEEK_API_KEY')}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('AI import response is empty.');
    }

    const parsed = parseJsonResponse(content);
    return { entries: validateAiPayload(parsed), source: 'ai' };
  } catch (error) {
    const fallbackEntries = parseFallbackRows(trimmed);
    if (fallbackEntries.length > 0) {
      return { entries: fallbackEntries, source: 'fallback' };
    }

    if (isAxiosError(error)) {
      const status = error.response?.status;
      const details = status ? `status ${status}` : 'network failure';
      throw new Error(`Product import service unavailable (${details}).`);
    }

    if (error instanceof SyntaxError) {
      throw new Error('Product import AI returned malformed JSON.');
    }

    if (error instanceof Error) {
      throw new Error(`Product import failed: ${error.message}`);
    }

    throw new Error('Product import failed due to an unknown error.');
  }
}
