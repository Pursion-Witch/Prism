import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  assessPrice,
  buildAdminSnapshot,
  executeAiDataCommand,
  inferAdminModuleFromPayload,
  ingestDocumentToBaseline,
  isExpensiveFlag,
  normalizeItemName,
  parseAiCommandBody,
  parseAiTextCommand,
  readBaselineFile,
  resolveAdminModuleAlias,
  writeBaselineFile,
  type AdminCollections,
  type AdminModule,
  type AiDataCommand,
  type BaselineMap,
  type PriceFlag
} from './ai';
import {
  analyzeImagePayload,
  buildKnowledgeNarrative,
  buildScannerResult,
  type ScannerSourceRecord
} from './ai-runtime';

type ApiFlag = PriceFlag | 'unknown' | 'invalid';
type MaintenanceTrigger = 'startup' | 'minute' | 'hourly' | 'manual';
type FeedbackLevel = 'info' | 'warning' | 'critical';
type SnapshotMetrics = ReturnType<typeof buildAdminSnapshot>['metrics'];

interface RecommendationRow {
  item: string;
  price: number;
  flag: ApiFlag;
  message: string;
  expectedPrice?: number;
}

interface LiveFeedbackEvent {
  id: string;
  ts: string;
  scope: string;
  level: FeedbackLevel;
  message: string;
  trigger?: MaintenanceTrigger;
  data?: Record<string, unknown>;
}

interface MaintenanceRunSummary {
  ok: boolean;
  trigger: MaintenanceTrigger;
  startedAt: string;
  completedAt: string;
  createdMonitoring: number;
  resolvedAlerts: number;
  deletedMonitoring: number;
  deletedAlerts: number;
  openAlerts: number;
  highRiskCount: number;
  summary: string;
  actions: string[];
  metrics: SnapshotMetrics;
  message: string;
}

interface KnowledgeBaseEntry {
  id: string;
  trigger: MaintenanceTrigger;
  generatedAt: string;
  summary: string;
  actions: string[];
  maintenance: Omit<MaintenanceRunSummary, 'summary' | 'actions'>;
  metrics: SnapshotMetrics;
}

interface KnowledgeBaseDocument {
  updatedAt: string;
  summary: string;
  actions: string[];
  lastRun: MaintenanceRunSummary | null;
  history: KnowledgeBaseEntry[];
}

interface MinuteTickSummary {
  ok: boolean;
  trigger: MaintenanceTrigger;
  updatedAt: string;
  updatedRows: number;
  metrics: SnapshotMetrics;
  source: 'live' | 'simulated';
  message: string;
}

interface LiveTrendPoint {
  ts: string;
  value: number;
}

interface LiveMetricsSnapshot {
  updatedAt: string;
  tickCount: number;
  metrics: SnapshotMetrics;
  chart: {
    varianceTrend: LiveTrendPoint[];
    fairnessTrend: LiveTrendPoint[];
    savingsTrend: LiveTrendPoint[];
  };
  source: 'live' | 'simulated';
}

const app = express();
const port = Number(process.env.PORT ?? 3000);

