import fs from 'node:fs';
import path from 'node:path';
import type { Product } from '../types/realtime';

interface ProductSeedRow {
  id?: unknown;
  name?: unknown;
  price?: unknown;
  basePrice?: unknown;
  originalPrice?: unknown;
}

export interface LiveMetricsCache {
  tickCount: number;
  aiScanCount: number;
  anomaliesDetected: number;
  supervisedCount: number;
  lastTickAt?: Date;
  lastAIScanAt?: Date;
}

export interface SeedProductsOptions {
  maxProducts?: number;
  productsFilePath?: string;
}

function toFinitePositiveNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function parseSeedRow(row: ProductSeedRow): Product | null {
  if (typeof row.id !== 'string' || row.id.trim().length === 0) {
    return null;
  }
  if (typeof row.name !== 'string' || row.name.trim().length === 0) {
    return null;
  }

  const normalizedOriginalPrice =
    toFinitePositiveNumber(row.originalPrice) ??
    toFinitePositiveNumber(row.basePrice) ??
    toFinitePositiveNumber(row.price);

  if (normalizedOriginalPrice === null) {
    return null;
  }

  const normalizedPrice = toFinitePositiveNumber(row.price) ?? normalizedOriginalPrice;

  return {
    id: row.id.trim(),
    name: row.name.trim(),
    price: normalizedPrice,
    originalPrice: normalizedOriginalPrice,
    supervised: false,
    anomalyScore: 0,
    aiAction: null
  };
}

function createSyntheticProducts(count: number): Product[] {
  const products: Product[] = [];

  for (let index = 0; index < count; index += 1) {
    const baseline = Number((5 + ((index % 500) * 0.55 + Math.random() * 4)).toFixed(2));
    products.push({
      id: `SIM-${index + 1}`,
      name: `Simulated Product ${index + 1}`,
      price: baseline,
      originalPrice: baseline,
      supervised: false,
      anomalyScore: 0,
      aiAction: null
    });
  }

  return products;
}

export function loadSeedProducts(options: SeedProductsOptions = {}): Product[] {
  const maxProducts = Number.isFinite(options.maxProducts) ? Math.max(1, Number(options.maxProducts)) : 2_000;
  const defaultProductsPath = path.join(process.cwd(), 'data', 'products.json');
  const productsFilePath = options.productsFilePath ?? defaultProductsPath;

  try {
    if (!fs.existsSync(productsFilePath)) {
      return createSyntheticProducts(maxProducts);
    }

    const raw = fs.readFileSync(productsFilePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return createSyntheticProducts(maxProducts);
    }

    const loaded: Product[] = [];
    for (const row of parsed) {
      if (loaded.length >= maxProducts) {
        break;
      }
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        continue;
      }

      const product = parseSeedRow(row as ProductSeedRow);
      if (product) {
        loaded.push(product);
      }
    }

    return loaded.length > 0 ? loaded : createSyntheticProducts(maxProducts);
  } catch (error) {
    console.warn('[live-cache] failed to load seed products, using synthetic data', error);
    return createSyntheticProducts(maxProducts);
  }
}

export class LiveCache {
  private readonly liveProducts: Map<string, Product>;

  private readonly liveMetrics: LiveMetricsCache = {
    tickCount: 0,
    aiScanCount: 0,
    anomaliesDetected: 0,
    supervisedCount: 0
  };

  constructor(products: ReadonlyArray<Product>) {
    this.liveProducts = new Map(products.map((product) => [product.id, product]));
    this.liveMetrics.supervisedCount = products.filter((product) => product.supervised).length;
  }

  size(): number {
    return this.liveProducts.size;
  }

  getProduct(productId: string): Product | undefined {
    return this.liveProducts.get(productId);
  }

  getProductsSnapshot(): Product[] {
    return [...this.liveProducts.values()].map((product) => ({ ...product }));
  }

  forEachProduct(visitor: (product: Product) => void): void {
    for (const product of this.liveProducts.values()) {
      visitor(product);
    }
  }

  upsertProduct(product: Product): void {
    this.liveProducts.set(product.id, product);
  }

  toggleProductSupervision(productId: string): Product | null {
    const product = this.liveProducts.get(productId);
    if (!product) {
      return null;
    }

    product.supervised = !product.supervised;
    product.aiAction = product.supervised ? 'manual-enable-supervision' : 'manual-disable-supervision';
    product.lastAICheck = new Date();
    if (!product.supervised) {
      product.anomalyScore = 0;
    }

    this.liveMetrics.supervisedCount += product.supervised ? 1 : -1;
    if (this.liveMetrics.supervisedCount < 0) {
      this.liveMetrics.supervisedCount = 0;
    }

    return product;
  }

  setSupervisedCount(value: number): void {
    this.liveMetrics.supervisedCount = Math.max(0, value);
  }

  recordSimulationTick(updatedCount: number, timestamp: Date): void {
    this.liveMetrics.tickCount += 1;
    this.liveMetrics.lastTickAt = timestamp;
    if (updatedCount < 0) {
      return;
    }
  }

  recordAIScan(anomalyCount: number, supervisedCount: number, timestamp: Date): void {
    this.liveMetrics.aiScanCount += 1;
    this.liveMetrics.anomaliesDetected = anomalyCount;
    this.liveMetrics.supervisedCount = Math.max(0, supervisedCount);
    this.liveMetrics.lastAIScanAt = timestamp;
  }

  getMetricsSnapshot(): LiveMetricsCache {
    return { ...this.liveMetrics };
  }
}
