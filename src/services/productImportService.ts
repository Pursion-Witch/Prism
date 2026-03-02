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

export type ImportedProductMissingField = 'name' | 'srp_price';

export interface ImportedProductDraftEntry {
  row_index: number;
  name: string;
  category: string;
  brand_name: string | null;
  market_name: string;
  stall_name: string;
  region: string;
  srp_price: number | null;
  missing_fields: ImportedProductMissingField[];
  raw_record: Record<string, unknown> | string;
}

interface ParsedDocumentRows {
  entries: ImportedProductEntry[];
  drafts: ImportedProductDraftEntry[];
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

function normalizeEntryDraft(raw: Record<string, unknown>, fallbackIndex: number): ImportedProductDraftEntry {
  const name = safeText(raw.name ?? raw.product_name ?? raw.item);
  const category = safeText(raw.category) || DEFAULT_CATEGORY;
  const brandName = safeText(raw.brand_name ?? raw.brand) || null;
  const region = safeText(raw.region) || DEFAULT_REGION;
  const marketName = safeText(raw.market_name ?? raw.market) || DEFAULT_MARKET_NAME;
  const stallName = safeText(raw.stall_name ?? raw.stall) || defaultStallNameFromIndex(fallbackIndex);
  const srpPrice = normalizePositivePrice(raw.srp_price ?? raw.price ?? raw.average_price);
  const missingFields: ImportedProductMissingField[] = [];

  if (!name) {
    missingFields.push('name');
  }
  if (!srpPrice) {
    missingFields.push('srp_price');
  }

  return {
    row_index: fallbackIndex,
    name,
    category,
    brand_name: brandName,
    market_name: marketName,
    stall_name: stallName,
    region,
    srp_price: srpPrice,
    missing_fields: missingFields,
    raw_record: raw
  };
}

function toImportedProductEntry(draft: ImportedProductDraftEntry): ImportedProductEntry | null {
  if (draft.missing_fields.length > 0 || !draft.srp_price) {
    return null;
  }

  return {
    name: draft.name,
    category: draft.category,
    brand_name: draft.brand_name,
    market_name: draft.market_name,
    stall_name: draft.stall_name,
    region: draft.region,
    srp_price: draft.srp_price
  };
}

function validateAiPayload(payload: unknown): ParsedDocumentRows {
  let rows: unknown[] = [];

  if (Array.isArray(payload)) {
    rows = payload;
  } else if (payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>).products)) {
    rows = (payload as Record<string, unknown>).products as unknown[];
  } else {
    throw new Error('AI import response did not contain a products array.');
  }

  const drafts = rows
    .map((row, index) =>
      row && typeof row === 'object' && !Array.isArray(row)
        ? normalizeEntryDraft(row as Record<string, unknown>, index)
        : null
    )
    .filter((entry): entry is ImportedProductDraftEntry => entry !== null);

  if (!drafts.length) {
    throw new Error('AI import response returned no product rows.');
  }

  const limitedDrafts = drafts.slice(0, MAX_IMPORT_ITEMS);
  const entries = limitedDrafts
    .map((draft) => toImportedProductEntry(draft))
    .filter((entry): entry is ImportedProductEntry => entry !== null);

  return { drafts: limitedDrafts, entries };
}

function buildImportPrompt(): string {
  return [
    'You extract product rows from Cebu pricing documents and return every product line found.',
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
    '- srp_price must be a positive number when provided.',
    '- If price is missing, set srp_price to null.',
    '- Never invent product names or prices.'
  ].join('\n');
}

function parseDelimitedLine(line: string, index: number): ImportedProductDraftEntry | null {
  const cleaned = line.trim();
  if (!cleaned) {
    return null;
  }

  const csvParts = cleaned.split(',').map((part) => part.trim());
  if (csvParts.length >= 2) {
    return normalizeEntryDraft(
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
  }

  const match = cleaned.match(/^(.+?)\s*[:|\-]\s*(?:php\s*)?([0-9][0-9,]*(?:\.[0-9]{1,2})?)$/i);
  if (match) {
    return normalizeEntryDraft(
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

  const likelyProductName =
    /^[a-zA-Z][a-zA-Z0-9()\-\/\s]{2,120}$/.test(cleaned) &&
    !/^(name|product|item|price|srp|category|brand|market|stall|region)$/i.test(cleaned);

  if (!likelyProductName) {
    return null;
  }

  return normalizeEntryDraft(
    {
      name: cleaned,
      srp_price: null,
      category: DEFAULT_CATEGORY,
      market_name: DEFAULT_MARKET_NAME,
      region: DEFAULT_REGION
    },
    index
  );
}

function parseFallbackRows(documentText: string): ParsedDocumentRows {
  const normalizedText = documentText.trim();
  if (!normalizedText) {
    return { entries: [], drafts: [] };
  }

  try {
    const jsonPayload = JSON.parse(normalizedText);
    if (Array.isArray(jsonPayload) || (jsonPayload && typeof jsonPayload === 'object')) {
      return validateAiPayload(jsonPayload);
    }
  } catch {
    // Not JSON, continue with line parsing.
  }

  const dedupe = new Map<string, ImportedProductEntry>();
  const drafts: ImportedProductDraftEntry[] = [];

  const lines = normalizedText.split(/\r?\n/);
  lines.forEach((line, index) => {
    const draft = parseDelimitedLine(line, index);
    if (!draft) {
      return;
    }

    drafts.push(draft);
    const entry = toImportedProductEntry(draft);
    if (!entry) {
      return;
    }

    const key = `${entry.name.toLowerCase()}|${entry.region.toLowerCase()}|${entry.market_name.toLowerCase()}|${entry.stall_name.toLowerCase()}`;
    dedupe.set(key, entry);
  });

  return {
    entries: [...dedupe.values()].slice(0, MAX_IMPORT_ITEMS),
    drafts: drafts.slice(0, MAX_IMPORT_ITEMS)
  };
}

export async function extractProductsFromDocument(
  documentText: string
): Promise<{ entries: ImportedProductEntry[]; drafts: ImportedProductDraftEntry[]; source: 'ai' | 'fallback' }> {
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
    const validated = validateAiPayload(parsed);
    return {
      entries: validated.entries,
      drafts: validated.drafts,
      source: 'ai'
    };
  } catch (error) {
    const fallbackRows = parseFallbackRows(trimmed);
    if (fallbackRows.entries.length > 0 || fallbackRows.drafts.length > 0) {
      return {
        entries: fallbackRows.entries,
        drafts: fallbackRows.drafts,
        source: 'fallback'
      };
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