const rootDir = path.join(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const dataDir = path.join(rootDir, 'data');
const baselinePath = path.join(dataDir, 'baseline.json');
const userMonitoringPath = path.join(dataDir, 'user-monitoring.json');
const marketplaceSpecialUsersPath = path.join(dataDir, 'marketplace-special-users.json');
const marketplaceDir = path.join(dataDir, 'marketplaces');
const marketplaceIndexPath = path.join(marketplaceDir, 'index.json');
const ingestionAuditPath = path.join(dataDir, 'ingestion-audit.ndjson');
const knowledgeBasePath = path.join(dataDir, 'ai-knowledge-base.json');
const liveFeedbackPath = path.join(dataDir, 'live-feedback.ndjson');
const liveMetricsPath = path.join(dataDir, 'live-metrics.json');
const maxBodyLimit = process.env.MAX_BODY_LIMIT ?? '1024mb';
const aiMinuteEnabled = process.env.AI_MINUTE_ENABLED?.trim().toLowerCase() === 'true';
const aiMinuteIntervalMs = Number.isFinite(Number(process.env.AI_MINUTE_INTERVAL_MS))
  ? Math.max(15000, Number(process.env.AI_MINUTE_INTERVAL_MS))
  : 60 * 1000;
const aiHourlyEnabled = process.env.AI_HOURLY_ENABLED?.trim().toLowerCase() === 'true';
const aiHourlyIntervalMs = Number.isFinite(Number(process.env.AI_HOURLY_INTERVAL_MS))
  ? Math.max(60000, Number(process.env.AI_HOURLY_INTERVAL_MS))
  : 60 * 60 * 1000;
const maxMonitoringRows = Number.isFinite(Number(process.env.AI_MAX_MONITORING_ROWS))
  ? Math.max(200, Number(process.env.AI_MAX_MONITORING_ROWS))
  : 6000;
const maxAlertRows = Number.isFinite(Number(process.env.AI_MAX_ALERT_ROWS))
  ? Math.max(200, Number(process.env.AI_MAX_ALERT_ROWS))
  : 2500;

const liveFeedbackClients = new Set<Response>();
let maintenanceInFlight = false;
let lastMaintenanceRun: MaintenanceRunSummary | null = null;
let maintenanceTimer: NodeJS.Timeout | null = null;
let minuteTickInFlight = false;
let minuteTimer: NodeJS.Timeout | null = null;

type MarketplaceId =
  | 'lazada'
  | 'shopee'
  | 'puregold'
  | 'sm-supermarket'
  | 'robinsons-supermarket'
  | 'waltermart';

interface MarketplaceCatalogRecord {
  id: string;
  marketplaceId: MarketplaceId;
  marketplaceName: string;
  name: string;
  category: string;
  supplier: string;
  basePrice: number;
  listedPrice: number;
  location: string;
  rating: number;
  stock: number;
  status: 'active' | 'low-stock' | 'hidden';
  createdAt: string;
  updatedAt: string;
}

interface MarketplaceDescriptor {
  id: MarketplaceId;
  name: string;
  region: string;
  channel: 'online' | 'retail';
  priceFactor: number;
}

interface UserMonitoringRecord {
  id: string;
  userId: string;
  userName: string;
  eventType: string;
  severity: 'info' | 'warning' | 'critical';
  ipAddress: string;
  location: string;
  device: string;
  notes: string;
  timestamp: string;
}

interface MarketplaceSpecialUser {
  id: string;
  marketplaceId: MarketplaceId;
  marketplaceName: string;
  userId: string;
  name: string;
  email: string;
  title: string;
  permissions: string[];
  status: 'active' | 'on-leave' | 'suspended';
  createdAt: string;
  updatedAt: string;
}

const moduleFileMap: Record<AdminModule, string> = {
  users: path.join(dataDir, 'users.json'),
  products: path.join(dataDir, 'products.json'),
  priceMonitoring: path.join(dataDir, 'price-monitoring.json'),
  alerts: path.join(dataDir, 'alerts.json'),
  reports: path.join(dataDir, 'reports.json')
};

const defaultBaseline: BaselineMap = {
  'doedil ni gian': 450,
  'fresh milk': 120,
  'sinandomeng rice': 52,
  'whole chicken': 180,
  'cooking oil': 45,
  'red onions': 140,
  'pork liempo': 340
};

const defaultMarketplaceDescriptors: MarketplaceDescriptor[] = [
  { id: 'lazada', name: 'Lazada Philippines', region: 'National', channel: 'online', priceFactor: 1.06 },
  { id: 'shopee', name: 'Shopee Philippines', region: 'National', channel: 'online', priceFactor: 1.03 },
  { id: 'puregold', name: 'Puregold', region: 'NCR + Luzon', channel: 'retail', priceFactor: 0.98 },
  { id: 'sm-supermarket', name: 'SM Supermarket', region: 'National', channel: 'retail', priceFactor: 1.0 },
  { id: 'robinsons-supermarket', name: 'Robinsons Supermarket', region: 'National', channel: 'retail', priceFactor: 1.01 },
  { id: 'waltermart', name: 'Waltermart', region: 'Luzon', channel: 'retail', priceFactor: 0.99 }
];

const supplierByCategory: Record<string, string> = {
  'Rice & Grains': 'Grainline Foods',
  'Meat & Seafood': 'FarmFresh',
  Vegetables: 'Palengke Direct',
  Fruits: 'Harvest Hub',
  'Dairy & Eggs': 'Dairy Works',
  Essentials: 'Tindahan PH',
  Canned: 'Tindahan PH',
  Beverages: 'Morning Cup',
  'Personal Care': 'Care Mart',
  'Household': 'Home Guard Supplies'
};

const everydayGoodsByCategory: Record<string, Array<{ name: string; basePrice: number }>> = {
  'Rice & Grains': [
    { name: 'Sinandomeng Rice 5kg', basePrice: 265 },
    { name: 'Jasmine Rice 5kg', basePrice: 290 },
    { name: 'Dinorado Rice 5kg', basePrice: 320 },
    { name: 'Brown Rice 2kg', basePrice: 180 },
    { name: 'Premium Rice 10kg', basePrice: 590 },
    { name: 'Corn Grits 1kg', basePrice: 58 },
    { name: 'Rolled Oats 1kg', basePrice: 145 },
    { name: 'All-Purpose Flour 1kg', basePrice: 72 },
    { name: 'Pandesal Flour Mix 1kg', basePrice: 83 },
    { name: 'Mung Beans 1kg', basePrice: 110 },
    { name: 'White Quinoa 500g', basePrice: 165 },
    { name: 'Garbanzos 500g', basePrice: 95 }
  ],
  'Meat & Seafood': [
    { name: 'Whole Chicken 1kg', basePrice: 188 },
    { name: 'Pork Liempo 1kg', basePrice: 348 },
    { name: 'Ground Pork 1kg', basePrice: 305 },
    { name: 'Beef Sirloin 1kg', basePrice: 540 },
    { name: 'Chicken Breast 1kg', basePrice: 242 },
    { name: 'Chicken Thigh 1kg', basePrice: 210 },
    { name: 'Bangus 1kg', basePrice: 205 },
    { name: 'Tilapia 1kg', basePrice: 175 },
    { name: 'Galunggong 1kg', basePrice: 165 },
    { name: 'Shrimp Medium 500g', basePrice: 260 },
    { name: 'Squid 500g', basePrice: 245 },
    { name: 'Tuna Steak 500g', basePrice: 280 },
    { name: 'Hotdog Regular 1kg', basePrice: 178 },
    { name: 'Bacon Strips 500g', basePrice: 198 }
  ],
  Vegetables: [
    { name: 'Red Onions 1kg', basePrice: 145 },
    { name: 'Garlic 1kg', basePrice: 126 },
    { name: 'Potatoes 1kg', basePrice: 87 },
    { name: 'Tomatoes 1kg', basePrice: 82 },
    { name: 'Carrots 1kg', basePrice: 93 },
    { name: 'Cabbage 1kg', basePrice: 64 },
    { name: 'Pechay 1 bunch', basePrice: 38 },
    { name: 'Talong 1kg', basePrice: 76 },
    { name: 'Ampalaya 1kg', basePrice: 88 },
    { name: 'Sayote 1kg', basePrice: 54 },
    { name: 'Kalabasa 1kg', basePrice: 60 },
    { name: 'Okra 500g', basePrice: 42 },
    { name: 'Sitao 500g', basePrice: 44 },
    { name: 'Bell Pepper 500g', basePrice: 95 },
    { name: 'Lettuce 1 head', basePrice: 58 }
  ],
  Fruits: [
    { name: 'Banana Lakatan 1kg', basePrice: 96 },
    { name: 'Apple Red 1kg', basePrice: 190 },
    { name: 'Orange 1kg', basePrice: 165 },
    { name: 'Mango Ripe 1kg', basePrice: 175 },
    { name: 'Pineapple Whole', basePrice: 82 },
    { name: 'Watermelon 1kg', basePrice: 58 },
    { name: 'Papaya 1kg', basePrice: 72 },
    { name: 'Grapes 500g', basePrice: 185 },
    { name: 'Pear 1kg', basePrice: 178 },
    { name: 'Calamansi 500g', basePrice: 76 },
    { name: 'Lemon 500g', basePrice: 88 },
    { name: 'Avocado 1kg', basePrice: 145 }
  ],
  'Dairy & Eggs': [
    { name: 'Fresh Milk 1L', basePrice: 122 },
    { name: 'Evaporated Milk 370ml', basePrice: 36 },
    { name: 'Condensed Milk 300ml', basePrice: 52 },
    { name: 'Cheddar Cheese 200g', basePrice: 98 },
    { name: 'Yogurt Plain 500g', basePrice: 124 },
    { name: 'Butter 225g', basePrice: 112 },
    { name: 'Eggs 12pcs', basePrice: 104 },
    { name: 'Eggs 30pcs', basePrice: 245 }
  ],
  Essentials: [
    { name: 'Cooking Oil 1L', basePrice: 48 },
    { name: 'Refined Sugar 1kg', basePrice: 97 },
    { name: 'Brown Sugar 1kg', basePrice: 88 },
    { name: 'Rock Salt 1kg', basePrice: 35 },
    { name: 'Iodized Salt 1kg', basePrice: 42 },
    { name: 'Soy Sauce 1L', basePrice: 62 },
    { name: 'Vinegar 1L', basePrice: 50 },
    { name: 'Fish Sauce 500ml', basePrice: 46 },
    { name: 'Banana Ketchup 550g', basePrice: 58 },
    { name: 'Tomato Sauce 1kg', basePrice: 73 },
    { name: 'Oyster Sauce 385g', basePrice: 69 },
    { name: 'Mayonnaise 470ml', basePrice: 98 }
  ],
  Canned: [
    { name: 'Sardines 155g', basePrice: 23 },
    { name: 'Corned Beef 380g', basePrice: 89 },
    { name: 'Tuna Flakes 180g', basePrice: 44 },
    { name: 'Pork and Beans 220g', basePrice: 35 },
    { name: 'Canned Mushroom 198g', basePrice: 66 },
    { name: 'Peas and Carrots 400g', basePrice: 54 },
    { name: 'Fruit Cocktail 836g', basePrice: 122 },
    { name: 'Tomato Paste 150g', basePrice: 32 },
    { name: 'Spam Style Luncheon Meat 340g', basePrice: 155 },
    { name: 'Canned Corn Kernel 425g', basePrice: 52 }
  ],
  Beverages: [
    { name: 'Coffee 3-in-1 30s', basePrice: 156 },
    { name: 'Instant Coffee 100g', basePrice: 122 },
    { name: 'Chocolate Drink 1kg', basePrice: 175 },
    { name: 'Orange Juice 1L', basePrice: 98 },
    { name: 'Apple Juice 1L', basePrice: 102 },
    { name: 'Soda Cola 1.5L', basePrice: 82 },
    { name: 'Bottled Water 6L', basePrice: 96 },
    { name: 'Energy Drink 330ml', basePrice: 52 },
    { name: 'Milk Tea Powder 1kg', basePrice: 210 },
    { name: 'Green Tea Bags 25s', basePrice: 88 }
  ],
  'Personal Care': [
    { name: 'Bath Soap 135g', basePrice: 42 },
    { name: 'Shampoo 340ml', basePrice: 176 },
    { name: 'Conditioner 340ml', basePrice: 168 },
    { name: 'Toothpaste 145g', basePrice: 84 },
    { name: 'Toothbrush 2-pack', basePrice: 78 },
    { name: 'Body Lotion 200ml', basePrice: 138 },
    { name: 'Deodorant 50ml', basePrice: 126 },
    { name: 'Alcohol 500ml', basePrice: 88 },
    { name: 'Facial Cleanser 100ml', basePrice: 146 },
    { name: 'Hand Soap 250ml', basePrice: 68 }
  ],
  Household: [
    { name: 'Dishwashing Liquid 500ml', basePrice: 76 },
    { name: 'Laundry Detergent 1kg', basePrice: 118 },
    { name: 'Fabric Conditioner 800ml', basePrice: 112 },
    { name: 'Bleach 1L', basePrice: 52 },
    { name: 'Multi-surface Cleaner 500ml', basePrice: 84 },
    { name: 'Floor Cleaner 1L', basePrice: 92 },
    { name: 'Kitchen Towels 2 rolls', basePrice: 98 },
    { name: 'Bathroom Tissue 12 rolls', basePrice: 186 },
    { name: 'Trash Bags Medium 30s', basePrice: 74 },
    { name: 'Aluminum Foil 25m', basePrice: 88 }
  ]
};

function buildMarketplaceCatalogTemplates(limit = 100): Array<{
  name: string;
  category: string;
  supplier: string;
  basePrice: number;
}> {
  const flattened = Object.entries(everydayGoodsByCategory).flatMap(([category, rows]) =>
    rows.map((row) => ({
      name: row.name,
      category,
      supplier: supplierByCategory[category] ?? 'Daily Essentials Hub',
      basePrice: row.basePrice
    }))
  );

  return flattened.slice(0, limit);
}

const marketplaceCatalogTemplates = buildMarketplaceCatalogTemplates(100);

const defaultCollections: AdminCollections = {
  users: [
    {
      id: 'USR-001',
      name: 'Maria Santos',
      email: 'maria@email.com',
      role: 'consumer',
      status: 'active',
      createdAt: '2026-03-01T08:00:00.000Z',
      updatedAt: '2026-03-01T08:00:00.000Z'
    },
    {
      id: 'USR-002',
      name: 'Juan Dela Cruz',
      email: 'juan@supplier.com',
      role: 'supplier',
      status: 'active',
      createdAt: '2026-03-01T08:02:00.000Z',
      updatedAt: '2026-03-01T08:02:00.000Z'
    },
    {
      id: 'USR-003',
      name: 'DTI Officer',
      email: 'dti@gov.ph',
      role: 'agency',
      status: 'active',
      createdAt: '2026-03-01T08:04:00.000Z',
      updatedAt: '2026-03-01T08:04:00.000Z'
    },
    {
      id: 'USR-004',
      name: 'Test User',
      email: 'test@email.com',
      role: 'consumer',
      status: 'pending',
      createdAt: '2026-03-01T08:06:00.000Z',
      updatedAt: '2026-03-01T08:06:00.000Z'
    }
  ],
  products: [
    {
      id: 'PRD-101',
      name: 'Sinandomeng Rice',
      category: 'Rice',
      supplier: 'Mega Mart',
      basePrice: 52,
      status: 'active',
      imageName: 'sinandomeng-rice.jpg',
      imageText: 'Sinandomeng Rice Premium 50kg',
      createdAt: '2026-03-01T08:10:00.000Z',
      updatedAt: '2026-03-01T08:10:00.000Z'
    },
    {
      id: 'PRD-102',
      name: 'Whole Chicken',
      category: 'Meat',
      supplier: 'FarmFresh',
      basePrice: 180,
      status: 'active',
      createdAt: '2026-03-01T08:12:00.000Z',
      updatedAt: '2026-03-01T08:12:00.000Z'
    },
    {
      id: 'PRD-103',
      name: 'Cooking Oil',
      category: 'Canned',
      supplier: 'Tindahan PH',
      basePrice: 45,
      status: 'low-stock',
      createdAt: '2026-03-01T08:14:00.000Z',
      updatedAt: '2026-03-01T08:14:00.000Z'
    },
    {
      id: 'PRD-104',
      name: 'Red Onions',
      category: 'Vegetables',
      supplier: 'Palengke Direct',
      basePrice: 140,
      status: 'active',
      createdAt: '2026-03-01T08:16:00.000Z',
      updatedAt: '2026-03-01T08:16:00.000Z'
    }
  ],
  priceMonitoring: [
    {
      id: 'PM-1001',
      item: 'red onions',
      observedPrice: 199,
      expectedPrice: 140,
      ratio: 1.42,
      ratioBand: 'high-risk',
      ratioStart: '>= 1.30x',
      flagColor: '#ff5a5a',
      differencePct: 42.14,
      flag: 'high-risk',
      location: 'Metro Manila',
      source: 'market scan',
      message: 'High-risk price for red onions: expected around PHP 140.00, observed PHP 199.00.',
      recordedAt: '2026-03-01T08:20:00.000Z'
    },
    {
      id: 'PM-1002',
      item: 'pork liempo',
      observedPrice: 415,
      expectedPrice: 340,
      ratio: 1.22,
      ratioBand: 'overpriced',
      ratioStart: '>= 1.10x',
      flagColor: '#ff9f1a',
      differencePct: 22.06,
      flag: 'overpriced',
      location: 'Quezon City',
      source: 'market scan',
      message: 'Slightly overpriced pork liempo: expected around PHP 340.00, observed PHP 415.00.',
      recordedAt: '2026-03-01T08:22:00.000Z'
    },
    {
      id: 'PM-1003',
      item: 'cooking oil',
      observedPrice: 44,
      expectedPrice: 45,
      ratio: 0.98,
      ratioBand: 'fair',
      ratioStart: '>= 0.90x',
      flagColor: '#1ed760',
      differencePct: -2.22,
      flag: 'fair',
      location: 'Manila',
      source: 'market scan',
      message: 'Fair price for cooking oil. Baseline is around PHP 45.00.',
      recordedAt: '2026-03-01T08:24:00.000Z'
    }
  ],
  alerts: [
    {
      id: 'ALT-9001',
      title: 'Price surge detected',
      message: 'Red onions up 42% in Metro Manila',
      type: 'price',
      priority: 'high',
      status: 'open',
      issueLabel: 'Price Issue',
      displayColor: '#ff5a5a',
      displayIcon: 'price-tag',
      displayBackground: 'rgba(255,90,90,0.16)',
      relatedEntityId: 'PM-1001',
      createdAt: '2026-03-01T08:25:00.000Z',
      updatedAt: '2026-03-01T08:25:00.000Z'
    },
    {
      id: 'ALT-9002',
      title: 'New supplier pending approval',
      message: 'Fresh Farms Inc. is waiting for verification',
      type: 'supplier',
      priority: 'medium',
      status: 'open',
      issueLabel: 'Supplier Issue',
      displayColor: '#ffaa33',
      displayIcon: 'truck',
      displayBackground: 'rgba(255,170,51,0.16)',
      createdAt: '2026-03-01T08:27:00.000Z',
      updatedAt: '2026-03-01T08:27:00.000Z'
    },
    {
      id: 'ALT-9003',
      title: 'User report submitted',
      message: 'Five users flagged the same price anomaly',
      type: 'user',
      priority: 'medium',
      status: 'acknowledged',
      issueLabel: 'User Issue',
      displayColor: '#ffaa33',
      displayIcon: 'user',
      displayBackground: 'rgba(255,170,51,0.16)',
      createdAt: '2026-03-01T08:28:00.000Z',
      updatedAt: '2026-03-01T08:28:00.000Z'
    }
  ],
  reports: [
    {
      id: 'RPT-7001',
      title: 'Monthly Price Report',
      period: 'monthly',
      generatedAt: '2026-03-01T08:30:00.000Z',
      metrics: {
        averageFairness: 50,
        flaggedListings: 2,
        highRiskCount: 1,
        underpricedCount: 0,
        totalUsers: 4,
        totalProducts: 4,
        openAlerts: 3,
        estimatedSavings: 1
      },
      summary: 'Monthly report generated for March 2026 baseline.'
    }
  ]
};

function marketplaceFilePath(marketplaceId: string): string {
  const safeName = marketplaceId.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  return path.join(marketplaceDir, `${safeName}.json`);
}

function normalizeMarketplaceId(value: string): MarketplaceId | null {
  const normalized = value.trim().toLowerCase();
  const allIds = defaultMarketplaceDescriptors.map((entry) => entry.id);
  return allIds.includes(normalized as MarketplaceId) ? (normalized as MarketplaceId) : null;
}

function appendIngestionAudit(event: Record<string, unknown>): void {
  const payload = JSON.stringify({
    ...event,
    ts: new Date().toISOString()
  });
  ensureDirectory(path.dirname(ingestionAuditPath));
  fs.appendFileSync(ingestionAuditPath, `${payload}\n`, 'utf-8');
}

function createMarketplaceSeed(descriptor: MarketplaceDescriptor): MarketplaceCatalogRecord[] {
  const nowIso = new Date().toISOString();
  return marketplaceCatalogTemplates.map((template, index) => {
    const listedPrice = Number((template.basePrice * descriptor.priceFactor).toFixed(2));
    const stock = 12 + ((index * 17) % 180);
    return {
      id: `MKT-${descriptor.id.toUpperCase()}-${String(index + 1).padStart(3, '0')}`,
      marketplaceId: descriptor.id,
      marketplaceName: descriptor.name,
      name: template.name,
      category: template.category,
      supplier: template.supplier,
      basePrice: template.basePrice,
      listedPrice,
      location: descriptor.region,
      rating: Number((4.2 + ((index % 7) * 0.1)).toFixed(1)),
      stock,
      status: stock <= 20 ? 'low-stock' : 'active',
      createdAt: nowIso,
      updatedAt: nowIso
    };
  });
}

function createExtendedUsers(seedUsers: AdminCollections['users'], targetCount = 180): AdminCollections['users'] {
  const firstNames = [
    'Aira', 'Ben', 'Carlos', 'Diana', 'Ethan', 'Faith', 'Gina', 'Harold', 'Ivy', 'Jared',
    'Kim', 'Liam', 'Mia', 'Noel', 'Olive', 'Paolo', 'Quincy', 'Rica', 'Sean', 'Tina'
  ];
  const lastNames = [
    'Santos', 'Dela Cruz', 'Reyes', 'Gonzales', 'Lim', 'Torres', 'Aquino', 'Villanueva', 'Tan', 'Castro'
  ];
  const roles: Array<'consumer' | 'supplier' | 'agency'> = [
    'consumer',
    'consumer',
    'consumer',
    'supplier',
    'supplier',
    'agency'
  ];
  const statuses: Array<'active' | 'pending' | 'suspended'> = ['active', 'active', 'pending', 'active', 'suspended'];
  const now = Date.now();

  const expanded = [...seedUsers];
  let index = 0;
  while (expanded.length < targetCount) {
    const first = firstNames[index % firstNames.length];
    const last = lastNames[Math.floor(index / firstNames.length) % lastNames.length];
    const id = `USR-${String(expanded.length + 1).padStart(3, '0')}`;
    const created = new Date(now - index * 3600000).toISOString();
    expanded.push({
      id,
      name: `${first} ${last}`,
      email: `${first.toLowerCase()}.${last.toLowerCase().replace(/\s+/g, '')}${expanded.length + 1}@example.com`,
      role: roles[index % roles.length],
      status: statuses[index % statuses.length],
      createdAt: created,
      updatedAt: created
    });
    index += 1;
  }

  return expanded;
}

function createUserMonitoringSeed(users: AdminCollections['users'], targetCount = 600): UserMonitoringRecord[] {
  const events = ['login', 'price-check', 'report-submission', 'profile-update', 'catalog-view', 'alert-review'];
  const devices = ['Web Chrome', 'Web Firefox', 'Android App', 'iOS App', 'Web Safari'];
  const locations = ['Cebu City', 'Quezon City', 'Davao City', 'Makati', 'Iloilo', 'Cagayan de Oro'];
  const now = Date.now();
  const entries: UserMonitoringRecord[] = [];

  for (let i = 0; i < targetCount; i += 1) {
    const user = users[i % users.length];
    const eventType = events[i % events.length];
    const severity: UserMonitoringRecord['severity'] =
      eventType === 'report-submission' ? 'warning' : i % 17 === 0 ? 'critical' : 'info';
    const time = new Date(now - i * 900000).toISOString();
    entries.push({
      id: `UM-${String(i + 1).padStart(5, '0')}`,
      userId: user.id,
      userName: user.name,
      eventType,
      severity,
      ipAddress: `192.168.${(i % 80) + 10}.${(i % 200) + 20}`,
      location: locations[i % locations.length],
      device: devices[i % devices.length],
      notes: `${eventType} recorded by monitoring engine`,
      timestamp: time
    });
  }

  return entries;
}

function createMarketplaceSpecialUsersSeed(
  users: AdminCollections['users'],
  descriptors: MarketplaceDescriptor[]
): MarketplaceSpecialUser[] {
  const preferredUsers = users.filter((user) => user.role === 'supplier' || user.role === 'agency');
  const fallbackUsers = users.length > 0 ? users : createExtendedUsers(defaultCollections.users, 180);
  const sourceUsers = preferredUsers.length > 0 ? preferredUsers : fallbackUsers;
  const titles = ['Marketplace Admin', 'Price Analyst', 'Catalog Curator', 'Compliance Officer', 'Fraud Reviewer'];
  const permissionsByTitle: Record<string, string[]> = {
    'Marketplace Admin': ['catalog:write', 'prices:write', 'alerts:write', 'users:review'],
    'Price Analyst': ['prices:read', 'prices:write', 'reports:generate'],
    'Catalog Curator': ['catalog:read', 'catalog:write'],
    'Compliance Officer': ['alerts:read', 'alerts:write', 'users:review'],
    'Fraud Reviewer': ['alerts:read', 'monitoring:read', 'users:review']
  };

  const records: MarketplaceSpecialUser[] = [];
  let offset = 0;
  for (const descriptor of descriptors) {
    for (const title of titles) {
      const user = sourceUsers[offset % sourceUsers.length];
      const createdAt = new Date(Date.now() - offset * 5400000).toISOString();
      records.push({
        id: `MSU-${descriptor.id.toUpperCase()}-${String((offset % titles.length) + 1).padStart(2, '0')}-${String(
          Math.floor(offset / titles.length) + 1
        ).padStart(2, '0')}`,
        marketplaceId: descriptor.id,
        marketplaceName: descriptor.name,
        userId: user.id,
        name: user.name,
        email: user.email,
        title,
        permissions: permissionsByTitle[title] ?? ['catalog:read'],
        status: offset % 13 === 0 ? 'on-leave' : offset % 19 === 0 ? 'suspended' : 'active',
        createdAt,
        updatedAt: createdAt
      });
      offset += 1;
    }
  }

  return records;
}

function collectHtmlPages(directory: string, nestedPath = ''): string[] {
  const absoluteDirectory = nestedPath ? path.join(directory, nestedPath) : directory;
  const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true });
  const pages: string[] = [];

  for (const entry of entries) {
    const relativePath = nestedPath ? path.join(nestedPath, entry.name) : entry.name;

    if (entry.isDirectory()) {
      pages.push(...collectHtmlPages(directory, relativePath));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
      pages.push(relativePath);
    }
  }

  return pages;
}

