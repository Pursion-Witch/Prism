import { sanitizeText } from './serviceUtils';

export interface DetectionCandidate {
  source: 'vision' | 'ocr' | 'ai-extraction' | 'database-match' | 'price-extraction';
  name: string;
  confidence: number;
  rawText?: string;
}

export interface EnsembleVotingResult {
  name: string;
  confidence: number;
  sources: string[];
  votes: number;
  alternatives: Array<{
    name: string;
    score: number;
  }>;
}

/**
 * Ensemble multiple detection candidates by voting and averaging confidence scores.
 * This gives more weight to names detected by multiple independent methods.
 */
export function ensembleConfidence(candidates: DetectionCandidate[]): EnsembleVotingResult {
  if (!candidates || candidates.length === 0) {
    return {
      name: 'unknown',
      confidence: 0,
      sources: [],
      votes: 0,
      alternatives: []
    };
  }

  // Normalize and group by name
  const grouped = new Map<string, DetectionCandidate[]>();
  for (const candidate of candidates) {
    const normalizedName = sanitizeText(candidate.name).toLowerCase();
    if (!normalizedName) {
      continue;
    }

    if (!grouped.has(normalizedName)) {
      grouped.set(normalizedName, []);
    }
    grouped.get(normalizedName)!.push(candidate);
  }

  // Score each group
  const scored = Array.from(grouped.entries()).map(([name, group]) => {
    const sourceWeights: Record<DetectionCandidate['source'], number> = {
      vision: 1.0,
      ocr: 0.75,
      'ai-extraction': 0.85,
      'price-extraction': 0.7,
      'database-match': 0.55
    };

    let weightedTotal = 0;
    let weightSum = 0;
    for (const candidate of group) {
      const weight = sourceWeights[candidate.source] ?? 0.7;
      weightedTotal += candidate.confidence * weight;
      weightSum += weight;
    }

    const weightedConfidence = weightSum > 0 ? weightedTotal / weightSum : 0;
    const maxConfidence = Math.max(...group.map((c) => c.confidence));
    const sources = group.map((g) => g.source);
    const votes = group.length;
    const uniqueSources = new Set(sources).size;

    // Use a conservative boost based on source agreement; avoid overconfidence inflation.
    const votingBoost = Math.min(0.12, uniqueSources * 0.04);
    const hasDbMatch = group.some((c) => c.source === 'database-match');
    const dbBoost = hasDbMatch ? 0.03 : 0;
    const boostedConfidence = Math.min(0.95, weightedConfidence + votingBoost + dbBoost);

    return {
      name,
      displayName: group[0]?.name || name, // Use original casing from first detection
      avgConfidence: weightedConfidence,
      maxConfidence,
      boostedConfidence,
      votes,
      sources: Array.from(new Set(sources)), // Unique sources
      group
    };
  });

  // Sort by boosted confidence and vote count
  scored.sort((a, b) => {
    if (b.boostedConfidence !== a.boostedConfidence) {
      return b.boostedConfidence - a.boostedConfidence;
    }
    return b.votes - a.votes; // Tiebreaker: more votes wins
  });

  if (scored.length === 0) {
    return {
      name: 'unknown',
      confidence: 0,
      sources: [],
      votes: 0,
      alternatives: []
    };
  }

  const best = scored[0];
  const alternatives = scored
    .slice(1, 4)
    .map((s) => ({
      name: s.displayName,
      score: Number(s.boostedConfidence.toFixed(3))
    }));

  return {
    name: best.displayName,
    confidence: Number(best.boostedConfidence.toFixed(3)),
    sources: best.sources,
    votes: best.votes,
    alternatives
  };
}

/**
 * Calculate the quality of a detection based on voting consensus.
 * Returns a classification of confidence level.
 */
export function classifyConfidence(result: EnsembleVotingResult): 'high' | 'medium' | 'low' {
  if (result.confidence >= 0.75 && result.votes >= 2) {
    return 'high';
  }
  if (result.confidence >= 0.5) {
    return 'medium';
  }
  return 'low';
}

/**
 * Determine if consensus is strong enough to proceed without user confirmation.
 */
export function hasStrongConsensus(result: EnsembleVotingResult): boolean {
  // Strong consensus: high confidence AND multiple sources
  return result.confidence >= 0.8 && result.votes >= 2;
}

/**
 * Merge two detection results, preferring the higher confidence one.
 */
export function mergeDetectionResults(
  primary: EnsembleVotingResult,
  secondary: EnsembleVotingResult
): EnsembleVotingResult {
  if (primary.confidence >= secondary.confidence) {
    return primary;
  }
  return secondary;
}
