export interface Product {
  id: string;
  name: string;
  price: number;
  originalPrice: number;
  supervised: boolean;
  anomalyScore?: number;
  lastAICheck?: Date;
  aiAction?: string | null;
}

export interface Metric {
  id: string;
  key: string;
  value: number;
  recordedAt: Date;
  supervised: boolean;
  anomalyScore?: number;
  aiAction?: string | null;
}

export interface PriceUpdate {
  productId: string;
  price: number;
  supervised: boolean;
  anomalyScore?: number;
}

export interface PriceUpdateBatchPayload {
  updates: PriceUpdate[];
  timestamp: string;
}

export interface AISupervisionEventPayload {
  type: 'price-anomaly';
  productId: string;
  anomalyScore: number;
  message: string;
  timestamp: string;
}

export type AuditMetadataValue = string | number | boolean | null;
export type AuditMetadata = Record<string, AuditMetadataValue>;

export type AIAuditSource = 'rule-engine' | 'external-ai' | 'manual';

export interface AIAuditLogEntry {
  id: string;
  productId: string;
  action: string;
  message: string;
  source: AIAuditSource;
  anomalyScore?: number;
  metadata?: AuditMetadata;
  timestamp: Date;
}
