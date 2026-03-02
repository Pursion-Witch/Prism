import axios from 'axios';
import { sanitizeText } from './serviceUtils';

export interface OnlinePriceLookupResult {
  average_price: number;
  sample_count: number;
  sample_prices: number[];
  source: string;
  queries: string[];
}

const DEFAULT_TIMEOUT_MS = Number(process.env.ONLINE_PRICE_LOOKUP_TIMEOUT_MS ?? 7000);
const MAX_PRICE_SAMPLES = 60;
const MAX_PRICE_VALUE = 200000;
const MIN_PRICE_VALUE = 1;

function toMoneyNumber(raw: string): number | null {
  const parsed = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(parsed) || parsed < MIN_PRICE_VALUE || parsed > MAX_PRICE_VALUE) {
    return null;
  }

  return Number(parsed.toFixed(2));
}

function extractPhpPrices(raw: string): number[] {
  const matches: number[] = [];
  const phpPattern = /(?:₱|PHP|Php|php|P)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/g;

  let match = phpPattern.exec(raw);
  while (match) {
    const parsed = toMoneyNumber(match[1] ?? '');
    if (parsed !== null) {
      matches.push(parsed);
    }
    match = phpPattern.exec(raw);
  }

  return matches;
}

function extractFallbackPrices(raw: string): number[] {
  const matches: number[] = [];
  const pattern = /([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)\s*(?:pesos?|peso|per\s*kg|\/kg|each|ea)/gi;

  let match = pattern.exec(raw);
  while (match) {
    const parsed = toMoneyNumber(match[1] ?? '');
    if (parsed !== null) {
      matches.push(parsed);
    }
    match = pattern.exec(raw);
  }

  return matches;
}

function buildQueries(name: string, region: string): string[] {
  const normalizedName = sanitizeText(name);
  const normalizedRegion = sanitizeText(region) || 'Philippines';

  return [
    `${normalizedName} average price ${normalizedRegion} Philippines PHP`,
    `${normalizedName} market price Philippines PHP`,
    `${normalizedName} SRP Philippines`
  ];
}

function trimOutliers(values: number[]): number[] {
  if (values.length < 6) {
    return values;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const trimCount = Math.floor(sorted.length * 0.2);
  const end = sorted.length - trimCount;

  if (trimCount <= 0 || end <= trimCount) {
    return sorted;
  }

  return sorted.slice(trimCount, end);
}

function computeAverage(values: number[]): number | null {
  if (!values.length) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(2));
}

async function fetchSearchHtml(query: string, timeoutMs: number): Promise<string | null> {
  try {
    const response = await axios.get('https://duckduckgo.com/html/', {
      params: { q: query },
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'PRISM Price Agent/1.0'
      }
    });

    if (typeof response.data !== 'string') {
      return null;
    }

    return response.data;
  } catch {
    return null;
  }
}

export async function lookupAveragePriceOnline(name: string, region: string): Promise<OnlinePriceLookupResult | null> {
  const queries = buildQueries(name, region);
  const timeoutMs = Number.isFinite(DEFAULT_TIMEOUT_MS) && DEFAULT_TIMEOUT_MS > 0 ? DEFAULT_TIMEOUT_MS : 7000;

  const htmlPages = await Promise.all(queries.map((query) => fetchSearchHtml(query, timeoutMs)));
  const allPrices: number[] = [];

  for (const page of htmlPages) {
    if (!page) {
      continue;
    }

    const directMatches = extractPhpPrices(page);
    allPrices.push(...directMatches);

    if (directMatches.length < 3) {
      allPrices.push(...extractFallbackPrices(page));
    }
  }

  if (!allPrices.length) {
    return null;
  }

  const deduped = [...new Set(allPrices)].slice(0, MAX_PRICE_SAMPLES);
  const cleaned = trimOutliers(deduped);
  const average = computeAverage(cleaned);

  if (average === null) {
    return null;
  }

  return {
    average_price: average,
    sample_count: cleaned.length,
    sample_prices: cleaned,
    source: 'duckduckgo-html',
    queries
  };
}
