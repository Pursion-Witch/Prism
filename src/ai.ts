import fs from 'node:fs';
import path from 'node:path';

export type BaselineMap = Record<string, number>;

export type PriceFlag = 'high-risk' | 'overpriced' | 'fair' | 'cheap' | 'steal';

export interface PriceAssessment {
  flag: PriceFlag;
  message: string;
}

export interface IngestResult {
  extracted: BaselineMap;
  created: string[];
  updated: string[];
  ignoredLines: number;
}

const HIGH_RISK_RATIO = 1.3;
const OVERPRICED_RATIO = 1.1;
const STEAL_RATIO = 0.8;
const CHEAP_RATIO = 0.9;

export function normalizeItemName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function roundPrice(value: number): number {
  return Number(value.toFixed(2));
}

function formatPrice(value: number): string {
  return `PHP ${value.toFixed(2)}`;
}

function parsePrice(value: string): number | null {
  const parsed = Number(value.replace(/,/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}
// product name - price in any other manner that shows to separate the two products doedil ni gian - 500
function parseLineToEntry(line: string): { item: string; price: number } | null {
  const pattern =
    /^\s*([a-z][a-z0-9\s/&(),.-]{1,80}?)\s*(?::|-|\s)\s*(?:php|p)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*$/i;
  const match = line.match(pattern);
  if (!match) {
    return null;
  }

  const item = normalizeItemName(match[1]);
  const price = parsePrice(match[2]);
  if (!item || price === null) {
    return null;
  }

  return { item, price: roundPrice(price) };
}

export function extractBaselineFromDocument(documentText: string): {
  extracted: BaselineMap;
  ignoredLines: number;
} {
  const lines = documentText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const running = new Map<string, { sum: number; count: number }>();
  let ignoredLines = 0;

  for (const line of lines) {
    const parsed = parseLineToEntry(line);
    if (!parsed) {
      ignoredLines += 1;
      continue;
    }

    const current = running.get(parsed.item) ?? { sum: 0, count: 0 };
    current.sum += parsed.price;
    current.count += 1;
    running.set(parsed.item, current);
  }

  const extracted = [...running.entries()].reduce<BaselineMap>((acc, [item, totals]) => {
    acc[item] = roundPrice(totals.sum / totals.count);
    return acc;
  }, {});

  return { extracted, ignoredLines };
}

export function readBaselineFile(baselinePath: string): BaselineMap {
  try {
    const raw = fs.readFileSync(baselinePath, 'utf-8');
    const parsed = JSON.parse(raw);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    return Object.entries(parsed as Record<string, unknown>).reduce<BaselineMap>((acc, [key, value]) => {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        acc[normalizeItemName(key)] = roundPrice(value);
      }

      return acc;
    }, {});
  } catch {
    return {};
  }
}

export function mergeBaseline(
  current: BaselineMap,
  incoming: BaselineMap
): { merged: BaselineMap; created: string[]; updated: string[] } {
  const merged: BaselineMap = { ...current };
  const created: string[] = [];
  const updated: string[] = [];

  for (const [item, incomingPrice] of Object.entries(incoming)) {
    const normalizedItem = normalizeItemName(item);
    const existingPrice = merged[normalizedItem];

    if (existingPrice === undefined) {
      merged[normalizedItem] = incomingPrice;
      created.push(normalizedItem);
      continue;
    }

    merged[normalizedItem] = roundPrice((existingPrice + incomingPrice) / 2);
    updated.push(normalizedItem);
  }

  return { merged, created, updated };
}

export function writeBaselineFile(baselinePath: string, baseline: BaselineMap): void {
  const baselineDir = path.dirname(baselinePath);
  if (!fs.existsSync(baselineDir)) {
    fs.mkdirSync(baselineDir, { recursive: true });
  }

  const normalized = Object.entries(baseline)
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .reduce<BaselineMap>((acc, [key, value]) => {
      acc[normalizeItemName(key)] = roundPrice(value);
      return acc;
    }, {});

  fs.writeFileSync(baselinePath, JSON.stringify(normalized, null, 2), 'utf-8');
}

export function isExpensiveFlag(flag: string): flag is 'high-risk' | 'overpriced' {
  return flag === 'high-risk' || flag === 'overpriced';
}

export function assessPrice(item: string, observedPrice: number, expectedPrice: number): PriceAssessment {
  const ratio = observedPrice / expectedPrice;
  const normalizedItem = normalizeItemName(item);

  if (ratio >= HIGH_RISK_RATIO) {
    return {
      flag: 'high-risk',
      message: `High-risk price for ${normalizedItem}: expected around ${formatPrice(expectedPrice)}, observed ${formatPrice(observedPrice)}.`
    };
  }

  if (ratio >= OVERPRICED_RATIO) {
    return {
      flag: 'overpriced',
      message: `Slightly overpriced ${normalizedItem}: expected around ${formatPrice(expectedPrice)}, observed ${formatPrice(observedPrice)}.`
    };
  }

  if (ratio <= STEAL_RATIO) {
    return {
      flag: 'steal',
      message: `Very low price for ${normalizedItem}: expected around ${formatPrice(expectedPrice)}, observed ${formatPrice(observedPrice)}.`
    };
  }

  if (ratio <= CHEAP_RATIO) {
    return {
      flag: 'cheap',
      message: `Below-market ${normalizedItem}: expected around ${formatPrice(expectedPrice)}, observed ${formatPrice(observedPrice)}.`
    };
  }

  return {
    flag: 'fair',
    message: `Fair price for ${normalizedItem}. Baseline is around ${formatPrice(expectedPrice)}.`
  };
}

export function ingestDocumentToBaseline(documentText: string, baselinePath: string): IngestResult {
  const { extracted, ignoredLines } = extractBaselineFromDocument(documentText);
  const current = readBaselineFile(baselinePath);
  const { merged, created, updated } = mergeBaseline(current, extracted);
  writeBaselineFile(baselinePath, merged);

  return {
    extracted,
    created,
    updated,
    ignoredLines
  };
}
