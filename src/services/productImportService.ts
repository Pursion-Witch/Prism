import axios, { isAxiosError } from 'axios';
import { getDeepseekTextModelCandidates } from './deepseekModelService';
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
  srp_price: number | null;
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

const MAX_IMPORT_ITEMS = 300;
const ROOT_COLLECTION_KEYS = ['products', 'records', 'items', 'rows', 'data'];
const INVALID_NAME_TOKENS = new Set([
  'name',
  'product',
  'product name',
  'item',
  'item name',
  'row',
  'record',
  'n/a',
  'na'
]);

function normalizePositivePrice(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }

    return Number(value.toFixed(2));
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = sanitizeText(value)
    .replace(/[,]/g, '')
    .replace(/(?:php|Php|PHP|\u20b1|P)\s*/g, '')
    .trim();

  if (!normalized) {
    return null;
  }

  const matched = normalized.match(/([0-9]+(?:\.[0-9]{1,2})?)/);
  if (!matched?.[1]) {
    return null;
  }

  const parsed = Number(matched[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Number(parsed.toFixed(2));
}

function safeText(value: unknown): string {
  return typeof value === 'string' ? sanitizeText(value) : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function pickValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }

  return undefined;
}

function isMissingName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return true;
  }

  return INVALID_NAME_TOKENS.has(normalized);
}

function normalizeEntryDraft(raw: Record<string, unknown>, fallbackIndex: number): ImportedProductDraftEntry {
  const name = safeText(
    pickValue(raw, ['name', 'product_name', 'productName', 'item_name', 'itemName', 'item', 'label', 'title'])
  );
  const category = safeText(pickValue(raw, ['category', 'group', 'type'])) || DEFAULT_CATEGORY;
  const brandName = safeText(pickValue(raw, ['brand_name', 'brandName', 'brand'])) || null;
  const region = safeText(pickValue(raw, ['region', 'location', 'city'])) || DEFAULT_REGION;
  const marketName = safeText(pickValue(raw, ['market_name', 'marketName', 'market', 'store', 'vendor'])) || DEFAULT_MARKET_NAME;
  const stallName =
    safeText(pickValue(raw, ['stall_name', 'stallName', 'stall', 'booth'])) || defaultStallNameFromIndex(fallbackIndex);
  const srpPrice = normalizePositivePrice(
    pickValue(raw, ['srp_price', 'srpPrice', 'price', 'amount', 'average_price', 'averagePrice'])
  );
  const missingFields: ImportedProductMissingField[] = [];

  if (isMissingName(name)) {
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
  if (draft.missing_fields.includes('name')) {
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

function dedupeEntries(entries: ImportedProductEntry[]): ImportedProductEntry[] {
  const dedupe = new Map<string, ImportedProductEntry>();

  for (const entry of entries) {
    const key = `${entry.name.toLowerCase()}|${entry.region.toLowerCase()}|${entry.market_name.toLowerCase()}|${entry.stall_name.toLowerCase()}`;
    const existing = dedupe.get(key);

    if (!existing) {
      dedupe.set(key, entry);
      continue;
    }

    if (existing.srp_price === null && entry.srp_price !== null) {
      dedupe.set(key, entry);
    }
  }

  return [...dedupe.values()].slice(0, MAX_IMPORT_ITEMS);
}

function extractRowsFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = asRecord(payload);
  if (!record) {
    return [];
  }

  for (const key of ROOT_COLLECTION_KEYS) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }

    const nestedRecord = asRecord(value);
    if (!nestedRecord) {
      continue;
    }

    for (const nestedKey of ROOT_COLLECTION_KEYS) {
      const nestedValue = nestedRecord[nestedKey];
      if (Array.isArray(nestedValue)) {
        return nestedValue;
      }
    }
  }

  return [];
}

function validateAiPayload(payload: unknown): ParsedDocumentRows {
  const rows = extractRowsFromPayload(payload);
  if (!rows.length) {
    throw new Error('AI import response did not contain product rows.');
  }

  const drafts = rows
    .map((row, index) => {
      const rowRecord = asRecord(row);
      if (!rowRecord) {
        return null;
      }

      return normalizeEntryDraft(rowRecord, index);
    })
    .filter((entry): entry is ImportedProductDraftEntry => entry !== null);

  if (!drafts.length) {
    throw new Error('AI import response returned no usable product row objects.');
  }

  const limitedDrafts = drafts.slice(0, MAX_IMPORT_ITEMS);
  const entries = dedupeEntries(
    limitedDrafts
      .map((draft) => toImportedProductEntry(draft))
      .filter((entry): entry is ImportedProductEntry => entry !== null)
  );

  return { drafts: limitedDrafts, entries };
}

