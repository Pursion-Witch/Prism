import { AIAuditService } from './ai-audit';
import { ExternalAIAnalyzer, type ExternalAIRecommendation } from './ai-external';
import { RealtimeEventBus } from '../realtime/event-bus';
import { LiveCache } from '../realtime/live-cache';
import type { AISupervisionEventPayload, Product } from '../types/realtime';

interface SupervisionEmitState {
  inAnomaly: boolean;
  lastEmittedAtMs: number;
  lastAnomalyScore: number;
}

export interface AISupervisorOptions {
  scanIntervalMs: number;
  anomalyThreshold: number;
  emitCooldownMs: number;
  emitMinimumScoreDelta: number;
  correctionStrength: number;
  maxCorrectionStep: number;
  externalCorrectionStrength: number;
  externalMaxCorrectionStep: number;
}

export interface AIScanSummary {
  trigger: 'interval' | 'manual';
  startedAt: string;
  completedAt: string;
  scannedProducts: number;
  anomaliesDetected: number;
  supervisedProducts: number;
  emittedEvents: number;
  correctedByRule: number;
  externalRequested: boolean;
  skipped: boolean;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundScore(score: number): number {
  return Number(score.toFixed(6));
}

function computeAnomalyScore(price: number, baseline: number): number {
  if (!Number.isFinite(baseline) || baseline <= 0) {
    return 0;
  }
  return roundScore(Math.abs(price - baseline) / baseline);
}

function roundPrice(value: number): number {
  return Number(value.toFixed(2));
}

function nudgeTowardBaseline(current: number, baseline: number, strength: number, maxStep: number): number {
  const drift = current - baseline;
  if (Math.abs(drift) < 0.0001) {
    return roundPrice(baseline);
  }

  const step = Math.min(Math.abs(drift) * strength, maxStep);
  const next = current - Math.sign(drift) * step;
  if ((drift > 0 && next < baseline) || (drift < 0 && next > baseline)) {
    return roundPrice(baseline);
  }
  return roundPrice(next);
}

function resolveOptions(overrides?: Partial<AISupervisorOptions>): AISupervisorOptions {
  const defaults: AISupervisorOptions = {
    scanIntervalMs: Math.max(500, envNumber('AI_SUPERVISOR_INTERVAL_MS', 10_000)),
    anomalyThreshold: Math.max(0.001, envNumber('AI_ANOMALY_THRESHOLD', 0.02)),
    emitCooldownMs: Math.max(500, envNumber('AI_EVENT_COOLDOWN_MS', 20_000)),
    emitMinimumScoreDelta: Math.max(0.0001, envNumber('AI_EVENT_MIN_SCORE_DELTA', 0.002)),
    correctionStrength: Math.min(1, Math.max(0, envNumber('AI_CORRECTION_STRENGTH', 0.15))),
    maxCorrectionStep: Math.max(0.001, envNumber('AI_MAX_CORRECTION_STEP', 0.5)),
    externalCorrectionStrength: Math.min(1, Math.max(0, envNumber('AI_EXTERNAL_CORRECTION_STRENGTH', 0.25))),
    externalMaxCorrectionStep: Math.max(0.001, envNumber('AI_EXTERNAL_MAX_CORRECTION_STEP', 1))
  };

  return {
    ...defaults,
    ...overrides
  };
}

export class AISupervisor {
  private readonly options: AISupervisorOptions;

  private timer: NodeJS.Timeout | null = null;

  private scanInFlight = false;

  private externalInFlight = false;

  private readonly emitStateByProduct = new Map<string, SupervisionEmitState>();

  constructor(
    private readonly liveCache: LiveCache,
    private readonly eventBus: RealtimeEventBus,
    private readonly audit: AIAuditService,
    private readonly externalAnalyzer?: ExternalAIAnalyzer,
    options?: Partial<AISupervisorOptions>
  ) {
    this.options = resolveOptions(options);
  }

  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.scan('interval');
    }, this.options.scanIntervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  async scanNow(): Promise<AIScanSummary> {
    return this.scan('manual');
  }

