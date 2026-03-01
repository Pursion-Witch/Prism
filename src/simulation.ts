import { LiveCache } from './realtime/live-cache';
import { RealtimeEventBus } from './realtime/event-bus';
import type { PriceUpdate } from './types/realtime';

export interface SimulationOptions {
  intervalMs: number;
  normalDelta: number;
  supervisedDelta: number;
  supervisedReversionStrength: number;
  maxReversionStep: number;
  minPrice: number;
  emitBatchSize: number;
}

export interface SimulationTickResult {
  trigger: 'interval' | 'manual';
  scannedProducts: number;
  updatedProducts: number;
  startedAt: string;
  completedAt: string;
  skipped: boolean;
}

function randomInRange(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function roundPrice(value: number): number {
  return Number(value.toFixed(2));
}

function clampToMinPrice(value: number, minPrice: number): number {
  return value < minPrice ? minPrice : value;
}

function nudgeTowardBaseline(currentPrice: number, baselinePrice: number, strength: number, maxStep: number): number {
  const drift = currentPrice - baselinePrice;
  if (Math.abs(drift) < 0.0001) {
    return roundPrice(baselinePrice);
  }

  const correction = Math.min(Math.abs(drift) * strength, maxStep);
  const next = currentPrice - Math.sign(drift) * correction;
  if ((drift > 0 && next < baselinePrice) || (drift < 0 && next > baselinePrice)) {
    return roundPrice(baselinePrice);
  }
  return roundPrice(next);
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveSimulationOptions(): SimulationOptions {
  return {
    intervalMs: Math.max(100, envNumber('SIMULATION_INTERVAL_MS', 1_000)),
    normalDelta: Math.max(0.001, envNumber('SIMULATION_NORMAL_DELTA', 0.01)),
    supervisedDelta: Math.max(0.001, envNumber('SIMULATION_SUPERVISED_DELTA', 0.05)),
    supervisedReversionStrength: Math.min(1, Math.max(0, envNumber('SIMULATION_REVERSION_STRENGTH', 0.08))),
    maxReversionStep: Math.max(0.001, envNumber('SIMULATION_MAX_REVERSION_STEP', 0.2)),
    minPrice: Math.max(0.01, envNumber('SIMULATION_MIN_PRICE', 0.01)),
    emitBatchSize: Math.max(1, Math.floor(envNumber('SIMULATION_EMIT_BATCH_SIZE', 500)))
  };
}

export class SimulationEngine {
  private readonly options: SimulationOptions;

  private timer: NodeJS.Timeout | null = null;

  private tickInFlight = false;

  constructor(
    private readonly liveCache: LiveCache,
    private readonly eventBus: RealtimeEventBus,
    options?: Partial<SimulationOptions>
  ) {
    const defaults = resolveSimulationOptions();
    this.options = {
      ...defaults,
      ...options
    };
  }

  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.runTick('interval');
    }, this.options.intervalMs);
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  async runNow(): Promise<SimulationTickResult> {
    return this.runTick('manual');
  }

  private async runTick(trigger: 'interval' | 'manual'): Promise<SimulationTickResult> {
    const startedAt = new Date();
    const startedIso = startedAt.toISOString();

    if (this.tickInFlight) {
      const completedIso = new Date().toISOString();
      return {
        trigger,
        scannedProducts: 0,
        updatedProducts: 0,
        startedAt: startedIso,
        completedAt: completedIso,
        skipped: true
      };
    }

    this.tickInFlight = true;
    const updates: PriceUpdate[] = [];
    let scannedProducts = 0;

    try {
      this.liveCache.forEachProduct((product) => {
        scannedProducts += 1;

        const currentPrice = product.price;
        const deltaCap = product.supervised ? this.options.supervisedDelta : this.options.normalDelta;
        const randomStep = randomInRange(-deltaCap, deltaCap);
        let nextPrice = clampToMinPrice(currentPrice + randomStep, this.options.minPrice);

        if (product.supervised) {
          nextPrice = nudgeTowardBaseline(
            nextPrice,
            product.originalPrice,
            this.options.supervisedReversionStrength,
            this.options.maxReversionStep
          );
        } else {
          nextPrice = roundPrice(nextPrice);
        }

        if (Math.abs(nextPrice - currentPrice) < 0.0001) {
          return;
        }

        product.price = nextPrice;
        updates.push({
          productId: product.id,
          price: nextPrice,
          supervised: product.supervised,
          anomalyScore: product.anomalyScore
        });
      });

      const tickTimestamp = new Date();
      this.liveCache.recordSimulationTick(updates.length, tickTimestamp);

      for (let index = 0; index < updates.length; index += this.options.emitBatchSize) {
        const chunk = updates.slice(index, index + this.options.emitBatchSize);
        this.eventBus.emitPriceUpdates(chunk, tickTimestamp);
      }

      return {
        trigger,
        scannedProducts,
        updatedProducts: updates.length,
        startedAt: startedIso,
        completedAt: new Date().toISOString(),
        skipped: false
      };
    } finally {
      this.tickInFlight = false;
    }
  }
}
