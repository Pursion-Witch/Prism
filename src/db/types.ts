export interface UserRow {
  id: string;
  email: string;
  name: string;
  created_at: Date;
}

export interface ProductRow {
  id: string;
  name: string;
  price: string;
  seller_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface AlertRow {
  id: string;
  user_id: string;
  type: string;
  message: string;
  occurred_at: Date;
  created_at: Date;
}

export interface LiveMetricRow {
  id: string;
  metric: string;
  value: number;
  recorded_at: Date;
  created_at: Date;
}

export interface PriceProductRow {
  id: string;
  name: string;
  category: string;
  avg_market_price: string;
  last_updated: Date;
  created_at: Date;
}

export interface PriceTransactionRow {
  id: string;
  product_id: string;
  price: string;
  region: string;
  anomaly_score: number;
  source: string;
  raw_text: string | null;
  created_at: Date;
}

export interface PriceAnalysisHistoryRow {
  id: string;
  product_id: string;
  product_name: string;
  category: string;
  price: string;
  fair_value: string;
  region: string;
  anomaly_score: number;
  source: string;
  raw_text: string | null;
  created_at: Date;
}

export interface MarketIndexRow {
  category: string;
  sample_count: number;
  avg_observed_price: string;
  avg_fair_value: string;
  last_updated: Date | null;
}

export interface CreateUserInput {
  id?: string;
  email: string;
  name: string;
  createdAt?: Date;
}

export interface CreateProductInput {
  id?: string;
  name: string;
  price: number;
  sellerId: string;
  createdAt?: Date;
}

export interface CreateAlertInput {
  id?: string;
  userId: string;
  type: string;
  message: string;
  occurredAt?: Date;
  createdAt?: Date;
}

export interface InsertMetricInput {
  id?: string;
  metric: string;
  value: number;
  recordedAt?: Date;
  createdAt?: Date;
}