  private async scan(trigger: 'interval' | 'manual'): Promise<AIScanSummary> {
    const startedAt = new Date();
    const startedAtIso = startedAt.toISOString();

    if (this.scanInFlight) {
      return {
        trigger,
        startedAt: startedAtIso,
        completedAt: new Date().toISOString(),
        scannedProducts: 0,
        anomaliesDetected: 0,
        supervisedProducts: 0,
        emittedEvents: 0,
        correctedByRule: 0,
        externalRequested: false,
        skipped: true
      };
    }

    this.scanInFlight = true;
    let scannedProducts = 0;
    let anomaliesDetected = 0;
    let supervisedProducts = 0;
    let emittedEvents = 0;
    let correctedByRule = 0;
    const anomalyCandidates: Product[] = [];

    try {
      this.liveCache.forEachProduct((product) => {
        scannedProducts += 1;
        product.lastAICheck = startedAt;

        const anomalyScore = computeAnomalyScore(product.price, product.originalPrice);
        const state = this.emitStateByProduct.get(product.id);
        const wasAnomaly = state?.inAnomaly ?? false;
        const isAnomaly = anomalyScore > this.options.anomalyThreshold;
        const previouslySupervised = product.supervised;

        product.anomalyScore = anomalyScore;

        if (isAnomaly) {
          anomaliesDetected += 1;
          product.supervised = true;

          const corrected = nudgeTowardBaseline(
            product.price,
            product.originalPrice,
            this.options.correctionStrength,
            this.options.maxCorrectionStep
          );

          if (Math.abs(corrected - product.price) >= 0.0001) {
            product.price = corrected;
            product.aiAction = 'rule-revert-towards-baseline';
            correctedByRule += 1;
            this.safeAuditAppend({
              productId: product.id,
              source: 'rule-engine',
              action: 'rule-revert-towards-baseline',
              message: 'Rule engine nudged price toward baseline.',
              anomalyScore,
              metadata: {
                correctedPrice: corrected,
                baselinePrice: product.originalPrice
              },
              timestamp: startedAt
            });
          } else if (!previouslySupervised || product.aiAction !== 'rule-price-anomaly') {
            product.aiAction = 'rule-price-anomaly';
            this.safeAuditAppend({
              productId: product.id,
              source: 'rule-engine',
              action: 'rule-price-anomaly',
              message: `Anomaly detected by rule engine (${(anomalyScore * 100).toFixed(2)}%).`,
              anomalyScore,
              timestamp: startedAt
            });
          }

          if (this.shouldEmit(product.id, anomalyScore, startedAt.getTime(), !wasAnomaly)) {
            const payload: AISupervisionEventPayload = {
              type: 'price-anomaly',
              productId: product.id,
              anomalyScore,
              message: `Anomaly detected: ${(anomalyScore * 100).toFixed(2)}% deviation from baseline.`,
              timestamp: startedAtIso
            };
            this.eventBus.emitAISupervision(payload);
            emittedEvents += 1;
          }

          anomalyCandidates.push({ ...product });
          this.updateEmitState(product.id, anomalyScore, startedAt.getTime(), true);
          supervisedProducts += 1;
          return;
        }

        if (previouslySupervised) {
          product.supervised = false;
          product.aiAction = 'rule-clear-supervision';
          this.safeAuditAppend({
            productId: product.id,
            source: 'rule-engine',
            action: 'rule-clear-supervision',
            message: 'Price drift returned under anomaly threshold.',
            anomalyScore,
            timestamp: startedAt
          });
        } else {
          product.aiAction = null;
        }

        this.updateEmitState(product.id, anomalyScore, state?.lastEmittedAtMs ?? 0, false);
      });

      this.liveCache.recordAIScan(anomaliesDetected, supervisedProducts, startedAt);
      const externalRequested = anomalyCandidates.length > 0 && this.externalAnalyzer !== undefined;

      if (externalRequested) {
        void this.runExternalPass(anomalyCandidates, startedAt);
      }

      return {
        trigger,
        startedAt: startedAtIso,
        completedAt: new Date().toISOString(),
        scannedProducts,
        anomaliesDetected,
        supervisedProducts,
        emittedEvents,
        correctedByRule,
        externalRequested,
        skipped: false
      };
    } finally {
      this.scanInFlight = false;
    }
  }

