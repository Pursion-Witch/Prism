import axios, { isAxiosError } from 'axios';
import {
  PRISM_PRICE_EXTRACTION_FALLBACK_LINE,
  PRISM_PRICE_EXTRACTION_LINE_FORMAT,
  PRISM_PRICE_EXTRACTION_MASTER_PROMPT
} from '../prompts/prismPriceExtractionPrompt';
import { getDeepseekTextModelCandidates } from './deepseekModelService';
import { requireEnv, sanitizeText } from './serviceUtils';

const EXTRACTION_TIMEOUT_MS = Number(process.env.AI_PRICE_EXTRACTION_TIMEOUT_MS ?? 12000);

export interface PriceExtractionLine {
  product_name: string;
  price: number;
  currency: string;
  unit: string;
  basis: 'actual' | 'estimate';
  source_note: string;
  raw_line: string;
}

export interface PriceExtractionResult {
  raw_output: string;
  lines: string[];
  parsed: PriceExtractionLine[];
  model: string | null;
}

function normalizeCurrency(value: string): string {
  const normalized = sanitizeText(value).toUpperCase();
  if (!normalized) {
    return 'PHP';
  }

  if (normalized === '\u20B1' || normalized === 'P' || normalized === 'PESO' || normalized === 'PESO(S)') {
    return 'PHP';
  }

  return normalized;
}

function normalizeUnit(value: string): string {
  const normalized = sanitizeText(value);
  return normalized || 'unit';
}

function normalizeBasis(value: string): 'actual' | 'estimate' {
  return sanitizeText(value).toLowerCase() === 'actual' ? 'actual' : 'estimate';
}

function toFixed2(value: number): number {
  return Number(value.toFixed(2));
}

function parseLine(rawLine: string): PriceExtractionLine | null {
  const line = sanitizeText(rawLine);
  if (!line || !line.includes('|')) {
    return null;
  }

  const parts = line.split('|').map((segment) => sanitizeText(segment));
  if (parts.length < 6) {
    return null;
  }

  const product = parts[0] || 'unknown';
  const parsedPrice = Number(parts[1]);
  const price = Number.isFinite(parsedPrice) && parsedPrice >= 0 ? toFixed2(parsedPrice) : 0;
  const currency = normalizeCurrency(parts[2] || 'PHP');
  const unit = normalizeUnit(parts[3] || 'unit');
  const basis = normalizeBasis(parts[4] || 'estimate');
  const sourceNote = sanitizeText(parts.slice(5).join(' | ')) || 'source unavailable';

  const normalizedLine = [product, price.toFixed(2), currency, unit, basis, sourceNote].join('|');

  return {
    product_name: product,
    price,
    currency,
    unit,
    basis,
    source_note: sourceNote,
    raw_line: normalizedLine
  };
}

function parseLines(rawOutput: string): PriceExtractionLine[] {
  const lines = sanitizeText(rawOutput)
    .split(/\r?\n/)
    .map((line) => sanitizeText(line))
    .filter(Boolean);

  const parsed = lines
    .map((line) => parseLine(line))
    .filter((entry): entry is PriceExtractionLine => entry !== null);

  if (parsed.length > 0) {
    return parsed;
  }

  const fallback = parseLine(PRISM_PRICE_EXTRACTION_FALLBACK_LINE);
  return fallback ? [fallback] : [];
}

async function requestExtraction(text: string, model: string): Promise<string> {
  const response = await axios.post(
    'https://api.deepseek.com/v1/chat/completions',
    {
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: PRISM_PRICE_EXTRACTION_MASTER_PROMPT
        },
        {
          role: 'user',
          content: text
        }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${requireEnv('DEEPSEEK_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      timeout: EXTRACTION_TIMEOUT_MS
    }
  );

  const content = response.data?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}

function buildFallbackResult(): PriceExtractionResult {
  const fallback = parseLine(PRISM_PRICE_EXTRACTION_FALLBACK_LINE);
  const parsed = fallback ? [fallback] : [];
  return {
    raw_output: PRISM_PRICE_EXTRACTION_FALLBACK_LINE,
    lines: parsed.map((entry) => entry.raw_line),
    parsed,
    model: null
  };
}

export async function extractPriceLinesFromText(inputText: string): Promise<PriceExtractionResult> {
  const text = sanitizeText(inputText);
  if (!text) {
    return buildFallbackResult();
  }

  const models = getDeepseekTextModelCandidates();
  const failures: string[] = [];

  for (const model of models) {
    try {
      const rawOutput = sanitizeText(await requestExtraction(text, model));
      if (!rawOutput) {
        failures.push(`${model}: empty output`);
        continue;
      }

      const parsed = parseLines(rawOutput);
      if (!parsed.length) {
        failures.push(`${model}: invalid format`);
        continue;
      }

      return {
        raw_output: rawOutput,
        lines: parsed.map((entry) => entry.raw_line),
        parsed,
        model
      };
    } catch (error) {
      if (isAxiosError(error)) {
        const status = error.response?.status;
        failures.push(`${model}: request failed${status ? ` (${status})` : ''}`);
      } else if (error instanceof Error) {
        failures.push(`${model}: ${error.message}`);
      } else {
        failures.push(`${model}: unknown error`);
      }
    }
  }

  if (failures.length) {
    console.warn(
      `Price extraction fallback used. Expected line format: ${PRISM_PRICE_EXTRACTION_LINE_FORMAT}. ${failures.join(
        ' | '
      )}`
    );
  }

  return buildFallbackResult();
}