function toRoutePath(relativeFilePath: string): string {
  return `/${relativeFilePath.split(path.sep).join('/')}`;
}

function buildPageRedirects(pageRoutes: string[]): Map<string, string> {
  const redirects = new Map<string, string>();
  const knownRoutes = new Set(pageRoutes);
  const topLevelPages = new Map<string, string[]>();

  for (const routePath of pageRoutes) {
    const segments = routePath.split('/').filter(Boolean);

    if (segments.length !== 2) {
      continue;
    }

    const [folder] = segments;
    const folderPages = topLevelPages.get(folder) ?? [];
    folderPages.push(routePath);
    topLevelPages.set(folder, folderPages);
  }

  for (const [folder, routes] of topLevelPages.entries()) {
    if (routes.length !== 1) {
      continue;
    }

    const canonicalRoute = routes[0];
    redirects.set(`/${folder}`, canonicalRoute);
    redirects.set(`/${folder}/`, canonicalRoute);
    redirects.set(`/${folder}.html`, canonicalRoute);
  }

  const homeCandidates = ['/home-page/home-page.html', '/login/login.html', '/about/about.html'];
  const homePage = homeCandidates.find((candidate) => knownRoutes.has(candidate));
  if (homePage) {
    redirects.set('/', homePage);
    redirects.set('/home', homePage);
    redirects.set('/index.html', homePage);
  }

  if (knownRoutes.has('/privacy/privacy.html')) {
    redirects.set('/privavy/privacy.html', '/privacy/privacy.html');
  }

  return redirects;
}

function ensureDirectory(directoryPath: string): void {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return deepClone(fallback);
  }
}