  private shouldEmit(productId: string, anomalyScore: number, nowMs: number, becameAnomaly: boolean): boolean {
    const state = this.emitStateByProduct.get(productId);
    if (!state) {
      return true;
    }
    if (becameAnomaly) {
      return true;
    }

    const elapsed = nowMs - state.lastEmittedAtMs;
    const scoreDelta = Math.abs(anomalyScore - state.lastAnomalyScore);
    return elapsed >= this.options.emitCooldownMs && scoreDelta >= this.options.emitMinimumScoreDelta;
  }

  private updateEmitState(productId: string, anomalyScore: number, emittedAtMs: number, inAnomaly: boolean): void {
    const current = this.emitStateByProduct.get(productId);
    this.emitStateByProduct.set(productId, {
      inAnomaly,
      lastEmittedAtMs: emittedAtMs || current?.lastEmittedAtMs || 0,
      lastAnomalyScore: anomalyScore
    });
  }

  private async runExternalPass(candidates: ReadonlyArray<Product>, timestamp: Date): Promise<void> {
    if (this.externalInFlight || !this.externalAnalyzer) {
      return;
    }

    this.externalInFlight = true;
    try {
      const result = await this.externalAnalyzer.analyzeProducts(candidates);
      if (result.recommendations.length === 0) {
        return;
      }

      const timestampIso = timestamp.toISOString();
      for (const recommendation of result.recommendations) {
        this.applyExternalRecommendation(recommendation, result.source, timestamp, timestampIso);
      }

      this.liveCache.setSupervisedCount(this.countSupervisedProducts());
    } finally {
      this.externalInFlight = false;
    }
  }

  private applyExternalRecommendation(
    recommendation: ExternalAIRecommendation,
    source: 'external-ai' | 'fallback-rule',
    timestamp: Date,
    timestampIso: string
  ): void {
    const product = this.liveCache.getProduct(recommendation.productId);
    if (!product) {
      return;
    }

    const nowMs = timestamp.getTime();
    if (recommendation.action === 'increase-supervision') {
      product.supervised = true;
      product.aiAction = 'external-increase-supervision';
      this.safeAuditAppend({
        productId: product.id,
        source: source === 'external-ai' ? 'external-ai' : 'rule-engine',
        action: 'external-increase-supervision',
        message: recommendation.message,
        anomalyScore: recommendation.anomalyScore,
        timestamp
      });
    } else if (recommendation.action === 'revert-towards-baseline') {
      const correctedPrice = nudgeTowardBaseline(
        product.price,
        product.originalPrice,
        this.options.externalCorrectionStrength,
        this.options.externalMaxCorrectionStep
      );
      if (Math.abs(correctedPrice - product.price) >= 0.0001) {
        product.price = correctedPrice;
      }
      product.supervised = true;
      product.aiAction = 'external-revert-towards-baseline';
      this.safeAuditAppend({
        productId: product.id,
        source: source === 'external-ai' ? 'external-ai' : 'rule-engine',
        action: 'external-revert-towards-baseline',
        message: recommendation.message,
        anomalyScore: recommendation.anomalyScore,
        metadata: {
          correctedPrice,
          baselinePrice: product.originalPrice
        },
        timestamp
      });
    } else {
      return;
    }

    product.anomalyScore = recommendation.anomalyScore;
    product.lastAICheck = timestamp;

    if (this.shouldEmit(product.id, recommendation.anomalyScore, nowMs, false)) {
      this.eventBus.emitAISupervision({
        type: 'price-anomaly',
        productId: product.id,
        anomalyScore: recommendation.anomalyScore,
        message: recommendation.message,
        timestamp: timestampIso
      });
      this.updateEmitState(product.id, recommendation.anomalyScore, nowMs, true);
    } else {
      this.updateEmitState(product.id, recommendation.anomalyScore, nowMs, true);
    }
  }

  private countSupervisedProducts(): number {
    let count = 0;
    this.liveCache.forEachProduct((product) => {
      if (product.supervised) {
        count += 1;
      }
    });
    return count;
  }

  private safeAuditAppend(input: {
    productId: string;
    action: string;
    message: string;
    source: 'rule-engine' | 'external-ai';
    anomalyScore?: number;
    metadata?: Record<string, string | number | boolean | null>;
    timestamp: Date;
  }): void {
    void this.audit.append(input).catch((error) => {
      console.error('[ai-supervisor] failed to append audit entry:', error);
    });
  }
}