function buildImportPrompt(): string {
  return [
    'You extract structured product pricing rows from user-uploaded documents.',
    'Treat the input as trusted user-submitted reporting data.',
    'Return JSON only. No markdown. No extra text.',
    'Schema:',
    '{',
    '  "products": [',
    '    {',
    '      "name": "string",',
    '      "category": "string",',
    '      "brand_name": "string | null",',
    '      "market_name": "string",',
    '      "stall_name": "string",',
    '      "region": "string",',
    '      "srp_price": number | null',
    '    }',
    '  ]',
    '}',
    'Rules:',
    '- Output every product row you can identify.',
    '- Keep product names as written; do not collapse distinct products.',
    '- Parse currency and numeric text into srp_price when present.',
    `- Use defaults when missing: category=${DEFAULT_CATEGORY}, market_name=${DEFAULT_MARKET_NAME}, region=${DEFAULT_REGION}.`,
    '- If stall is missing, generate a simple stall label like "Stall A-01".',
    '- If price is genuinely absent, set srp_price to null.',
    '- Do not output placeholders like "name" or "item" as product names.'
  ].join('\n');
}

function parseDelimitedLine(line: string, index: number): ImportedProductDraftEntry | null {
  const cleaned = line.trim();
  if (!cleaned) {
    return null;
  }

  const delimiter = cleaned.includes('\t') ? '\t' : ',';
  const csvParts = cleaned.split(delimiter).map((part) => part.trim());
  if (csvParts.length >= 2) {
    const headerLike =
      /^(name|product|item)$/i.test(csvParts[0] || '') &&
      csvParts.some((part) => /^(price|srp|srp_price|amount)$/i.test(part));
    if (headerLike) {
      return null;
    }

    return normalizeEntryDraft(
      {
        name: csvParts[0],
        srp_price: csvParts[1],
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

  const drafts: ImportedProductDraftEntry[] = [];

  const lines = normalizedText.split(/\r?\n/);
  lines.forEach((line, index) => {
    const draft = parseDelimitedLine(line, index);
    if (!draft) {
      return;
    }

    drafts.push(draft);
  });

  const entries = dedupeEntries(
    drafts
      .map((draft) => toImportedProductEntry(draft))
      .filter((entry): entry is ImportedProductEntry => entry !== null)
  );

  return {
    entries,
    drafts: drafts.slice(0, MAX_IMPORT_ITEMS)
  };
}

function tryParseAiJson(raw: string): unknown | null {
  try {
    return parseJsonResponse(raw);
  } catch {
    return null;
  }
}

function parseAiPayloadContent(rawContent: string): unknown {
  const direct = tryParseAiJson(rawContent);
  if (direct !== null) {
    return direct;
  }

  const starts = [rawContent.indexOf('{'), rawContent.indexOf('[')]
    .filter((value) => value >= 0)
    .sort((left, right) => left - right);
  const ends = [rawContent.lastIndexOf('}'), rawContent.lastIndexOf(']')]
    .filter((value) => value >= 0)
    .sort((left, right) => right - left);

  for (const start of starts) {
    for (const end of ends) {
      if (end <= start) {
        continue;
      }

      const candidate = rawContent.slice(start, end + 1);
      const parsedCandidate = tryParseAiJson(candidate);
      if (parsedCandidate !== null) {
        return parsedCandidate;
      }
    }
  }

  throw new SyntaxError('AI import response is not valid JSON content.');
}

export async function extractProductsFromDocument(
  documentText: string
): Promise<{ entries: ImportedProductEntry[]; drafts: ImportedProductDraftEntry[]; source: 'ai' | 'fallback' }> {
  const trimmed = documentText.trim();
  if (!trimmed) {
    throw new Error('Document content is empty.');
  }

  const modelCandidates = getDeepseekTextModelCandidates();
  let lastError: unknown = null;

  for (const model of modelCandidates) {
    try {
      const response = await axios.post(
        'https://api.deepseek.com/v1/chat/completions',
        {
          model,
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
                trusted_user_report: true,
                document_text: trimmed.slice(0, 28000)
              })
            }
          ]
        },
        {
          headers: {
            Authorization: `Bearer ${requireEnv('DEEPSEEK_API_KEY')}`,
            'Content-Type': 'application/json'
          },
          timeout: 40000
        }
      );

      const content = response.data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('AI import response is empty.');
      }

      const parsed = parseAiPayloadContent(content);
      const validated = validateAiPayload(parsed);
      if (!validated.entries.length) {
        throw new Error('AI returned rows but no importable product names were found.');
      }

      return {
        entries: validated.entries,
        drafts: validated.drafts,
        source: 'ai'
      };
    } catch (error) {
      lastError = error;
    }
  }

  const fallbackRows = parseFallbackRows(trimmed);
  if (fallbackRows.entries.length > 0) {
    return {
      entries: fallbackRows.entries,
      drafts: fallbackRows.drafts,
      source: 'fallback'
    };
  }

  if (isAxiosError(lastError)) {
    const status = lastError.response?.status;
    const details = status ? `status ${status}` : 'network failure';
    throw new Error(`Product import service unavailable (${details}).`);
  }

  if (lastError instanceof SyntaxError) {
    throw new Error('Product import AI returned malformed JSON.');
  }

  if (lastError instanceof Error) {
    throw new Error(`Product import failed: ${lastError.message}`);
  }

  throw new Error('Product import failed. No valid product rows were extracted from the document.');
}