function writeJsonFile(filePath: string, payload: unknown): void {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

function parseIsoTimestamp(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function createLiveFeedbackId(): string {
  return `FBK-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toFeedbackLevelFromCriticalLevel(level: number): FeedbackLevel {
  if (level >= 5) {
    return 'critical';
  }
  if (level >= 4) {
    return 'warning';
  }
  return 'info';
}

function createKnowledgeBaseFallback(): KnowledgeBaseDocument {
  return {
    updatedAt: '',
    summary: 'AI knowledge base has not been generated yet.',
    actions: ['Run AI maintenance to generate operational guidance.'],
    lastRun: null,
    history: []
  };
}

function readKnowledgeBase(): KnowledgeBaseDocument {
  const fallback = createKnowledgeBaseFallback();
  const payload = readJsonFile<KnowledgeBaseDocument>(knowledgeBasePath, fallback);
  return {
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : fallback.updatedAt,
    summary: typeof payload.summary === 'string' && payload.summary.trim() ? payload.summary : fallback.summary,
    actions: Array.isArray(payload.actions)
      ? payload.actions.filter((value): value is string => typeof value === 'string').slice(0, 12)
      : fallback.actions,
    lastRun:
      payload.lastRun && typeof payload.lastRun === 'object'
        ? (payload.lastRun as MaintenanceRunSummary)
        : fallback.lastRun,
    history: Array.isArray(payload.history)
      ? payload.history
          .filter((value): value is KnowledgeBaseEntry => typeof value === 'object' && value !== null)
          .slice(0, 120)
      : fallback.history
  };
}

function writeKnowledgeBase(payload: KnowledgeBaseDocument): void {
  writeJsonFile(knowledgeBasePath, payload);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createLiveMetricsFallback(): LiveMetricsSnapshot {
  return {
    updatedAt: new Date().toISOString(),
    tickCount: 0,
    metrics: buildAdminSnapshot(readCollections()).metrics,
    chart: {
      varianceTrend: [],
      fairnessTrend: [],
      savingsTrend: []
    },
    source: 'simulated'
  };
}

function readLiveMetrics(): LiveMetricsSnapshot {
  const fallback = createLiveMetricsFallback();
  const payload = readJsonFile<LiveMetricsSnapshot>(liveMetricsPath, fallback);

  const normalizeSeries = (value: unknown): LiveTrendPoint[] => {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => {
        if (typeof entry !== 'object' || entry === null) {
          return null;
        }
        const row = entry as Record<string, unknown>;
        const ts = typeof row.ts === 'string' ? row.ts : new Date().toISOString();
        const parsed = Number(row.value);
        if (!Number.isFinite(parsed)) {
          return null;
        }
        return { ts, value: Number(parsed.toFixed(2)) };
      })
      .filter((entry): entry is LiveTrendPoint => entry !== null)
      .slice(-240);
  };

  return {
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : fallback.updatedAt,
    tickCount: Number.isFinite(Number(payload.tickCount)) ? Number(payload.tickCount) : fallback.tickCount,
    metrics:
      payload.metrics && typeof payload.metrics === 'object'
        ? (payload.metrics as SnapshotMetrics)
        : fallback.metrics,
    chart: {
      varianceTrend: normalizeSeries(payload.chart?.varianceTrend),
      fairnessTrend: normalizeSeries(payload.chart?.fairnessTrend),
      savingsTrend: normalizeSeries(payload.chart?.savingsTrend)
    },
    source: payload.source === 'live' || payload.source === 'simulated' ? payload.source : fallback.source
  };
}

function writeLiveMetrics(snapshot: LiveMetricsSnapshot): void {
  writeJsonFile(liveMetricsPath, snapshot);
}

function addPointToSeries(series: LiveTrendPoint[], point: LiveTrendPoint, max = 240): LiveTrendPoint[] {
  return [...series, point].slice(-max);
}

function deriveMetricsFromCollections(collections: AdminCollections): SnapshotMetrics {
  return buildAdminSnapshot(collections).metrics;
}

function readLiveFeedback(limit = 100): LiveFeedbackEvent[] {
  const safeLimit = Math.max(1, Math.min(2000, Math.trunc(limit)));
  if (!fs.existsSync(liveFeedbackPath)) {
    return [];
  }

  try {
    const lines = fs
      .readFileSync(liveFeedbackPath, 'utf-8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const records: LiveFeedbackEvent[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Partial<LiveFeedbackEvent>;
        if (
          typeof parsed.id === 'string' &&
          typeof parsed.ts === 'string' &&
          typeof parsed.scope === 'string' &&
          typeof parsed.message === 'string'
        ) {
          records.push({
            id: parsed.id,
            ts: parsed.ts,
            scope: parsed.scope,
            level:
              parsed.level === 'critical' || parsed.level === 'warning' || parsed.level === 'info'
                ? parsed.level
                : 'info',
            message: parsed.message,
            trigger:
              parsed.trigger === 'startup' ||
              parsed.trigger === 'minute' ||
              parsed.trigger === 'hourly' ||
              parsed.trigger === 'manual'
                ? parsed.trigger
                : undefined,
            data:
              parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)
                ? (parsed.data as Record<string, unknown>)
                : undefined
          });
        }
      } catch {
        // ignore malformed line
      }
    }

    return records.slice(-safeLimit).reverse();
  } catch {
    return [];
  }
}

function broadcastLiveFeedback(event: LiveFeedbackEvent): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of liveFeedbackClients) {
    try {
      client.write(payload);
    } catch {
      liveFeedbackClients.delete(client);
    }
  }
}

function appendLiveFeedback(params: {
  scope: string;
  level: FeedbackLevel;
  message: string;
  trigger?: MaintenanceTrigger;
  data?: Record<string, unknown>;
}): LiveFeedbackEvent {
  const event: LiveFeedbackEvent = {
    id: createLiveFeedbackId(),
    ts: new Date().toISOString(),
    scope: params.scope,
    level: params.level,
    message: params.message,
    trigger: params.trigger,
    data: params.data
  };

  ensureDirectory(path.dirname(liveFeedbackPath));
  fs.appendFileSync(liveFeedbackPath, `${JSON.stringify(event)}\n`, 'utf-8');
  broadcastLiveFeedback(event);
  return event;
}

function buildScannerSourceRecords(): ScannerSourceRecord[] {
  const marketplaceRows = readMarketplaceDescriptors().flatMap((descriptor) =>
    readMarketplaceCatalog(descriptor.id).map<ScannerSourceRecord>((row) => ({
      marketplaceId: row.marketplaceId,
      marketplaceName: row.marketplaceName,
      name: row.name,
      category: row.category,
      supplier: row.supplier,
      basePrice: row.basePrice,
      listedPrice: row.listedPrice,
      location: row.location
    }))
  );

  const catalogRows = readCollection('products').map<ScannerSourceRecord>((row) => ({
    marketplaceId: 'prism-catalog',
    marketplaceName: 'PRISM Catalog',
    name: row.name,
    category: row.category,
    supplier: row.supplier,
    basePrice: row.basePrice,
    listedPrice: row.basePrice,
    location: 'National'
  }));

  return [...marketplaceRows, ...catalogRows];
}

function ensureDataFiles(): void {
  ensureDirectory(dataDir);
  ensureDirectory(marketplaceDir);

  if (!fs.existsSync(baselinePath)) {
    writeBaselineFile(baselinePath, defaultBaseline);
  }

  for (const moduleName of Object.keys(moduleFileMap) as AdminModule[]) {
    const filePath = moduleFileMap[moduleName];
    if (!fs.existsSync(filePath)) {
      writeJsonFile(filePath, defaultCollections[moduleName]);
    }
  }

  const existingDescriptors = readJsonFile<MarketplaceDescriptor[]>(marketplaceIndexPath, defaultMarketplaceDescriptors);
  const descriptorMap = new Map<MarketplaceId, MarketplaceDescriptor>();
  for (const descriptor of defaultMarketplaceDescriptors) {
    descriptorMap.set(descriptor.id, descriptor);
  }
  for (const descriptor of existingDescriptors) {
    if (normalizeMarketplaceId(descriptor.id)) {
      descriptorMap.set(descriptor.id, {
        ...descriptorMap.get(descriptor.id as MarketplaceId),
        ...descriptor
      } as MarketplaceDescriptor);
    }
  }
  const marketplaceDescriptors = [...descriptorMap.values()];
  writeJsonFile(marketplaceIndexPath, marketplaceDescriptors);

  for (const descriptor of marketplaceDescriptors) {
    const targetFile = marketplaceFilePath(descriptor.id);
    const existingRows = readJsonFile<MarketplaceCatalogRecord[]>(targetFile, []);
    if (!fs.existsSync(targetFile) || !Array.isArray(existingRows) || existingRows.length < marketplaceCatalogTemplates.length) {
      writeJsonFile(targetFile, createMarketplaceSeed(descriptor));
    }
  }

  const users = readCollection('users');
  const expandedUsers = users.length < 150 ? createExtendedUsers(users, 180) : users;
  if (expandedUsers.length !== users.length) {
    writeCollection('users', expandedUsers);
  }

  const monitoringRows = readJsonFile<UserMonitoringRecord[]>(userMonitoringPath, []);
  if (!fs.existsSync(userMonitoringPath) || !Array.isArray(monitoringRows) || monitoringRows.length < 500) {
    const monitoring = createUserMonitoringSeed(expandedUsers, 600);
    writeJsonFile(userMonitoringPath, monitoring);
  }

  const specialUsers = readJsonFile<MarketplaceSpecialUser[]>(marketplaceSpecialUsersPath, []);
  const minimumSpecialUsers = marketplaceDescriptors.length * 5;
  if (!fs.existsSync(marketplaceSpecialUsersPath) || !Array.isArray(specialUsers) || specialUsers.length < minimumSpecialUsers) {
    writeJsonFile(marketplaceSpecialUsersPath, createMarketplaceSpecialUsersSeed(expandedUsers, marketplaceDescriptors));
  }

  if (!fs.existsSync(ingestionAuditPath)) {
    fs.writeFileSync(ingestionAuditPath, '', 'utf-8');
  }

  if (!fs.existsSync(liveFeedbackPath)) {
    fs.writeFileSync(liveFeedbackPath, '', 'utf-8');
  }

  if (!fs.existsSync(knowledgeBasePath)) {
    writeKnowledgeBase(createKnowledgeBaseFallback());
  }

  if (!fs.existsSync(liveMetricsPath)) {
    writeLiveMetrics(createLiveMetricsFallback());
  }
}

function readBaseline(): BaselineMap {
  const baseline = readBaselineFile(baselinePath);
  if (Object.keys(baseline).length > 0) {
    return baseline;
  }

  return deepClone(defaultBaseline);
}

function readCollection<M extends AdminModule>(moduleName: M): AdminCollections[M] {
  const fallback = defaultCollections[moduleName];
  const data = readJsonFile<AdminCollections[M]>(moduleFileMap[moduleName], fallback);
  return Array.isArray(data) ? data : deepClone(fallback);
}

function writeCollection<M extends AdminModule>(moduleName: M, rows: AdminCollections[M]): void {
  writeJsonFile(moduleFileMap[moduleName], rows);
}

function readCollections(): AdminCollections {
  return {
    users: readCollection('users'),
    products: readCollection('products'),
    priceMonitoring: readCollection('priceMonitoring'),
    alerts: readCollection('alerts'),
    reports: readCollection('reports')
  };
}

function persistChangedCollections(changedModules: AdminModule[], collections: AdminCollections): void {
  for (const moduleName of changedModules) {
    writeCollection(moduleName, collections[moduleName]);
  }
}

function readMarketplaceDescriptors(): MarketplaceDescriptor[] {
  const data = readJsonFile<MarketplaceDescriptor[]>(marketplaceIndexPath, defaultMarketplaceDescriptors);
  return Array.isArray(data) ? data : defaultMarketplaceDescriptors;
}

function readMarketplaceCatalog(marketplaceId: MarketplaceId): MarketplaceCatalogRecord[] {
  const descriptor = readMarketplaceDescriptors().find((entry) => entry.id === marketplaceId);
  const fallback = descriptor ? createMarketplaceSeed(descriptor) : [];
  const data = readJsonFile<MarketplaceCatalogRecord[]>(marketplaceFilePath(marketplaceId), fallback);
  return Array.isArray(data) ? data : fallback;
}

function writeMarketplaceCatalog(marketplaceId: MarketplaceId, rows: MarketplaceCatalogRecord[]): void {
  writeJsonFile(marketplaceFilePath(marketplaceId), rows);
}

function readUserMonitoringRecords(): UserMonitoringRecord[] {
  return readJsonFile<UserMonitoringRecord[]>(userMonitoringPath, []);
}

function writeUserMonitoringRecords(rows: UserMonitoringRecord[]): void {
  writeJsonFile(userMonitoringPath, rows);
}

function readMarketplaceSpecialUsers(): MarketplaceSpecialUser[] {
  return readJsonFile<MarketplaceSpecialUser[]>(marketplaceSpecialUsersPath, []);
}

function writeMarketplaceSpecialUsers(rows: MarketplaceSpecialUser[]): void {
  writeJsonFile(marketplaceSpecialUsersPath, rows);
}

function createMarketplaceRecordId(marketplaceId: MarketplaceId, rows: MarketplaceCatalogRecord[]): string {
  let candidate = '';
  do {
    candidate = `MKT-${marketplaceId.toUpperCase()}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  } while (rows.some((row) => row.id === candidate));

  return candidate;
}

function createMonitoringRecordId(rows: UserMonitoringRecord[]): string {
  let candidate = '';
  do {
    candidate = `UM-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  } while (rows.some((row) => row.id === candidate));

  return candidate;
}

function createSpecialUserId(rows: MarketplaceSpecialUser[]): string {
  let candidate = '';
  do {
    candidate = `MSU-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  } while (rows.some((row) => row.id === candidate));

  return candidate;
}

function parseItem(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = normalizeItemName(value);
  return normalized.length > 0 ? normalized : null;
}

function parsePositivePrice(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Number(parsed.toFixed(2));
}

function parseCatalogStatus(
  value: unknown,
  fallback: MarketplaceCatalogRecord['status']
): MarketplaceCatalogRecord['status'] {
  if (value === 'active' || value === 'low-stock' || value === 'hidden') {
    return value;
  }

  return fallback;
}

function resolveModuleFromRoute(value: string): AdminModule | null {
  const normalized = value.trim().toLowerCase();
  const mapping: Record<string, AdminModule> = {
    users: 'users',
    products: 'products',
    'price-monitoring': 'priceMonitoring',
    pricemonitoring: 'priceMonitoring',
    monitoring: 'priceMonitoring',
    alerts: 'alerts',
    reports: 'reports',
    analytics: 'reports'
  };

  return mapping[normalized] ?? null;
}

function normalizeUploadIntent(value: unknown): AiDataCommand['intent'] | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'create' || normalized === 'update' || normalized === 'delete' || normalized === 'generate') {
    return normalized;
  }

  return null;
}

function sanitizeUploadPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...payload };
  delete copy.module;
  delete copy.entity;
  delete copy.collection;
  delete copy.target;
  delete copy.intent;
  delete copy.action;
  delete copy.operation;
  delete copy.id;
  delete copy.recordId;
  delete copy.mode;
  return copy;
}

function executeAndPersistAiCommand(command: AiDataCommand): {
  ok: boolean;
  message: string;
  result?: unknown;
  metrics: ReturnType<typeof buildAdminSnapshot>['metrics'];
  recentActivity: ReturnType<typeof buildAdminSnapshot>['recentActivity'];
  changedModules: AdminModule[];
  baselineChanged: boolean;
} {
  const collections = readCollections();
  const baseline = readBaseline();
  const execution = executeAiDataCommand(command, { collections, baseline });

  if (execution.ok && execution.changedModules.length > 0) {
    persistChangedCollections(execution.changedModules, execution.collections);
  }

  if (execution.ok && execution.baselineChanged) {
    writeBaselineFile(baselinePath, execution.baseline);
  }

  const snapshot = buildAdminSnapshot(execution.collections);
  return {
    ok: execution.ok,
    message: execution.message,
    result: execution.result,
    metrics: snapshot.metrics,
    recentActivity: snapshot.recentActivity,
    changedModules: execution.changedModules,
    baselineChanged: execution.baselineChanged
  };
}

