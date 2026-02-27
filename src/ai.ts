import fs from 'fs';
import path from 'path';

export type BaselineMap = Record<string, number>;

export type PriceFlag = 'high-risk of corruption' | 'overpriced' | 'fair' | 'cheap' | 'steal';

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

function normalizeItemName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function roundPrice(value: number): number {
  return Number(value.toFixed(2));
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
  const pattern = /^\s*([a-zA-Z][a-zA-Z0-9\s/&(),.-]{1,80}?)\s*(?::|-|\s)\s*(?:php|Php|PHP|p|P|₱)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*$/;
  const match = line.match(pattern);

  if (!match) {
    return null;
  }

  const item = normalizeItemName(match[1]);
  const price = parsePrice(match[2]);

  if (!item || !price) {
    return null;
  }

  return { item, price: roundPrice(price) };
}

export function extractBaselineFromDocument(documentText: string): { extracted: BaselineMap; ignoredLines: number } {
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

  const extracted = [...running.entries()].reduce<BaselineMap>((acc, [item, value]) => {
    acc[item] = roundPrice(value.sum / value.count);
    return acc;
  }, {});

  return { extracted, ignoredLines };
}

export function readBaselineFile(baselinePath: string): BaselineMap {
  try {
    const raw = fs.readFileSync(baselinePath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    return Object.entries(parsed).reduce<BaselineMap>((acc, [key, value]) => {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        acc[normalizeItemName(key)] = roundPrice(value);
      }
      return acc;
    }, {});
  } catch {
    return {};
  }
}

export function mergeBaseline(current: BaselineMap, incoming: BaselineMap): { merged: BaselineMap; created: string[]; updated: string[] } {
  const merged: BaselineMap = { ...current };
  const created: string[] = [];
  const updated: string[] = [];

  for (const [item, incomingPrice] of Object.entries(incoming)) {
    const normalizedItem = normalizeItemName(item);
    const existingPrice = merged[normalizedItem];

    if (!existingPrice) {
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

  fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2), 'utf-8');
}

export function assessPrice(item: string, observedPrice: number, expectedPrice: number): PriceAssessment {
  const ratio = observedPrice / expectedPrice;

  if (ratio > 1.3) {
    return {
      flag: 'high-risk of corruption',
      message: `This looks high-risk do not buy, could be price manipulation. Expected around ₱${expectedPrice.toFixed(2)}, but got ₱${observedPrice.toFixed(2)}.`
    };
  }

  if (ratio > 1.1) {
    return {
      flag: 'overpriced',
      message: `This looks slightly overpriced try other places. Expected around ₱${expectedPrice.toFixed(2)}, but got ₱${observedPrice.toFixed(2)}.`
    };
  }

  if (ratio < 0.8) {
    return {
      flag: 'steal',
      message: `This looks like a steal. Expected around ₱${expectedPrice.toFixed(2)}, but got ₱${observedPrice.toFixed(2)}.`
    };
  }

  if (ratio < 0.9) {
    return {
      flag: 'cheap',
      message: `This looks slightly underpriced than normal. Expected around ₱${expectedPrice.toFixed(2)}, but got ₱${observedPrice.toFixed(2)}.`
    };
  }

  return {
    flag: 'fair',
    message: `This price looks fair. Market average is around ₱${expectedPrice.toFixed(2)}.`
  };
}

export function ingestDocumentToBaseline(documentText: string, baselinePath: string): IngestResult {
  const { extracted, ignoredLines } = extractBaselineFromDocument(documentText);
  const current = readBaselineFile(baselinePath);
  const { merged, created, updated } = mergeBaseline(current, extracted);

  // merge data file line, yawa
  writeBaselineFile(baselinePath, merged);

  return {
    extracted,
    created,
    updated,
    ignoredLines
  };
}
