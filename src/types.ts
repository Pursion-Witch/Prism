export interface AnalyzeProductPriceRequest {
  name: string;
  price: number;
  region?: string;
  category?: string;
  rawText?: string;
}

export interface AnalyzeRawProductTextRequest {
  text: string;
  region?: string;
  category?: string;
}

export interface ParsedRawProductText {
  rawText: string;
  name: string;
  price: number;
  category: string;
}

export type PriceVerdict = 'high-risk' | 'overpriced' | 'fair' | 'cheap' | 'steal';

export interface ProductPriceAnalysisResult {
  productName: string;
  normalizedName: string;
  category: string;
  region: string;
  observedPrice: number;
  fairValue: number;
  ratio: number;
  confidenceScore: number;
  anomalyScore: number;
  verdict: PriceVerdict;
  message: string;
  summary: string;
  source: 'gemini' | 'heuristic';
  historicalAverage: number | null;
}

export interface AnalysisHistoryItem {
  id: string;
  productId: string;
  productName: string;
  category: string;
  observedPrice: number;
  fairValue: number;
  region: string;
  anomalyScore: number;
  source: string;
  rawText: string | null;
  createdAt: string;
}

export interface MarketIndexItem {
  category: string;
  sampleCount: number;
  avgObservedPrice: number;
  avgFairValue: number;
  variancePct: number;
  lastUpdated: string | null;
}
