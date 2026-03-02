import { assessPrice, normalizeItemName } from '../ai';
import { AppError } from '../errors/app-error';
import type { ParsedRawProductText, ProductPriceAnalysisResult } from '../types';
import { requestGeminiPriceInsight } from './gemini-service';

interface AnalyzeProductPriceInput {
  name: string;
  price: number;
  region?: string;
  category?: string;
  historicalAverage?: number | null;
  rawText?: string;
}

interface ParseRawTextOptions {
  category?: string;
}

const CATEGORY_KEYWORDS: Array<{ category: string; pattern: RegExp }> = [
  { category: 'Rice & Grains', pattern: /(rice|bigas|grain|oats|flour)/i },
  { category: 'Meat & Seafood', pattern: /(pork|beef|chicken|fish|seafood|shrimp|liempo)/i },
  { category: 'Vegetables', pattern: /(onion|garlic|vegetable|cabbage|tomato|carrot|talong|okra)/i },
  { category: 'Dairy & Eggs', pattern: /(milk|cheese|butter|yogurt|egg)/i },
  { category: 'Beverages', pattern: /(juice|coffee|tea|soda|water|drink)/i },
  { category: 'Essentials', pattern: /(oil|sugar|salt|vinegar|soy sauce|ketchup)/i },
  { category: 'Canned', pattern: /(sardines|corned|tuna|canned|luncheon)/i }
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toSafeAmount(value: number): number {
  return Number(Math.max(0.01, value).toFixed(2));
}

function inferCategory(name: string, fallback?: string): string {
  if (typeof fallback === 'string' && fallback.trim()) {
    return fallback.trim();
  }

  for (const entry of CATEGORY_KEYWORDS) {
    if (entry.pattern.test(name)) {
      return entry.category;
    }
  }

  return 'Essentials';
}

function parseMoney(raw: string): number | null {
  const numeric = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return toSafeAmount(numeric);
}

function parsePriceFromText(rawText: string): { price: number; token: string } | null {
  const currencyPattern = /(₱|php|p)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;
  const currencyMatch = rawText.match(currencyPattern);
  if (currencyMatch) {
    const parsed = parseMoney(currencyMatch[2]);
    if (parsed !== null) {
      return { price: parsed, token: currencyMatch[0] };
    }
  }

  const genericPattern = /([0-9]{2,6}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/g;
  const matches = [...rawText.matchAll(genericPattern)];
  if (matches.length === 0) {
    return null;
  }

  const best = matches
    .map((match) => ({ token: match[0], value: parseMoney(match[1]) }))
    .filter((entry): entry is { token: string; value: number } => entry.value !== null)
    .sort((left, right) => right.value - left.value)[0];

  if (!best) {
    return null;
  }

  return { price: best.value, token: best.token };
}

function cleanupName(rawText: string, priceToken: string): string {
  let name = rawText.replace(priceToken, ' ');
  name = name.replace(/[_|,;]+/g, ' ');
  name = name.replace(/\s+/g, ' ').trim();

  name = name.replace(/\b(from|sa|at)\b\s+[a-z0-9\s\-]+$/i, '').trim();
  name = name.replace(/^(price|presyo)\s*[:=-]\s*/i, '').trim();

  return name || 'Unknown Product';
}

function toAnomalyScore(params: { ratio: number; verdict: ProductPriceAnalysisResult['verdict']; confidenceScore: number }): number {
  if (params.confidenceScore < 40) {
    return 0.8;
  }

  if (params.verdict === 'high-risk') {
    return 0.85;
  }

  if (params.verdict === 'overpriced') {
    return 0.45;
  }

  const drift = Math.abs(params.ratio - 1);
  return Number(clamp(drift * 0.7, 0.05, 0.35).toFixed(2));
}

export function parseRawProductText(rawText: string, options: ParseRawTextOptions = {}): ParsedRawProductText {
  const normalizedText = rawText.trim();
  if (!normalizedText) {
    throw new AppError(400, '"text" must be a non-empty string.');
  }

  const parsedPrice = parsePriceFromText(normalizedText);
  if (!parsedPrice) {
    throw new AppError(400, 'Unable to detect a valid price in the provided text.');
  }

  const name = cleanupName(normalizedText, parsedPrice.token);
  const category = inferCategory(name, options.category);

  return {
    rawText: normalizedText,
    name,
    price: parsedPrice.price,
    category
  };
}

export async function analyzeProductPrice(input: AnalyzeProductPriceInput): Promise<ProductPriceAnalysisResult> {
  const productName = input.name.trim();
  if (!productName) {
    throw new AppError(400, '"name" must be a non-empty string.');
  }
  if (!Number.isFinite(input.price) || input.price <= 0) {
    throw new AppError(400, '"price" must be greater than 0.');
  }

  const observedPrice = toSafeAmount(input.price);
  const region = input.region?.trim() || 'National';
  const historicalAverage =
    typeof input.historicalAverage === 'number' && Number.isFinite(input.historicalAverage) && input.historicalAverage > 0
      ? toSafeAmount(input.historicalAverage)
      : null;

  const category = inferCategory(productName, input.category);
  const geminiInsight = await requestGeminiPriceInsight({
    name: productName,
    price: observedPrice,
    region,
    category,
    historicalAverage: historicalAverage ?? undefined,
    rawText: input.rawText
  });

  const fairValue = toSafeAmount(geminiInsight?.fairValue ?? historicalAverage ?? observedPrice);
  const ratio = Number((observedPrice / fairValue).toFixed(4));
  const assessment = assessPrice(productName, observedPrice, fairValue);
  const confidenceScore = Number(
    clamp(geminiInsight?.confidenceScore ?? (historicalAverage !== null ? 74 : 58), 1, 100).toFixed(2)
  );
  const summary = geminiInsight?.summary || assessment.message;

  return {
    productName,
    normalizedName: normalizeItemName(productName),
    category: geminiInsight?.category?.trim() || category,
    region,
    observedPrice,
    fairValue,
    ratio,
    confidenceScore,
    anomalyScore: toAnomalyScore({
      ratio,
      verdict: assessment.flag,
      confidenceScore
    }),
    verdict: assessment.flag,
    message: assessment.message,
    summary,
    source: geminiInsight ? 'gemini' : 'heuristic',
    historicalAverage
  };
}
