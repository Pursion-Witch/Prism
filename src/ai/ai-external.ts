import OpenAI from 'openai';
import type { Product } from '../types/realtime';

export type ExternalAIAction = 'none' | 'increase-supervision' | 'revert-towards-baseline';

export interface ExternalAIRecommendation {
  productId: string;
  anomalyScore: number;
  action: ExternalAIAction;
  message: string;
}

export interface ExternalAIAnalysisResult {
  source: 'external-ai' | 'fallback-rule';
  recommendations: ExternalAIRecommendation[];
  usedFallback: boolean;
  error?: string;
}

export interface ExternalAIAnalyzerOptions {
  enabled: boolean;
  model: string;
  timeoutMs: number;
  maxProductsPerRequest: number;
  anomalyThreshold: number;
}

interface ExternalAICandidate {
  productId: string;
  name: string;
  price: number;
  originalPrice: number;
  supervised: boolean;
  anomalyScore: number;
}

interface RawRecommendation {
  productId?: unknown;
  anomalyScore?: unknown;
  action?: unknown;
  message?: unknown;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  return raw.trim().toLowerCase() === 'true';
}

function isExternalAction(value: unknown): value is ExternalAIAction {
  return value === 'none' || value === 'increase-supervision' || value === 'revert-towards-baseline';
}

function toAnomalyScore(price: number, baseline: number): number {
  if (!Number.isFinite(baseline) || baseline <= 0) {
    return 0;
  }
  return Math.abs(price - baseline) / baseline;
}

function toFixedScore(score: number): number {
  return Number(score.toFixed(6));
}

function buildOptions(overrides?: Partial<ExternalAIAnalyzerOptions>): ExternalAIAnalyzerOptions {
  const defaults: ExternalAIAnalyzerOptions = {
    enabled: envBoolean('AI_EXTERNAL_ENABLED', false),
    model: process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini',
    timeoutMs: Math.max(500, envNumber('AI_EXTERNAL_TIMEOUT_MS', 5_000)),
    maxProductsPerRequest: Math.max(1, Math.floor(envNumber('AI_EXTERNAL_MAX_PRODUCTS', 75))),
    anomalyThreshold: Math.max(0.001, envNumber('AI_ANOMALY_THRESHOLD', 0.02))
  };

  return {
    ...defaults,
    ...overrides
  };
}

export class ExternalAIAnalyzer {
  private readonly options: ExternalAIAnalyzerOptions;

  private readonly client: OpenAI | null;

  constructor(options?: Partial<ExternalAIAnalyzerOptions>) {
    this.options = buildOptions(options);
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    this.client = this.options.enabled && apiKey ? new OpenAI({ apiKey }) : null;
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  async analyzeProducts(products: ReadonlyArray<Product>): Promise<ExternalAIAnalysisResult> {
    const candidates = this.pickCandidates(products);
    if (candidates.length === 0) {
      return {
        source: this.isEnabled() ? 'external-ai' : 'fallback-rule',
        recommendations: [],
        usedFallback: !this.isEnabled()
      };
    }

    if (!this.client) {
      return {
        source: 'fallback-rule',
        recommendations: this.fallbackRecommendations(candidates),
        usedFallback: true
      };
    }

    try {
      const rawJson = await this.requestRecommendations(candidates);
      const allowedProductIds = new Set(candidates.map((candidate) => candidate.productId));
      const parsed = this.parseRecommendations(rawJson, allowedProductIds);
      if (!parsed) {
        throw new Error('External AI returned an invalid JSON structure.');
      }

      return {
        source: 'external-ai',
        recommendations: parsed,
        usedFallback: false
      };
    } catch (error) {
      return {
        source: 'fallback-rule',
        recommendations: this.fallbackRecommendations(candidates),
        usedFallback: true,
        error: error instanceof Error ? error.message : 'Unknown external AI failure.'
      };
    }
  }

  private pickCandidates(products: ReadonlyArray<Product>): ExternalAICandidate[] {
    const candidates = products
      .map((product) => {
        const anomalyScore = toAnomalyScore(product.price, product.originalPrice);
        return {
          productId: product.id,
          name: product.name,
          price: product.price,
          originalPrice: product.originalPrice,
          supervised: product.supervised,
          anomalyScore: toFixedScore(anomalyScore)
        };
      })
      .filter((candidate) => candidate.anomalyScore > this.options.anomalyThreshold)
      .sort((left, right) => right.anomalyScore - left.anomalyScore)
      .slice(0, this.options.maxProductsPerRequest);

    return candidates;
  }

  private fallbackRecommendations(candidates: ReadonlyArray<ExternalAICandidate>): ExternalAIRecommendation[] {
    return candidates.map((candidate) => ({
      productId: candidate.productId,
      anomalyScore: candidate.anomalyScore,
      action: 'revert-towards-baseline',
      message: `Fallback rule: anomaly ${(candidate.anomalyScore * 100).toFixed(2)}% from baseline.`
    }));
  }

  private async requestRecommendations(candidates: ReadonlyArray<ExternalAICandidate>): Promise<string> {
    if (!this.client) {
      throw new Error('OpenAI client is not available.');
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
    }, this.options.timeoutMs);

    try {
      const completion = await this.client.chat.completions.create(
        {
          model: this.options.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'You supervise product-price simulation data. Reply only with JSON: {"recommendations":[{"productId":"string","anomalyScore":0.0,"action":"none|increase-supervision|revert-towards-baseline","message":"string"}]}.'
            },
            {
              role: 'user',
              content: JSON.stringify({
                task: 'analyze_price_anomalies',
                anomalyThreshold: this.options.anomalyThreshold,
                candidates
              })
            }
          ]
        },
        {
          signal: abortController.signal
        }
      );

      const content = completion.choices[0]?.message?.content;
      if (typeof content !== 'string' || content.trim().length === 0) {
        throw new Error('External AI response was empty.');
      }
      return content;
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseRecommendations(rawJson: string, allowedProductIds: Set<string>): ExternalAIRecommendation[] | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      return null;
    }

    if (typeof parsed !== 'object' || parsed === null || !('recommendations' in parsed)) {
      return null;
    }

    const rawRecommendations = (parsed as { recommendations?: unknown }).recommendations;
    if (!Array.isArray(rawRecommendations)) {
      return null;
    }

    const recommendations: ExternalAIRecommendation[] = [];

    for (const row of rawRecommendations) {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        continue;
      }

      const recommendation = row as RawRecommendation;
      if (typeof recommendation.productId !== 'string' || !allowedProductIds.has(recommendation.productId)) {
        continue;
      }
      if (typeof recommendation.anomalyScore !== 'number' || !Number.isFinite(recommendation.anomalyScore)) {
        continue;
      }
      if (!isExternalAction(recommendation.action)) {
        continue;
      }
      if (typeof recommendation.message !== 'string' || recommendation.message.trim().length === 0) {
        continue;
      }

      recommendations.push({
        productId: recommendation.productId,
        anomalyScore: toFixedScore(recommendation.anomalyScore),
        action: recommendation.action,
        message: recommendation.message.trim()
      });
    }

    return recommendations;
  }
}
