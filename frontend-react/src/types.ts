export interface PriceHistoryPoint {
  date: string;
  price: number;
}

export enum MarketStatus {
  GREAT_DEAL = 'Great Deal (Sulit)',
  FAIR_VALUE = 'Fair Value (Sakto)',
  OVERPRICED = 'Overpriced (Mahal)',
  PRICE_GOUGING = 'Price Gouging (DTI Violation)',
  UNKNOWN = 'Unknown'
}

export type PhilippineRegion =
  | 'NCR'
  | 'CAR'
  | 'Region I'
  | 'Region II'
  | 'Region III'
  | 'Region IV-A'
  | 'Region IV-B'
  | 'Region V'
  | 'Region VI'
  | 'Region VII'
  | 'Region VIII'
  | 'Region IX'
  | 'Region X'
  | 'Region XI'
  | 'Region XII'
  | 'Caraga'
  | 'BARMM';

export type SellerType =
  | 'Supermarket'
  | 'Public Market (Palengke)'
  | 'Sari-sari Store'
  | 'Online (Lazada/Shopee)'
  | 'Drugstore'
  | 'Hardware'
  | 'Department Store';

export interface AnalysisResult {
  id: string;
  timestamp: number;
  productName: string;
  inputPrice: number;
  fairValue: number;
  srp?: number;
  status: MarketStatus;
  confidenceScore: number;
  reasoning: string;
  priceTrend: 'Increasing' | 'Decreasing' | 'Stable' | 'Volatile';
  historicalData: PriceHistoryPoint[];
  alternatives?: string[];
  region: PhilippineRegion;
  currency: 'PHP';
  compliance: {
    isVatInclusive: boolean;
    withinSrp: boolean;
    priceCeiling?: number;
  };
}

export interface ProductInput {
  name: string;
  price: string;
  category: string;
  details: string;
  region: PhilippineRegion;
  sellerType: SellerType;
  image?: string;
}

export interface BasicInput {
  text: string;
  image?: string;
}

export interface Alert {
  id: string;
  productId: string;
  targetPrice: number;
  currentPrice: number;
  status: 'active' | 'triggered';
  createdAt: string;
}

export interface Anomaly {
  id: string;
  product: string;
  region: string;
  deviation: number;
  riskLevel: 'Low' | 'Medium' | 'High' | 'Critical';
  detectedAt: string;
}

export type ViewState = 'consumer' | 'dashboard' | 'admin';

export type VoiceLanguage = 'en' | 'tl' | 'ceb';

export type CaptureSource = 'text' | 'voice' | 'image' | 'mixed';

export interface PriceLineExtractionResponse {
  input_text?: string;
  normalized_text?: string;
  translation_source?: string;
  canonical_source?: string;
  price_lines?: string[];
  raw_output?: string;
  model?: string;
}

export interface TranscribeAudioResponse {
  transcribed_text?: string;
  translated_text?: string;
  canonical_text?: string;
  source?: string;
  canonical_source?: string;
  price_lines?: string[];
  price_line_model?: string;
}

export interface AudioTranscriptResult {
  text: string;
  translatedText?: string;
  canonicalText?: string;
  source: 'browser-speech' | 'backend-transcribe';
  priceLines?: string[];
}

export interface ImageRecognitionResult {
  label: string;
  rawLabel: string;
  region: string;
  confidence: number;
  priceLines: string[];
  priceLineModel?: string | null;
  imageText?: string;
  visionSource?: string;
}

export interface LatestResult {
  source: CaptureSource;
  timestamp: number;
  textInput: string;
  productLabel: string;
  priceLines: string[];
}
