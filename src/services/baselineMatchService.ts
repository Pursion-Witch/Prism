import levenshtein from 'js-levenshtein';
import Fuse from 'fuse.js';
import fs from 'node:fs';
import path from 'node:path';
import { readBaselineFile } from '../ai';
import { sanitizeText } from './serviceUtils';

export interface BaselineMatch {
  canonical_name: string;
  matched_input: string;
  match_score: number; // 0-1
  known_price: number;
}

/**
 * Load product names from data/products.json if available.
 */
function loadProductNames(): string[] {
  try {
    const projectPath = path.resolve(process.cwd(), 'data', 'products.json');
    const distPath = path.resolve(__dirname, '..', '..', 'data', 'products.json');
    const filePath = fs.existsSync(projectPath) ? projectPath : distPath;
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => (typeof entry.name === 'string' ? sanitizeText(entry.name) : ''))
        .filter(Boolean);
    }
    return [];
  } catch {
    return [];
  }
}

// Fuse index caching
let fuseIndex: Fuse<string> | null = null;
let fuseSignature = '';

function buildFuseIndex(): Fuse<string> {
  const baseline = readBaselineFile('./data/baseline.json');
  const products = loadProductNames();
  const items = [...Object.keys(baseline).map((n) => sanitizeText(n)), ...products]
    .map((name) => sanitizeText(name))
    .filter(Boolean);
  const dedupedMap = new Map<string, string>();
  for (const item of items) {
    const key = item.toLowerCase();
    if (!dedupedMap.has(key)) {
      dedupedMap.set(key, item);
    }
  }
  const deduped = Array.from(dedupedMap.values());
  const signature = Array.from(dedupedMap.keys()).join('|');

  if (fuseIndex && fuseSignature === signature) {
    return fuseIndex;
  }

  fuseSignature = signature;
  fuseIndex = new Fuse(deduped, { includeScore: true, threshold: 0.4 });
  return fuseIndex;
}

/**
 * Fuzzy match a detected product name against the baseline database.
 * Returns the best matches with similarity scores.
 */
export function fuzzyMatchBaseline(detectedName: string): BaselineMatch | null {
  if (!detectedName || !sanitizeText(detectedName)) {
    return null;
  }

  try {
    const baseline = readBaselineFile('./data/baseline.json');
    const baselineMapLower = new Map<string, { name: string; price: number }>(
      Object.entries(baseline).map(([name, price]) => [sanitizeText(name).toLowerCase(), { name, price }])
    );
    const detection = sanitizeText(detectedName).toLowerCase().trim();

    // Try fuse search first
    const fuse = buildFuseIndex();
    const fuseResults = fuse.search(detection);
    if (fuseResults.length) {
      const top = fuseResults[0];
      const name = sanitizeText(top.item);
      const matchScore = 1 - (top.score ?? 0); // convert fuse score (lower is better)
      const exactBaseline = baselineMapLower.get(name.toLowerCase());
      // if fuse match is strong we can return immediately
      if (matchScore >= 0.85 && exactBaseline) {
        return {
          canonical_name: exactBaseline.name,
          matched_input: detectedName,
          match_score: Number(matchScore.toFixed(3)),
          known_price: exactBaseline.price
        };
      }
    }

    const candidates = Object.entries(baseline)
      .map(([name, price]) => {
        const normalizedName = sanitizeText(name).toLowerCase();
        const distance = levenshtein(detection, normalizedName);
        const maxLen = Math.max(detection.length, normalizedName.length);
        const similarity = 1 - distance / maxLen;

        return {
          canonical_name: name,
          matched_input: detectedName,
          match_score: similarity,
          known_price: price,
          distance
        };
      })
      .filter((c) => c.match_score >= 0.6)
      .sort((a, b) => b.match_score - a.match_score);

    if (!candidates.length) {
      return null;
    }

    const best = candidates[0];
    return {
      canonical_name: best.canonical_name,
      matched_input: detectedName,
      match_score: Number(best.match_score.toFixed(3)),
      known_price: best.known_price
    };
  } catch {
    // If baseline file doesn't exist or is invalid, return null
    return null;
  }
}

/**
 * Get multiple fuzzy match candidates from baseline.
 * Returns top N matches sorted by similarity.
 */
export function fuzzyMatchBaselineMultiple(
  detectedName: string,
  topN: number = 5
): BaselineMatch[] {
  if (!detectedName || !sanitizeText(detectedName)) {
    return [];
  }

  try {
    const baseline = readBaselineFile('./data/baseline.json');
    const products = loadProductNames();
    const detection = sanitizeText(detectedName).toLowerCase().trim();

    const candidates: BaselineMatch[] = Object.entries(baseline)
      .map(([name, price]) => {
        const normalizedName = sanitizeText(name).toLowerCase();
        const distance = levenshtein(detection, normalizedName);
        const maxLen = Math.max(detection.length, normalizedName.length);
        const similarity = 1 - distance / maxLen;

        return {
          canonical_name: name,
          matched_input: detectedName,
          match_score: similarity,
          known_price: price
        };
      })
      .filter((c) => c.match_score >= 0.5);

    for (const prod of products) {
      const normal = sanitizeText(prod).toLowerCase();
      if (Object.keys(baseline).some((b) => sanitizeText(b).toLowerCase() === normal)) {
        continue;
      }
      const distance = levenshtein(detection, normal);
      const maxLen = Math.max(detection.length, normal.length);
      const similarity = 1 - distance / maxLen;
      if (similarity >= 0.5) {
        candidates.push({
          canonical_name: prod,
          matched_input: detectedName,
          match_score: similarity,
          known_price: 0
        });
      }
    }

    const sorted = candidates.sort((a, b) => b.match_score - a.match_score).slice(0, topN);
    return sorted.map((c) => ({ ...c, match_score: Number(c.match_score.toFixed(3)) }));
  } catch {
    return [];
  }
}

/**
 * Check if a product name exists in the baseline (exact match).
 */
export function existsInBaseline(detectedName: string): boolean {
  if (!detectedName || !sanitizeText(detectedName)) {
    return false;
  }

  try {
    const baseline = readBaselineFile('./data/baseline.json');
    const normalized = sanitizeText(detectedName).toLowerCase();
    return Object.keys(baseline).some((name) => sanitizeText(name).toLowerCase() === normalized);
  } catch {
    return false;
  }
}

/**
 * Load baseline products as a simple list (useful for context in prompts).
 * Returns only the top N products, ordered by some criteria.
 */
export function loadBaselineProducts(limit: number = 50): string[] {
  try {
    const baseline = readBaselineFile('./data/baseline.json');
    return Object.keys(baseline)
      .filter(Boolean)
      .slice(0, limit)
      .map((name) => sanitizeText(name))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Get the canonical baseline name that best matches an input.
 * This is useful for normalizing product names to database equivalents.
 */
export function canonicalizeProductName(detectedName: string): string | null {
  const match = fuzzyMatchBaseline(detectedName);
  if (!match) {
    return null;
  }
  return match.canonical_name;
}