async function runAiMaintenance(trigger: MaintenanceTrigger): Promise<MaintenanceRunSummary> {
  if (maintenanceInFlight) {
    return (
      lastMaintenanceRun ?? {
        ok: false,
        trigger,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        createdMonitoring: 0,
        resolvedAlerts: 0,
        deletedMonitoring: 0,
        deletedAlerts: 0,
        openAlerts: 0,
        highRiskCount: 0,
        summary: 'AI maintenance already in progress.',
        actions: ['Wait for active maintenance cycle to finish.'],
        metrics: buildAdminSnapshot(readCollections()).metrics,
        message: 'AI maintenance already in progress.'
      }
    );
  }

  maintenanceInFlight = true;
  const startedAt = new Date().toISOString();

  try {
    let workingCollections = readCollections();
    let workingBaseline = readBaseline();
    const seedRows = workingCollections.products.map((row) => ({
      name: row.name,
      basePrice: row.basePrice,
      location: 'PRISM Catalog'
    }));
    const scannerRows = buildScannerSourceRecords().map((row) => ({
      name: row.name,
      basePrice: row.basePrice,
      location: row.location
    }));
    const candidates = [...seedRows, ...scannerRows].slice(0, 40);
    const ratios = [0.88, 0.95, 1.02, 1.08, 1.15, 1.28, 1.36];

    let createdMonitoring = 0;
    for (const [index, product] of candidates.entries()) {
      const multiplier = ratios[index % ratios.length];
      const observedPrice = Number((product.basePrice * multiplier).toFixed(2));
      const execution = executeAiDataCommand(
        {
          intent: 'create',
          module: 'priceMonitoring',
          payload: {
            item: product.name,
            price: observedPrice,
            location: product.location || 'Automated Scan',
            source: 'ai-hourly-maintenance'
          }
        },
        { collections: workingCollections, baseline: workingBaseline }
      );

      if (!execution.ok) {
        continue;
      }

      workingCollections = execution.collections;
      workingBaseline = execution.baseline;
      createdMonitoring += 1;
    }

    const completedAt = new Date().toISOString();
    const nowMs = Date.parse(completedAt);

    let resolvedAlerts = 0;
    for (const alert of workingCollections.alerts) {
      if (alert.status === 'resolved') {
        continue;
      }

      const linkedMonitoring = alert.relatedEntityId
        ? workingCollections.priceMonitoring.find((row) => row.id === alert.relatedEntityId)
        : undefined;
      const isStableLinkedRow =
        linkedMonitoring?.flag === 'fair' || linkedMonitoring?.flag === 'cheap' || linkedMonitoring?.flag === 'steal';
      const ageMs = nowMs - parseIsoTimestamp(alert.updatedAt || alert.createdAt);
      const isOldAlert = ageMs > 72 * 60 * 60 * 1000;

      if (isStableLinkedRow || isOldAlert) {
        alert.status = 'resolved';
        alert.updatedAt = completedAt;
        resolvedAlerts += 1;
      }
    }

    const sortedMonitoring = workingCollections.priceMonitoring
      .slice()
      .sort((a, b) => parseIsoTimestamp(b.recordedAt) - parseIsoTimestamp(a.recordedAt));
    const sortedAlerts = workingCollections.alerts
      .slice()
      .sort((a, b) => parseIsoTimestamp(b.updatedAt || b.createdAt) - parseIsoTimestamp(a.updatedAt || a.createdAt));

    const deletedMonitoring = Math.max(0, sortedMonitoring.length - maxMonitoringRows);
    const deletedAlerts = Math.max(0, sortedAlerts.length - maxAlertRows);
    workingCollections.priceMonitoring = sortedMonitoring.slice(0, maxMonitoringRows);
    workingCollections.alerts = sortedAlerts.slice(0, maxAlertRows);

    const reportExecution = executeAiDataCommand(
      {
        intent: 'generate',
        module: 'reports',
        payload: {
          period: 'weekly',
          title: `AI Maintenance Report - ${completedAt.slice(0, 16).replace('T', ' ')}`,
          summary: `Created ${createdMonitoring} monitoring rows, resolved ${resolvedAlerts} alerts.`
        }
      },
      { collections: workingCollections, baseline: workingBaseline, nowIso: completedAt }
    );

    if (reportExecution.ok) {
      workingCollections = reportExecution.collections;
      workingBaseline = reportExecution.baseline;
    }

    if (workingCollections.reports.length > 500) {
      workingCollections.reports = workingCollections.reports
        .slice()
        .sort((a, b) => parseIsoTimestamp(b.generatedAt) - parseIsoTimestamp(a.generatedAt))
        .slice(0, 500);
    }

    writeCollection('priceMonitoring', workingCollections.priceMonitoring);
    writeCollection('alerts', workingCollections.alerts);
    writeCollection('reports', workingCollections.reports);
    writeBaselineFile(baselinePath, workingBaseline);

    const snapshot = buildAdminSnapshot(workingCollections);
    const highRiskCount = workingCollections.priceMonitoring.filter((row) => row.flag === 'high-risk').length;
    const openAlerts = workingCollections.alerts.filter((row) => row.status !== 'resolved').length;

    const existingLiveMetrics = readLiveMetrics();
    const variancePct =
      snapshot.metrics.productsTracked > 0
        ? Number(((snapshot.metrics.flaggedListings / snapshot.metrics.productsTracked) * 100).toFixed(2))
        : 0;
    const liveMetricsPayload: LiveMetricsSnapshot = {
      updatedAt: completedAt,
      tickCount: existingLiveMetrics.tickCount + 1,
      metrics: snapshot.metrics,
      chart: {
        varianceTrend: addPointToSeries(existingLiveMetrics.chart.varianceTrend, {
          ts: completedAt,
          value: clampNumber(variancePct, 0, 100)
        }),
        fairnessTrend: addPointToSeries(existingLiveMetrics.chart.fairnessTrend, {
          ts: completedAt,
          value: clampNumber(snapshot.metrics.averageFairness, 0, 100)
        }),
        savingsTrend: addPointToSeries(existingLiveMetrics.chart.savingsTrend, {
          ts: completedAt,
          value: Math.max(0, Number(snapshot.metrics.estimatedSavings.toFixed(2)))
        })
      },
      source: 'live'
    };
    writeLiveMetrics(liveMetricsPayload);

    const narrative = await buildKnowledgeNarrative({
      trigger,
      startedAt,
      completedAt,
      createdMonitoring,
      resolvedAlerts,
      deletedMonitoring,
      deletedAlerts,
      highRiskCount,
      openAlerts,
      metrics: snapshot.metrics,
      collectionSizes: {
        users: workingCollections.users.length,
        products: workingCollections.products.length,
        priceMonitoring: workingCollections.priceMonitoring.length,
        alerts: workingCollections.alerts.length,
        reports: workingCollections.reports.length
      }
    });

    const summaryText =
      narrative.summary ||
      `AI maintenance finished: +${createdMonitoring} monitoring rows, ${resolvedAlerts} alerts resolved.`;

    const result: MaintenanceRunSummary = {
      ok: true,
      trigger,
      startedAt,
      completedAt,
      createdMonitoring,
      resolvedAlerts,
      deletedMonitoring,
      deletedAlerts,
      openAlerts,
      highRiskCount,
      summary: summaryText,
      actions: narrative.actions,
      metrics: snapshot.metrics,
      message: `AI maintenance completed (${trigger}).`
    };

    const knowledgeBase = readKnowledgeBase();
    const entry: KnowledgeBaseEntry = {
      id: `KB-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      trigger,
      generatedAt: completedAt,
      summary: summaryText,
      actions: narrative.actions,
      maintenance: {
        ok: result.ok,
        trigger: result.trigger,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        createdMonitoring: result.createdMonitoring,
        resolvedAlerts: result.resolvedAlerts,
        deletedMonitoring: result.deletedMonitoring,
        deletedAlerts: result.deletedAlerts,
        openAlerts: result.openAlerts,
        highRiskCount: result.highRiskCount,
        metrics: result.metrics,
        message: result.message
      },
      metrics: snapshot.metrics
    };

    writeKnowledgeBase({
      updatedAt: completedAt,
      summary: summaryText,
      actions: narrative.actions,
      lastRun: result,
      history: [entry, ...knowledgeBase.history].slice(0, 120)
    });

    appendLiveFeedback({
      scope: 'ai-maintenance',
      trigger,
      level: highRiskCount >= 30 ? 'critical' : openAlerts > 0 ? 'warning' : 'info',
      message: `AI maintenance (${trigger}) added ${createdMonitoring} monitoring rows and resolved ${resolvedAlerts} alerts.`,
      data: {
        deletedMonitoring,
        deletedAlerts,
        openAlerts,
        highRiskCount,
        totalPriceMonitoring: workingCollections.priceMonitoring.length
      }
    });

    lastMaintenanceRun = result;
    return result;
  } catch (error) {
    const completedAt = new Date().toISOString();
    const snapshot = buildAdminSnapshot(readCollections());
    const message = error instanceof Error ? error.message : 'Unknown AI maintenance error.';
    const failure: MaintenanceRunSummary = {
      ok: false,
      trigger,
      startedAt,
      completedAt,
      createdMonitoring: 0,
      resolvedAlerts: 0,
      deletedMonitoring: 0,
      deletedAlerts: 0,
      openAlerts: snapshot.metrics.openAlerts,
      highRiskCount: snapshot.metrics.highRiskCount,
      summary: `AI maintenance failed: ${message}`,
      actions: ['Inspect server logs and DeepSeek configuration, then retry maintenance.'],
      metrics: snapshot.metrics,
      message: 'AI maintenance failed.'
    };

    appendLiveFeedback({
      scope: 'ai-maintenance',
      trigger,
      level: 'critical',
      message: `AI maintenance failed: ${message}`
    });
    lastMaintenanceRun = failure;
    return failure;
  } finally {
    maintenanceInFlight = false;
  }
}

function startAiMaintenanceScheduler(): void {
  void runAiMaintenance('startup');
  if (!aiHourlyEnabled) {
    return;
  }

  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
  }

  maintenanceTimer = setInterval(() => {
    void runAiMaintenance('hourly');
  }, aiHourlyIntervalMs);
}

function simulateMetricsDrift(base: SnapshotMetrics): SnapshotMetrics {
  const flagged = Math.max(0, Math.round(base.flaggedListings + (Math.random() - 0.5) * 2));
  const highRisk = Math.max(0, Math.round(base.highRiskCount + (Math.random() - 0.5) * 1));
  const openAlerts = Math.max(0, Math.round(base.openAlerts + (Math.random() - 0.5) * 1));
  const fairness = clampNumber(Number((base.averageFairness + (Math.random() - 0.5) * 0.4).toFixed(2)), 0, 100);
  const savings = Math.max(0, Number((base.estimatedSavings + (Math.random() - 0.5) * 8).toFixed(2)));

  return {
    ...base,
    flaggedListings: flagged,
    highRiskCount: highRisk,
    openAlerts,
    averageFairness: fairness,
    estimatedSavings: savings
  };
}

async function runAiMinuteTick(trigger: MaintenanceTrigger = 'minute'): Promise<MinuteTickSummary> {
  if (minuteTickInFlight) {
    const fallbackMetrics = readLiveMetrics().metrics;
    return {
      ok: false,
      trigger,
      updatedAt: new Date().toISOString(),
      updatedRows: 0,
      metrics: fallbackMetrics,
      source: 'simulated',
      message: 'Minute tick already running.'
    };
  }

  minuteTickInFlight = true;
  const nowIso = new Date().toISOString();
  let updatedRows = 0;
  let metrics: SnapshotMetrics = createLiveMetricsFallback().metrics;
  let source: 'live' | 'simulated' = 'simulated';

  try {
    let workingCollections = readCollections();
    let workingBaseline = readBaseline();
    const recentRows = workingCollections.priceMonitoring
      .slice()
      .sort((a, b) => parseIsoTimestamp(b.recordedAt) - parseIsoTimestamp(a.recordedAt))
      .slice(0, 16);

    for (const row of recentRows) {
      const jitter = (Math.random() - 0.5) * 0.018;
      const nextObserved = Number((row.observedPrice * (1 + jitter)).toFixed(2));
      const boundedObserved = nextObserved > 0 ? nextObserved : row.observedPrice;
      const execution = executeAiDataCommand(
        {
          intent: 'update',
          module: 'priceMonitoring',
          id: row.id,
          payload: {
            observedPrice: boundedObserved,
            source: 'ai-minute-tick',
            location: row.location || 'Live Feed'
          }
        },
        { collections: workingCollections, baseline: workingBaseline, nowIso }
      );

      if (!execution.ok) {
        continue;
      }

      workingCollections = execution.collections;
      workingBaseline = execution.baseline;
      updatedRows += 1;
    }

    if (updatedRows > 0) {
      writeCollection('priceMonitoring', workingCollections.priceMonitoring);
      writeCollection('alerts', workingCollections.alerts);
      writeBaselineFile(baselinePath, workingBaseline);
      metrics = deriveMetricsFromCollections(workingCollections);
      source = 'live';
    } else {
      const liveBase = readLiveMetrics().metrics;
      metrics = simulateMetricsDrift(liveBase);
      source = 'simulated';
    }

    const existingSnapshot = readLiveMetrics();
    const variancePct =
      metrics.productsTracked > 0 ? Number(((metrics.flaggedListings / metrics.productsTracked) * 100).toFixed(2)) : 0;
    const varianceValue = clampNumber(
      Number((variancePct + (source === 'simulated' ? (Math.random() - 0.5) * 0.2 : 0)).toFixed(2)),
      0,
      100
    );
    const fairnessValue = clampNumber(
      Number((metrics.averageFairness + (source === 'simulated' ? (Math.random() - 0.5) * 0.3 : 0)).toFixed(2)),
      0,
      100
    );
    const savingsValue = Math.max(
      0,
      Number((metrics.estimatedSavings + (source === 'simulated' ? (Math.random() - 0.5) * 5 : 0)).toFixed(2))
    );

    const nextSnapshot: LiveMetricsSnapshot = {
      updatedAt: nowIso,
      tickCount: existingSnapshot.tickCount + 1,
      metrics,
      chart: {
        varianceTrend: addPointToSeries(existingSnapshot.chart.varianceTrend, { ts: nowIso, value: varianceValue }),
        fairnessTrend: addPointToSeries(existingSnapshot.chart.fairnessTrend, { ts: nowIso, value: fairnessValue }),
        savingsTrend: addPointToSeries(existingSnapshot.chart.savingsTrend, { ts: nowIso, value: savingsValue })
      },
      source
    };
    writeLiveMetrics(nextSnapshot);

    appendLiveFeedback({
      scope: 'minute-tick',
      trigger,
      level: source === 'live' ? 'info' : 'warning',
      message:
        source === 'live'
          ? `Minute tick updated ${updatedRows} price rows.`
          : 'Minute tick used subtle simulation (no fresh rows available).',
      data: {
        updatedRows,
        source,
        averageFairness: metrics.averageFairness,
        flaggedListings: metrics.flaggedListings
      }
    });

    return {
      ok: true,
      trigger,
      updatedAt: nowIso,
      updatedRows,
      metrics,
      source,
      message: `Minute tick completed (${source}).`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown minute tick error.';
    appendLiveFeedback({
      scope: 'minute-tick',
      trigger,
      level: 'critical',
      message: `Minute tick failed: ${message}`
    });
    return {
      ok: false,
      trigger,
      updatedAt: nowIso,
      updatedRows: 0,
      metrics,
      source: 'simulated',
      message: `Minute tick failed: ${message}`
    };
  } finally {
    minuteTickInFlight = false;
  }
}

function startAiMinuteScheduler(): void {
  if (!aiMinuteEnabled) {
    return;
  }

  void runAiMinuteTick('startup');

  if (minuteTimer) {
    clearInterval(minuteTimer);
  }

  minuteTimer = setInterval(() => {
    void runAiMinuteTick('minute');
  }, aiMinuteIntervalMs);
}

ensureDataFiles();
startAiMinuteScheduler();
startAiMaintenanceScheduler();

const pageRoutes = collectHtmlPages(publicDir).map(toRoutePath);
const pageRedirects = buildPageRedirects(pageRoutes);

app.disable('x-powered-by');
app.use(express.json({ limit: maxBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: maxBodyLimit }));
app.use(express.text({ type: ['text/plain', 'application/x-ndjson'], limit: maxBodyLimit }));

for (const [route, destination] of pageRedirects.entries()) {
  app.get(route, (_req, res) => {
    return res.redirect(302, destination);
  });
}

app.use(express.static(publicDir, { redirect: false }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/admin/snapshot', (_req, res) => {
  const collections = readCollections();
  const baseline = readBaseline();
  const snapshot = buildAdminSnapshot(collections);

  res.json({
    users: collections.users,
    products: collections.products,
    priceMonitoring: collections.priceMonitoring,
    alerts: collections.alerts,
    reports: collections.reports,
    baseline,
    metrics: snapshot.metrics,
    recentActivity: snapshot.recentActivity
  });
});

app.post('/api/admin/run-price-monitoring', (_req, res) => {
  const baseCollections = readCollections();
  let workingCollections = baseCollections;
  let workingBaseline = readBaseline();
  const multipliers = [1.35, 1.2, 1.05, 0.95, 0.85];
  const createdRows: unknown[] = [];

  for (const [index, product] of workingCollections.products.entries()) {
    const observedPrice = Number((product.basePrice * multipliers[index % multipliers.length]).toFixed(2));
    const execution = executeAiDataCommand(
      {
        intent: 'create',
        module: 'priceMonitoring',
        payload: {
          item: product.name,
          price: observedPrice,
          location: 'Automated Scan',
          source: 'system-analysis'
        }
      },
      { collections: workingCollections, baseline: workingBaseline }
    );

    if (!execution.ok) {
      continue;
    }

    workingCollections = execution.collections;
    workingBaseline = execution.baseline;
    createdRows.unshift(execution.result);
  }

  writeCollection('priceMonitoring', workingCollections.priceMonitoring);
  writeCollection('alerts', workingCollections.alerts);
  writeBaselineFile(baselinePath, workingBaseline);

  const snapshot = buildAdminSnapshot(workingCollections);
  return res.json({
    message: `AI analyzed ${createdRows.length} products.`,
    created: createdRows,
    metrics: snapshot.metrics
  });
});

app.get('/api/storage/status', (_req, res) => {
  const allDataFiles = fs.readdirSync(dataDir, { withFileTypes: true });
  const topLevelFiles = allDataFiles.filter((entry) => entry.isFile()).map((entry) => path.join(dataDir, entry.name));
  const marketplaceFiles = fs.existsSync(marketplaceDir)
    ? fs
        .readdirSync(marketplaceDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => path.join(marketplaceDir, entry.name))
    : [];

  const files = [...topLevelFiles, ...marketplaceFiles];
  const metrics = files.map((filePath) => {
    const stats = fs.statSync(filePath);
    return {
      file: path.relative(rootDir, filePath).split(path.sep).join('/'),
      bytes: stats.size
    };
  });

  const totalBytes = metrics.reduce((sum, row) => sum + row.bytes, 0);
  return res.json({
    maxRequestBody: maxBodyLimit,
    aiMinuteTick: {
      enabled: aiMinuteEnabled,
      intervalMs: aiMinuteIntervalMs,
      inFlight: minuteTickInFlight,
      liveMetricsFile: path.relative(rootDir, liveMetricsPath).split(path.sep).join('/')
    },
    aiMaintenance: {
      enabled: aiHourlyEnabled,
      intervalMs: aiHourlyIntervalMs,
      inFlight: maintenanceInFlight,
      lastRunAt: lastMaintenanceRun?.completedAt ?? null
    },
    totalStoredBytes: totalBytes,
    files: metrics
  });
});

app.get('/api/marketplaces', (_req, res) => {
  const descriptors = readMarketplaceDescriptors();
  const payload = descriptors.map((descriptor) => {
    const records = readMarketplaceCatalog(descriptor.id);
    return {
      ...descriptor,
      totalItems: records.length,
      file: path.relative(rootDir, marketplaceFilePath(descriptor.id)).split(path.sep).join('/')
    };
  });
  return res.json({ marketplaces: payload, totalItems: payload.reduce((sum, row) => sum + row.totalItems, 0) });
});

app.get('/api/marketplaces/catalog', (req, res) => {
  const descriptors = readMarketplaceDescriptors();
  const marketplaceFilter = typeof req.query.marketplace === 'string' ? normalizeMarketplaceId(req.query.marketplace) : null;
  const categoryFilter = typeof req.query.category === 'string' ? req.query.category.toLowerCase() : '';
  const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : '';
  const pagesize = Number.isFinite(Number(req.query.limit)) ? Math.max(1, Math.min(2000, Number(req.query.limit))) : 500;

  const selected = marketplaceFilter ? descriptors.filter((row) => row.id === marketplaceFilter) : descriptors;
  const merged = selected.flatMap((descriptor) => readMarketplaceCatalog(descriptor.id));
  const filtered = merged.filter((row) => {
    if (categoryFilter && row.category.toLowerCase() !== categoryFilter) {
      return false;
    }
    if (search && !`${row.name} ${row.supplier}`.toLowerCase().includes(search)) {
      return false;
    }
    return true;
  });

  return res.json({
    total: filtered.length,
    records: filtered.slice(0, pagesize)
  });
});

app.get('/api/marketplaces/:marketplace/products', (req, res) => {
  const marketplaceId = normalizeMarketplaceId(req.params.marketplace);
  if (!marketplaceId) {
    return res.status(404).json({ message: 'Marketplace not found.' });
  }

  const rows = readMarketplaceCatalog(marketplaceId);
  return res.json({ marketplace: marketplaceId, records: rows, total: rows.length });
});

app.post('/api/marketplaces/:marketplace/products', (req, res) => {
  const marketplaceId = normalizeMarketplaceId(req.params.marketplace);
  if (!marketplaceId) {
    return res.status(404).json({ message: 'Marketplace not found.' });
  }

  const descriptor = readMarketplaceDescriptors().find((row) => row.id === marketplaceId);
  if (!descriptor) {
    return res.status(404).json({ message: 'Marketplace descriptor missing.' });
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
  const supplier = typeof req.body?.supplier === 'string' ? req.body.supplier.trim() : '';
  const basePrice = parsePositivePrice(req.body?.basePrice);
  if (!name || !category || !supplier || basePrice === null) {
    return res.status(400).json({ message: 'Provide name, category, supplier, and positive basePrice.' });
  }

  const rows = readMarketplaceCatalog(marketplaceId);
  const listedPrice = parsePositivePrice(req.body?.listedPrice) ?? Number((basePrice * descriptor.priceFactor).toFixed(2));
  const stock = Number.isFinite(Number(req.body?.stock)) ? Number(req.body.stock) : 60;
  const rating = Number.isFinite(Number(req.body?.rating)) ? Number(Number(req.body.rating).toFixed(1)) : 4.5;
  const nowIso = new Date().toISOString();
  const record: MarketplaceCatalogRecord = {
    id: createMarketplaceRecordId(marketplaceId, rows),
    marketplaceId,
    marketplaceName: descriptor.name,
    name,
    category,
    supplier,
    basePrice,
    listedPrice,
    location: typeof req.body?.location === 'string' ? req.body.location.trim() : descriptor.region,
    rating,
    stock,
    status: parseCatalogStatus(req.body?.status, stock <= 20 ? 'low-stock' : 'active'),
    createdAt: nowIso,
    updatedAt: nowIso
  };

  rows.unshift(record);
  writeMarketplaceCatalog(marketplaceId, rows);
  appendIngestionAudit({ scope: 'marketplace', action: 'create', marketplaceId, recordId: record.id });
  return res.json({ ok: true, message: 'Marketplace product created.', record });
});

app.put('/api/marketplaces/:marketplace/products/:id', (req, res) => {
  const marketplaceId = normalizeMarketplaceId(req.params.marketplace);
  if (!marketplaceId) {
    return res.status(404).json({ message: 'Marketplace not found.' });
  }

  const rows = readMarketplaceCatalog(marketplaceId);
  const index = rows.findIndex((row) => row.id === req.params.id);
  if (index < 0) {
    return res.status(404).json({ message: 'Marketplace product not found.' });
  }

  const next = { ...rows[index] };
  if (typeof req.body?.name === 'string' && req.body.name.trim()) next.name = req.body.name.trim();
  if (typeof req.body?.category === 'string' && req.body.category.trim()) next.category = req.body.category.trim();
  if (typeof req.body?.supplier === 'string' && req.body.supplier.trim()) next.supplier = req.body.supplier.trim();
  const basePrice = parsePositivePrice(req.body?.basePrice);
  if (basePrice !== null) next.basePrice = basePrice;
  const listedPrice = parsePositivePrice(req.body?.listedPrice);
  if (listedPrice !== null) next.listedPrice = listedPrice;
  if (Number.isFinite(Number(req.body?.stock))) next.stock = Number(req.body.stock);
  if (Number.isFinite(Number(req.body?.rating))) next.rating = Number(Number(req.body.rating).toFixed(1));
  if (typeof req.body?.location === 'string' && req.body.location.trim()) next.location = req.body.location.trim();
  next.status = parseCatalogStatus(req.body?.status, next.status);
  next.updatedAt = new Date().toISOString();

  rows[index] = next;
  writeMarketplaceCatalog(marketplaceId, rows);
  appendIngestionAudit({ scope: 'marketplace', action: 'update', marketplaceId, recordId: next.id });
  return res.json({ ok: true, message: 'Marketplace product updated.', record: next });
});

app.delete('/api/marketplaces/:marketplace/products/:id', (req, res) => {
  const marketplaceId = normalizeMarketplaceId(req.params.marketplace);
  if (!marketplaceId) {
    return res.status(404).json({ message: 'Marketplace not found.' });
  }

  const rows = readMarketplaceCatalog(marketplaceId);
  const index = rows.findIndex((row) => row.id === req.params.id);
  if (index < 0) {
    return res.status(404).json({ message: 'Marketplace product not found.' });
  }

  const [deleted] = rows.splice(index, 1);
  writeMarketplaceCatalog(marketplaceId, rows);
  appendIngestionAudit({ scope: 'marketplace', action: 'delete', marketplaceId, recordId: deleted.id });
  return res.json({ ok: true, message: 'Marketplace product deleted.', record: deleted });
});

app.post('/api/marketplaces/:marketplace/products/bulk', (req, res) => {
  const marketplaceId = normalizeMarketplaceId(req.params.marketplace);
  if (!marketplaceId) {
    return res.status(404).json({ message: 'Marketplace not found.' });
  }

  const incoming = Array.isArray(req.body?.records) ? req.body.records : [];
  if (incoming.length === 0) {
    return res.status(400).json({ message: 'Provide records array for bulk insert.' });
  }

  const descriptor = readMarketplaceDescriptors().find((row) => row.id === marketplaceId);
  if (!descriptor) {
    return res.status(404).json({ message: 'Marketplace descriptor missing.' });
  }

  const rows = readMarketplaceCatalog(marketplaceId);
  const nowIso = new Date().toISOString();
  let created = 0;
  for (const row of incoming) {
    if (typeof row !== 'object' || row === null) {
      continue;
    }

    const payload = row as Record<string, unknown>;
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    const category = typeof payload.category === 'string' ? payload.category.trim() : '';
    const supplier = typeof payload.supplier === 'string' ? payload.supplier.trim() : '';
    const basePrice = parsePositivePrice(payload.basePrice);
    if (!name || !category || !supplier || basePrice === null) {
      continue;
    }

    const listedPrice = parsePositivePrice(payload.listedPrice) ?? Number((basePrice * descriptor.priceFactor).toFixed(2));
    const stock = Number.isFinite(Number(payload.stock)) ? Number(payload.stock) : 50;
    const record: MarketplaceCatalogRecord = {
      id: createMarketplaceRecordId(marketplaceId, rows),
      marketplaceId,
      marketplaceName: descriptor.name,
      name,
      category,
      supplier,
      basePrice,
      listedPrice,
      location: typeof payload.location === 'string' ? payload.location : descriptor.region,
      rating: Number.isFinite(Number(payload.rating)) ? Number(Number(payload.rating).toFixed(1)) : 4.5,
      stock,
      status: parseCatalogStatus(payload.status, stock <= 20 ? 'low-stock' : 'active'),
      createdAt: nowIso,
      updatedAt: nowIso
    };

    rows.unshift(record);
    created += 1;
  }

  writeMarketplaceCatalog(marketplaceId, rows);
  appendIngestionAudit({ scope: 'marketplace', action: 'bulk-create', marketplaceId, created });
  return res.json({ ok: true, message: `Bulk insert completed: ${created} records created.`, created, total: rows.length });
});

app.get('/api/marketplace-special-users', (req, res) => {
  const marketplace = typeof req.query.marketplace === 'string' ? normalizeMarketplaceId(req.query.marketplace) : null;
  const status = typeof req.query.status === 'string' ? req.query.status.toLowerCase() : '';
  const title = typeof req.query.title === 'string' ? req.query.title.toLowerCase() : '';
  const rows = readMarketplaceSpecialUsers().filter((row) => {
    if (marketplace && row.marketplaceId !== marketplace) {
      return false;
    }
    if (status && row.status.toLowerCase() !== status) {
      return false;
    }
    if (title && !row.title.toLowerCase().includes(title)) {
      return false;
    }
    return true;
  });

  return res.json({ total: rows.length, records: rows });
});

app.get('/api/marketplaces/:marketplace/special-users', (req, res) => {
  const marketplaceId = normalizeMarketplaceId(req.params.marketplace);
  if (!marketplaceId) {
    return res.status(404).json({ message: 'Marketplace not found.' });
  }

  const rows = readMarketplaceSpecialUsers().filter((row) => row.marketplaceId === marketplaceId);
  return res.json({ marketplace: marketplaceId, total: rows.length, records: rows });
});

app.post('/api/marketplace-special-users', (req, res) => {
  const marketplaceId = typeof req.body?.marketplaceId === 'string' ? normalizeMarketplaceId(req.body.marketplaceId) : null;
  if (!marketplaceId) {
    return res.status(400).json({ message: 'Provide valid marketplaceId.' });
  }

  const descriptor = readMarketplaceDescriptors().find((row) => row.id === marketplaceId);
  if (!descriptor) {
    return res.status(404).json({ message: 'Marketplace descriptor missing.' });
  }

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  if (!name || !email || !title) {
    return res.status(400).json({ message: 'Provide name, email, and title.' });
  }

  const rows = readMarketplaceSpecialUsers();
  const nowIso = new Date().toISOString();
  const record: MarketplaceSpecialUser = {
    id: createSpecialUserId(rows),
    marketplaceId,
    marketplaceName: descriptor.name,
    userId: typeof req.body?.userId === 'string' ? req.body.userId : `USR-SPECIAL-${Date.now().toString(36)}`,
    name,
    email,
    title,
    permissions: Array.isArray(req.body?.permissions)
      ? req.body.permissions.filter((value: unknown): value is string => typeof value === 'string')
      : ['catalog:read'],
    status: req.body?.status === 'on-leave' || req.body?.status === 'suspended' || req.body?.status === 'active' ? req.body.status : 'active',
    createdAt: nowIso,
    updatedAt: nowIso
  };

  rows.unshift(record);
  writeMarketplaceSpecialUsers(rows);
  appendIngestionAudit({ scope: 'special-users', action: 'create', marketplaceId, recordId: record.id });
  return res.json({ ok: true, message: 'Special user created.', record });
});

app.put('/api/marketplace-special-users/:id', (req, res) => {
  const rows = readMarketplaceSpecialUsers();
  const index = rows.findIndex((row) => row.id === req.params.id);
  if (index < 0) {
    return res.status(404).json({ message: 'Special user not found.' });
  }

  const current = { ...rows[index] };
  if (typeof req.body?.name === 'string' && req.body.name.trim()) current.name = req.body.name.trim();
  if (typeof req.body?.email === 'string' && req.body.email.trim()) current.email = req.body.email.trim();
  if (typeof req.body?.title === 'string' && req.body.title.trim()) current.title = req.body.title.trim();
  if (req.body?.status === 'on-leave' || req.body?.status === 'suspended' || req.body?.status === 'active') {
    current.status = req.body.status;
  }
  if (Array.isArray(req.body?.permissions)) {
    current.permissions = req.body.permissions.filter((value: unknown): value is string => typeof value === 'string');
  }
  current.updatedAt = new Date().toISOString();

  rows[index] = current;
  writeMarketplaceSpecialUsers(rows);
  appendIngestionAudit({ scope: 'special-users', action: 'update', recordId: current.id });
  return res.json({ ok: true, message: 'Special user updated.', record: current });
});

app.delete('/api/marketplace-special-users/:id', (req, res) => {
  const rows = readMarketplaceSpecialUsers();
  const index = rows.findIndex((row) => row.id === req.params.id);
  if (index < 0) {
    return res.status(404).json({ message: 'Special user not found.' });
  }

  const [deleted] = rows.splice(index, 1);
  writeMarketplaceSpecialUsers(rows);
  appendIngestionAudit({ scope: 'special-users', action: 'delete', recordId: deleted.id });
  return res.json({ ok: true, message: 'Special user deleted.', record: deleted });
});

app.get('/api/user-monitoring', (req, res) => {
  const rows = readUserMonitoringRecords();
  const severity = typeof req.query.severity === 'string' ? req.query.severity : '';
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  const filtered = rows.filter((row) => {
    if (severity && row.severity !== severity) {
      return false;
    }
    if (userId && row.userId !== userId) {
      return false;
    }
    return true;
  });
  return res.json({ total: filtered.length, records: filtered });
});

app.post('/api/user-monitoring', (req, res) => {
  const rows = readUserMonitoringRecords();
  const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
  const userName = typeof req.body?.userName === 'string' ? req.body.userName.trim() : '';
  const eventType = typeof req.body?.eventType === 'string' ? req.body.eventType.trim() : '';
  if (!userId || !userName || !eventType) {
    return res.status(400).json({ message: 'Provide userId, userName, and eventType.' });
  }

  const record: UserMonitoringRecord = {
    id: createMonitoringRecordId(rows),
    userId,
    userName,
    eventType,
    severity:
      req.body?.severity === 'critical' || req.body?.severity === 'warning' || req.body?.severity === 'info'
        ? req.body.severity
        : 'info',
    ipAddress: typeof req.body?.ipAddress === 'string' ? req.body.ipAddress : '0.0.0.0',
    location: typeof req.body?.location === 'string' ? req.body.location : 'Unknown',
    device: typeof req.body?.device === 'string' ? req.body.device : 'Web',
    notes: typeof req.body?.notes === 'string' ? req.body.notes : 'User monitoring event',
    timestamp: new Date().toISOString()
  };

  rows.unshift(record);
  writeUserMonitoringRecords(rows);
  appendIngestionAudit({ scope: 'user-monitoring', action: 'create', recordId: record.id });
  return res.json({ ok: true, message: 'User monitoring event stored.', record });
});

app.put('/api/user-monitoring/:id', (req, res) => {
  const rows = readUserMonitoringRecords();
  const index = rows.findIndex((row) => row.id === req.params.id);
  if (index < 0) {
    return res.status(404).json({ message: 'Monitoring record not found.' });
  }

  const current = { ...rows[index] };
  if (typeof req.body?.eventType === 'string' && req.body.eventType.trim()) current.eventType = req.body.eventType.trim();
  if (typeof req.body?.notes === 'string') current.notes = req.body.notes;
  if (typeof req.body?.location === 'string' && req.body.location.trim()) current.location = req.body.location.trim();
  if (typeof req.body?.device === 'string' && req.body.device.trim()) current.device = req.body.device.trim();
  if (req.body?.severity === 'critical' || req.body?.severity === 'warning' || req.body?.severity === 'info') {
    current.severity = req.body.severity;
  }
  current.timestamp = new Date().toISOString();

  rows[index] = current;
  writeUserMonitoringRecords(rows);
  appendIngestionAudit({ scope: 'user-monitoring', action: 'update', recordId: current.id });
  return res.json({ ok: true, message: 'Monitoring record updated.', record: current });
});

app.delete('/api/user-monitoring/:id', (req, res) => {
  const rows = readUserMonitoringRecords();
  const index = rows.findIndex((row) => row.id === req.params.id);
  if (index < 0) {
    return res.status(404).json({ message: 'Monitoring record not found.' });
  }

  const [deleted] = rows.splice(index, 1);
  writeUserMonitoringRecords(rows);
  appendIngestionAudit({ scope: 'user-monitoring', action: 'delete', recordId: deleted.id });
  return res.json({ ok: true, message: 'Monitoring record deleted.', record: deleted });
});

app.post('/api/user-monitoring/bulk', (req, res) => {
  const incoming = Array.isArray(req.body?.records) ? req.body.records : [];
  if (incoming.length === 0) {
    return res.status(400).json({ message: 'Provide records array for bulk insert.' });
  }

  const rows = readUserMonitoringRecords();
  let created = 0;
  for (const row of incoming) {
    if (typeof row !== 'object' || row === null) {
      continue;
    }

    const payload = row as Record<string, unknown>;
    const userId = typeof payload.userId === 'string' ? payload.userId.trim() : '';
    const userName = typeof payload.userName === 'string' ? payload.userName.trim() : '';
    const eventType = typeof payload.eventType === 'string' ? payload.eventType.trim() : '';
    if (!userId || !userName || !eventType) {
      continue;
    }

    rows.unshift({
      id: createMonitoringRecordId(rows),
      userId,
      userName,
      eventType,
      severity:
        payload.severity === 'critical' || payload.severity === 'warning' || payload.severity === 'info'
          ? payload.severity
          : 'info',
      ipAddress: typeof payload.ipAddress === 'string' ? payload.ipAddress : '0.0.0.0',
      location: typeof payload.location === 'string' ? payload.location : 'Unknown',
      device: typeof payload.device === 'string' ? payload.device : 'Web',
      notes: typeof payload.notes === 'string' ? payload.notes : 'Bulk monitoring import',
      timestamp: new Date().toISOString()
    });
    created += 1;
  }

  writeUserMonitoringRecords(rows);
  appendIngestionAudit({ scope: 'user-monitoring', action: 'bulk-create', created });
  return res.json({ ok: true, message: `Bulk user monitoring insert done: ${created}.`, created, total: rows.length });
});

app.post('/api/storage/append-ndjson/:stream', (req, res) => {
  if (typeof req.body !== 'string' || !req.body.trim()) {
    return res.status(400).json({ message: 'Send text/plain body with NDJSON lines.' });
  }

  const streamName = req.params.stream.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!streamName) {
    return res.status(400).json({ message: 'Invalid stream name.' });
  }

  const streamDir = path.join(dataDir, 'streams');
  ensureDirectory(streamDir);
  const streamPath = path.join(streamDir, `${streamName}.ndjson`);
  fs.appendFileSync(streamPath, `${req.body.trim()}\n`, 'utf-8');
  appendIngestionAudit({ scope: 'ndjson-stream', action: 'append', stream: streamName, bytes: Buffer.byteLength(req.body) });
  return res.json({ ok: true, message: 'NDJSON appended.', stream: streamName, bytesWritten: Buffer.byteLength(req.body) });
});

app.get('/api/baseline', (_req, res) => {
  res.json(readBaseline());
});

app.put('/api/baseline/:item', (req, res) => {
  const item = parseItem(decodeURIComponent(req.params.item));
  const price = parsePositivePrice(req.body?.price);

  if (!item || price === null) {
    return res.status(400).json({ message: 'Provide a valid item path param and positive body.price.' });
  }

  const baseline = readBaseline();
  baseline[item] = price;
  writeBaselineFile(baselinePath, baseline);
  return res.json({ message: 'Baseline updated.', item, price });
});

app.delete('/api/baseline/:item', (req, res) => {
  const item = parseItem(decodeURIComponent(req.params.item));
  if (!item) {
    return res.status(400).json({ message: 'Invalid item path param.' });
  }

  const baseline = readBaseline();
  if (baseline[item] === undefined) {
    return res.status(404).json({ message: 'Baseline item not found.' });
  }

  delete baseline[item];
  writeBaselineFile(baselinePath, baseline);
  return res.json({ message: 'Baseline item deleted.', item });
});

app.get('/api/data/:module', (req, res) => {
  const moduleName = resolveModuleFromRoute(req.params.module);
  if (!moduleName) {
    return res.status(404).json({ message: 'Unknown data module.' });
  }

  const records = readCollection(moduleName);
  return res.json({ module: moduleName, records });
});

app.post('/api/data/:module', (req, res) => {
  const moduleName = resolveModuleFromRoute(req.params.module);
  if (!moduleName) {
    return res.status(404).json({ message: 'Unknown data module.' });
  }

  const result = executeAndPersistAiCommand({
    intent: 'create',
    module: moduleName,
    payload: (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
  });

  return res.status(result.ok ? 200 : 400).json(result);
});

app.put('/api/data/:module/:id', (req, res) => {
  const moduleName = resolveModuleFromRoute(req.params.module);
  if (!moduleName) {
    return res.status(404).json({ message: 'Unknown data module.' });
  }

  const result = executeAndPersistAiCommand({
    intent: 'update',
    module: moduleName,
    id: req.params.id,
    payload: (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
  });

  return res.status(result.ok ? 200 : 400).json(result);
});

app.delete('/api/data/:module/:id', (req, res) => {
  const moduleName = resolveModuleFromRoute(req.params.module);
  if (!moduleName) {
    return res.status(404).json({ message: 'Unknown data module.' });
  }

  const result = executeAndPersistAiCommand({
    intent: 'delete',
    module: moduleName,
    id: req.params.id
  });

  return res.status(result.ok ? 200 : 400).json(result);
});

app.post('/api/ai/data', (req, res) => {
  const command = parseAiCommandBody(req.body);
  if (!command) {
    return res.status(400).json({
      message:
        'Invalid command body. Example: { "intent":"create", "module":"products", "payload": { "name":"Rice", "basePrice":52 } }'
    });
  }

  const result = executeAndPersistAiCommand(command);
  return res.status(result.ok ? 200 : 400).json(result);
});

app.post('/api/ai/command', (req, res) => {
  const text = typeof req.body?.command === 'string' ? req.body.command : '';
  if (!text.trim()) {
    return res.status(400).json({
      message:
        'Provide command text. Example: "create products name=Rice, category=Rice, supplier=Mega Mart, basePrice=52".'
    });
  }

  const parsed = parseAiTextCommand(text);
  if (!parsed) {
    return res.status(400).json({
      message:
        'Could not parse command. Try: "fetch users", "create products name=Rice, basePrice=52", "update alerts id=ALT-1, status=resolved".'
    });
  }

  const result = executeAndPersistAiCommand(parsed);
  return res.status(result.ok ? 200 : 400).json(result);
});

app.get('/api/ai/knowledge-base', (_req, res) => {
  const knowledgeBase = readKnowledgeBase();
  return res.json(knowledgeBase);
});

app.post('/api/ai/maintenance/run-now', async (_req, res) => {
  try {
    const result = await runAiMaintenance('manual');
    return res.status(result.ok ? 200 : 500).json(result);
  } catch {
    return res.status(500).json({ message: 'AI maintenance failed unexpectedly.' });
  }
});

app.post('/api/ai/upload-data', (req, res) => {
  const body = typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
  const explicitModule = resolveAdminModuleAlias(body.module);
  const modeRaw = typeof body.mode === 'string' ? body.mode.trim().toLowerCase() : 'upsert';
  const mode = modeRaw === 'create' || modeRaw === 'update' || modeRaw === 'delete' || modeRaw === 'upsert' ? modeRaw : 'upsert';
  const incoming = Array.isArray(body.records)
    ? body.records
    : Array.isArray(body.data)
      ? body.data
      : Array.isArray(req.body)
        ? (req.body as unknown[])
        : [];

  if (incoming.length === 0) {
    return res.status(400).json({
      message:
        'Provide records for upload. Example: { "module":"products", "mode":"upsert", "records":[{ "name":"Rice", "basePrice":52 }] }'
    });
  }

  let workingCollections = readCollections();
  let workingBaseline = readBaseline();
  const changedModules = new Set<AdminModule>();
  let baselineChanged = false;
  let createdCount = 0;
  let updatedCount = 0;
  let deletedCount = 0;
  let skippedCount = 0;
  const errors: Array<{ index: number; message: string }> = [];

  for (let index = 0; index < incoming.length; index += 1) {
    const entry = incoming[index];
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      skippedCount += 1;
      errors.push({ index, message: 'Record is not a JSON object.' });
      continue;
    }

    const row = entry as Record<string, unknown>;
    let command: AiDataCommand | null = null;
    const parsedCommand = parseAiCommandBody(row);
    if (parsedCommand && parsedCommand.intent !== 'fetch') {
      command = parsedCommand;
    }

    if (!command) {
      const inferredModule = explicitModule ?? resolveAdminModuleAlias(row.module) ?? inferAdminModuleFromPayload(row);
      if (!inferredModule) {
        skippedCount += 1;
        errors.push({ index, message: 'Unable to infer module for record.' });
        continue;
      }

      const id =
        typeof row.id === 'string'
          ? row.id.trim()
          : typeof row.recordId === 'string'
            ? row.recordId.trim()
            : '';

      const payloadSource =
        row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
          ? (row.payload as Record<string, unknown>)
          : row;
      const payload = sanitizeUploadPayload(payloadSource);
      const explicitIntent =
        normalizeUploadIntent(row.intent) ??
        normalizeUploadIntent(row.action) ??
        normalizeUploadIntent(row.operation);

      let intent: AiDataCommand['intent'] = 'create';
      if (explicitIntent) {
        intent = explicitIntent;
      } else if (mode === 'create' || mode === 'update' || mode === 'delete') {
        intent = mode;
      } else if (id) {
        const existingRows = workingCollections[inferredModule] as Array<{ id: string }>;
        intent = existingRows.some((record) => record.id === id) ? 'update' : 'create';
      }

      if ((intent === 'update' || intent === 'delete') && !id) {
        skippedCount += 1;
        errors.push({ index, message: `Intent "${intent}" requires an id.` });
        continue;
      }

      command = {
        intent,
        module: inferredModule,
        id: id || undefined,
        payload: intent === 'delete' ? undefined : payload
      };
    }

    const execution = executeAiDataCommand(command, {
      collections: workingCollections,
      baseline: workingBaseline
    });

    if (!execution.ok) {
      skippedCount += 1;
      errors.push({ index, message: execution.message });
      continue;
    }

    workingCollections = execution.collections;
    workingBaseline = execution.baseline;
    execution.changedModules.forEach((moduleName) => changedModules.add(moduleName));
    baselineChanged = baselineChanged || execution.baselineChanged;

    if (command.intent === 'create') createdCount += 1;
    if (command.intent === 'update') updatedCount += 1;
    if (command.intent === 'delete') deletedCount += 1;
  }

  if (changedModules.size > 0) {
    persistChangedCollections([...changedModules], workingCollections);
  }
  if (baselineChanged) {
    writeBaselineFile(baselinePath, workingBaseline);
  }

  const nowIso = new Date().toISOString();
  const metrics = deriveMetricsFromCollections(workingCollections);
  const liveSnapshot = readLiveMetrics();
  const variancePct = metrics.productsTracked > 0 ? Number(((metrics.flaggedListings / metrics.productsTracked) * 100).toFixed(2)) : 0;
  writeLiveMetrics({
    updatedAt: nowIso,
    tickCount: liveSnapshot.tickCount + 1,
    metrics,
    chart: {
      varianceTrend: addPointToSeries(liveSnapshot.chart.varianceTrend, { ts: nowIso, value: clampNumber(variancePct, 0, 100) }),
      fairnessTrend: addPointToSeries(liveSnapshot.chart.fairnessTrend, { ts: nowIso, value: clampNumber(metrics.averageFairness, 0, 100) }),
      savingsTrend: addPointToSeries(liveSnapshot.chart.savingsTrend, { ts: nowIso, value: Math.max(0, metrics.estimatedSavings) })
    },
    source: 'live'
  });

  appendLiveFeedback({
    scope: 'upload-data',
    trigger: 'manual',
    level: errors.length > 0 ? 'warning' : 'info',
    message: `Upload processed ${incoming.length} rows (create:${createdCount}, update:${updatedCount}, delete:${deletedCount}, skipped:${skippedCount}).`,
    data: {
      modulesChanged: [...changedModules],
      baselineChanged,
      errors: errors.slice(0, 10)
    }
  });

  return res.json({
    ok: true,
    totalRows: incoming.length,
    created: createdCount,
    updated: updatedCount,
    deleted: deletedCount,
    skipped: skippedCount,
    modulesChanged: [...changedModules],
    baselineChanged,
    metrics,
    errors: errors.slice(0, 20)
  });
});

app.post('/api/ai/image-analysis', async (req, res) => {
  const imageData = typeof req.body?.imageData === 'string' ? req.body.imageData : undefined;
  const imageName = typeof req.body?.imageName === 'string' ? req.body.imageName : undefined;
  const imageTextHint =
    typeof req.body?.imageTextHint === 'string'
      ? req.body.imageTextHint
      : typeof req.body?.imageText === 'string'
        ? req.body.imageText
        : undefined;

  if (!imageData && !imageName && !imageTextHint) {
    return res.status(400).json({
      message: 'Provide at least one image hint: imageData, imageName, or imageTextHint.'
    });
  }

  try {
    const analysis = await analyzeImagePayload({
      imageData,
      imageName,
      imageTextHint
    });

    appendLiveFeedback({
      scope: 'image-analysis',
      level: toFeedbackLevelFromCriticalLevel(analysis.critical.criticalLevel),
      message: `Image analyzed: ${analysis.suggestedName} (${analysis.critical.criticalLabel}).`,
      data: {
        provider: analysis.provider,
        confidence: analysis.confidence,
        criticalLevel: analysis.critical.criticalLevel
      }
    });

    return res.json({ ok: true, analysis });
  } catch {
    return res.status(500).json({ message: 'Image analysis failed.' });
  }
});

app.post('/api/ai/product-scanner', async (req, res) => {
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!query) {
    return res.status(400).json({ message: 'Provide query text for product scanner.' });
  }

  const mode = typeof req.body?.mode === 'string' ? req.body.mode : 'basic';
  try {
    const result = await buildScannerResult({
      query,
      mode,
      records: buildScannerSourceRecords(),
      baseline: readBaseline()
    });

    appendLiveFeedback({
      scope: 'product-scanner',
      level: toFeedbackLevelFromCriticalLevel(result.critical.criticalLevel),
      message: `Scanner analyzed "${query}" with fairness score ${result.fairnessScore}/100.`,
      data: {
        product: result.product,
        fairnessScore: result.fairnessScore,
        criticalLevel: result.critical.criticalLevel
      }
    });

    return res.json({ ok: true, result });
  } catch {
    return res.status(500).json({ message: 'Product scanner analysis failed.' });
  }
});

app.get('/api/live/metrics', (_req, res) => {
  const snapshot = readLiveMetrics();
  return res.json(snapshot);
});

app.post('/api/live/tick/run-now', async (_req, res) => {
  try {
    const result = await runAiMinuteTick('manual');
    return res.status(result.ok ? 200 : 500).json(result);
  } catch {
    return res.status(500).json({ message: 'Minute tick failed unexpectedly.' });
  }
});

app.get('/api/live-feedback', (req, res) => {
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit) ? requestedLimit : 100;
  const records = readLiveFeedback(limit);
  return res.json({ total: records.length, records });
});

app.get('/api/live-feedback/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const initial = readLiveFeedback(10).slice().reverse();
  for (const record of initial) {
    res.write(`data: ${JSON.stringify(record)}\n\n`);
  }

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      // closed response
    }
  }, 25000);

  liveFeedbackClients.add(res);
  req.on('close', () => {
    clearInterval(heartbeat);
    liveFeedbackClients.delete(res);
    res.end();
  });
});

app.post('/api/assess', (req, res) => {
  const item = parseItem(req.body?.item);
  const price = parsePositivePrice(req.body?.price);

  if (!item || price === null) {
    return res.status(400).json({
      flag: 'invalid',
      message: 'Please provide a valid item and positive price.'
    });
  }

  const baseline = readBaseline();
  const expectedPrice = baseline[item];

  if (expectedPrice === undefined) {
    return res.json({
      item,
      price,
      flag: 'unknown',
      message: `No baseline available for "${item}" yet.`
    });
  }

  const assessment = assessPrice(item, price, expectedPrice);
  return res.json({
    item,
    price,
    expectedPrice,
    ...assessment
  });
});

app.post('/api/ingest-document', (req, res) => {
  const documentText = typeof req.body?.document === 'string' ? req.body.document.trim() : '';

  if (!documentText) {
    return res.status(400).json({
      message: 'Please provide document text in the "document" field.'
    });
  }

  const baselineBefore = readBaseline();
  const ingestResult = ingestDocumentToBaseline(documentText, baselinePath);

  const expensiveFindings = Object.entries(ingestResult.extracted)
    .map(([item, observedPrice]) => {
      const expectedPrice = baselineBefore[item];
      if (expectedPrice === undefined) {
        return null;
      }

      const assessment = assessPrice(item, observedPrice, expectedPrice);
      if (!isExpensiveFlag(assessment.flag)) {
        return null;
      }

      return {
        item,
        observedPrice,
        expectedPrice,
        ...assessment
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);

  return res.json({
    message: 'Document merged into baseline.',
    summary: {
      extractedItems: Object.keys(ingestResult.extracted).length,
      createdItems: ingestResult.created.length,
      updatedItems: ingestResult.updated.length,
      ignoredLines: ingestResult.ignoredLines
    },
    expensiveRecommendations: expensiveFindings
  });
});

app.post('/api/recommend-expensive', (req, res) => {
  const entries = req.body?.entries;

  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({
      message: 'Please provide entries as an array: [{ item, price }].'
    });
  }

  const baseline = readBaseline();
  const recommendations: RecommendationRow[] = [];
  let skippedEntries = 0;

  for (const entry of entries) {
    const item = parseItem((entry as { item?: unknown }).item);
    const price = parsePositivePrice((entry as { price?: unknown }).price);

    if (!item || price === null) {
      skippedEntries += 1;
      continue;
    }

    const expectedPrice = baseline[item];
    if (expectedPrice === undefined) {
      recommendations.push({
        item,
        price,
        flag: 'unknown',
        message: `No baseline available for "${item}" yet.`
      });
      continue;
    }

    const assessment = assessPrice(item, price, expectedPrice);
    recommendations.push({
      item,
      price,
      expectedPrice,
      ...assessment
    });
  }

  const expensive = recommendations.filter(
    (row): row is RecommendationRow & { expectedPrice: number; flag: 'high-risk' | 'overpriced' } =>
      row.expectedPrice !== undefined && isExpensiveFlag(row.flag)
  );

  return res.json({
    recommendations,
    expensive,
    skippedEntries
  });
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ message: 'Endpoint not found.' });
  }

  return res.status(404).send('Page not found.');
});

app.use((_error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  return res.status(500).json({
    message: 'Internal server error.'
  });
});

app.listen(port, () => {
  console.log(`PRISM server running on http://localhost:${port}`);
});
