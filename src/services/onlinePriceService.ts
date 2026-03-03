import axios from 'axios';
import { sanitizeText } from './serviceUtils';
import { inferPriceNormalization } from './unitNormalizationService';

export interface OnlinePriceLookupResult {
  average_price: number;
  sample_count: number;
  sample_prices: number[];
  source: string;
  queries: string[];
}

const DEFAULT_TIMEOUT_MS = Number(process.env.ONLINE_PRICE_LOOKUP_TIMEOUT_MS ?? 7000);
const DEFAULT_USD_TO_PHP_RATE = Number(
  process.env.ONLINE_PRICE_USD_TO_PHP_RATE ?? process.env.USD_TO_PHP_RATE ?? 56
);
const MAX_PRICE_SAMPLES = 60;
const MAX_PRICE_VALUE = 200000;
const MIN_PRICE_VALUE = 1;

interface ExtractedPriceSample {
  price: number;
  context: string;
}

function toMoneyNumber(raw: string): number | null {
  const parsed = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(parsed) || parsed < MIN_PRICE_VALUE || parsed > MAX_PRICE_VALUE) {
    return null;
  }

  return Number(parsed.toFixed(2));
}

function extractContext(raw: string, matchIndex: number, matchLength: number): string {
  const startIndex = Math.max(0, matchIndex - 80);
  const endIndex = Math.min(raw.length, matchIndex + matchLength + 80);
  return raw.slice(startIndex, endIndex);
}

function extractPhpPrices(raw: string): ExtractedPriceSample[] {
  const matches: ExtractedPriceSample[] = [];
  const phpPattern = /(?:\u20B1|₱|PHP|Php|php|P)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/g;

  let match = phpPattern.exec(raw);
  while (match) {
    const parsed = toMoneyNumber(match[1] ?? '');
    if (parsed !== null) {
      matches.push({
        price: parsed,
        context: extractContext(raw, match.index ?? 0, match[0]?.length ?? 0)
      });
    }
    match = phpPattern.exec(raw);
  }

  return matches;
}

function extractUsdPrices(raw: string): ExtractedPriceSample[] {
  const matches: ExtractedPriceSample[] = [];
  const usdPattern = /(?:US\$|USD|\$)\s*([0-9]{1,4}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/g;

  let match = usdPattern.exec(raw);
  while (match) {
    const parsed = toMoneyNumber(match[1] ?? '');
    if (parsed !== null) {
      matches.push({
        price: parsed,
        context: extractContext(raw, match.index ?? 0, match[0]?.length ?? 0)
      });
    }
    match = usdPattern.exec(raw);
  }

  return matches;
}

function extractFallbackPrices(raw: string): ExtractedPriceSample[] {
  const matches: ExtractedPriceSample[] = [];
  const pattern = /([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)\s*(?:pesos?|peso|per\s*kg|\/kg|each|ea)/gi;

  let match = pattern.exec(raw);
  while (match) {
    const parsed = toMoneyNumber(match[1] ?? '');
    if (parsed !== null) {
      matches.push({
        price: parsed,
        context: extractContext(raw, match.index ?? 0, match[0]?.length ?? 0)
      });
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
    `${normalizedName} SRP Philippines`,
    `${normalizedName} price per pack USD`
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

function normalizePriceSampleToSingleUnit(sample: ExtractedPriceSample, itemName: string): number {
  const normalization = inferPriceNormalization(sample.context, itemName, sample.price);
  if (normalization.normalized_price > 0) {
    return normalization.normalized_price;
  }

  return sample.price;
}

function convertUsdToPhp(amountUsd: number): number {
  const safeRate = Number.isFinite(DEFAULT_USD_TO_PHP_RATE) && DEFAULT_USD_TO_PHP_RATE > 0 ? DEFAULT_USD_TO_PHP_RATE : 56;
  return Number((amountUsd * safeRate).toFixed(2));
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
  const phpPerItemPrices: number[] = [];
  const usdPerItemPrices: number[] = [];

  for (const page of htmlPages) {
    if (!page) {
      continue;
    }

    const directPhpMatches = extractPhpPrices(page);
    phpPerItemPrices.push(...directPhpMatches.map((sample) => normalizePriceSampleToSingleUnit(sample, name)));

    if (directPhpMatches.length < 3) {
      const fallbackPhpMatches = extractFallbackPrices(page);
      phpPerItemPrices.push(...fallbackPhpMatches.map((sample) => normalizePriceSampleToSingleUnit(sample, name)));
    }

    if (!directPhpMatches.length) {
      const usdMatches = extractUsdPrices(page);
      usdPerItemPrices.push(...usdMatches.map((sample) => normalizePriceSampleToSingleUnit(sample, name)));
    }
  }

  const validPhpPrices = phpPerItemPrices.filter((value) => Number.isFinite(value) && value > 0);
  if (validPhpPrices.length) {
    const deduped = [...new Set(validPhpPrices)].slice(0, MAX_PRICE_SAMPLES);
    const cleaned = trimOutliers(deduped);
    const average = computeAverage(cleaned);

    if (average === null) {
      return null;
    }

    return {
      average_price: average,
      sample_count: cleaned.length,
      sample_prices: cleaned,
      source: 'duckduckgo-html-php',
      queries
    };
  }

  const validUsdPrices = usdPerItemPrices.filter((value) => Number.isFinite(value) && value > 0);
  if (!validUsdPrices.length) {
    return null;
  }

  const lowestUsdPerItem = Math.min(...validUsdPrices);
  const convertedLowestPhpPerItem = convertUsdToPhp(lowestUsdPerItem);

  return {
    average_price: convertedLowestPhpPerItem,
    sample_count: 1,
    sample_prices: [convertedLowestPhpPerItem],
    source: 'duckduckgo-html-usd-lowest-converted',
    queries
  };
}