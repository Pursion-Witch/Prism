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
  srp?: number | null;
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
    priceCeiling?: number | null;
  };
  priceLines?: string[];
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
