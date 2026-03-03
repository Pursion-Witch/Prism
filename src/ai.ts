import fs from 'node:fs';
import path from 'node:path';

export type BaselineMap = Record<string, number>;

export type PriceFlag = 'high-risk' | 'overpriced' | 'fair' | 'cheap' | 'steal';

export interface PriceAssessment {
  flag: PriceFlag;
  message: string;
}

export interface IngestResult {
  extracted: BaselineMap;
  created: string[];
  updated: string[];
  ignoredLines: number;
}

const HIGH_RISK_RATIO = 1.3;
const OVERPRICED_RATIO = 1.1;
const STEAL_RATIO = 0.8;
const CHEAP_RATIO = 0.9;

export function normalizeItemName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function roundPrice(value: number): number {
  return Number(value.toFixed(2));
}

function formatPrice(value: number): string {
  return `PHP ${value.toFixed(2)}`;
}

function parsePrice(value: string): number | null {
  const parsed = Number(value.replace(/,/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}
// product name - price in any other manner that shows to separate the two products doedil ni gian - 500
function parseLineToEntry(line: string): { item: string; price: number } | null {
  const pattern =
    /^\s*([a-z][a-z0-9\s/&(),.-]{1,80}?)\s*(?::|-|\s)\s*(?:php|p)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*$/i;
  const match = line.match(pattern);
  if (!match) {
    return null;
  }

  const item = normalizeItemName(match[1]);
  const price = parsePrice(match[2]);
  if (!item || price === null) {
    return null;
  }

  return { item, price: roundPrice(price) };
}

export function extractBaselineFromDocument(documentText: string): {
  extracted: BaselineMap;
  ignoredLines: number;
} {
  const lines = documentText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const running = new Map<string, { sum: number; count: number }>();
  let ignoredLines = 0;

  for (const line of lines) {
    const parsed = parseLineToEntry(line);
    if (!parsed) {
      ignoredLines += 1;
      continue;
    }

    const current = running.get(parsed.item) ?? { sum: 0, count: 0 };
    current.sum += parsed.price;
    current.count += 1;
    running.set(parsed.item, current);
  }

  const extracted = [...running.entries()].reduce<BaselineMap>((acc, [item, totals]) => {
    acc[item] = roundPrice(totals.sum / totals.count);
    return acc;
  }, {});

  return { extracted, ignoredLines };
}

export function readBaselineFile(baselinePath: string): BaselineMap {
  try {
    const raw = fs.readFileSync(baselinePath, 'utf-8');
    const parsed = JSON.parse(raw);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }

    return Object.entries(parsed as Record<string, unknown>).reduce<BaselineMap>((acc, [key, value]) => {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        acc[normalizeItemName(key)] = roundPrice(value);
      }

      return acc;
    }, {});
  } catch {
    return {};
  }
}

export function mergeBaseline(
  current: BaselineMap,
  incoming: BaselineMap
): { merged: BaselineMap; created: string[]; updated: string[] } {
  const merged: BaselineMap = { ...current };
  const created: string[] = [];
  const updated: string[] = [];

  for (const [item, incomingPrice] of Object.entries(incoming)) {
    const normalizedItem = normalizeItemName(item);
    const existingPrice = merged[normalizedItem];

    if (existingPrice === undefined) {
      merged[normalizedItem] = incomingPrice;
      created.push(normalizedItem);
      continue;
    }

    merged[normalizedItem] = roundPrice((existingPrice + incomingPrice) / 2);
    updated.push(normalizedItem);
  }

  return { merged, created, updated };
}

export function writeBaselineFile(baselinePath: string, baseline: BaselineMap): void {
  const baselineDir = path.dirname(baselinePath);
  if (!fs.existsSync(baselineDir)) {
    fs.mkdirSync(baselineDir, { recursive: true });
  }

  const normalized = Object.entries(baseline)
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .reduce<BaselineMap>((acc, [key, value]) => {
      acc[normalizeItemName(key)] = roundPrice(value);
      return acc;
    }, {});

  fs.writeFileSync(baselinePath, JSON.stringify(normalized, null, 2), 'utf-8');
}

export function isExpensiveFlag(flag: string): flag is 'high-risk' | 'overpriced' {
  return flag === 'high-risk' || flag === 'overpriced';
}

export function assessPrice(item: string, observedPrice: number, expectedPrice: number): PriceAssessment {
  const ratio = observedPrice / expectedPrice;
  const normalizedItem = normalizeItemName(item);

  if (ratio >= HIGH_RISK_RATIO) {
    return {
      flag: 'high-risk',
      message: `High-risk price for ${normalizedItem}: expected around ${formatPrice(expectedPrice)}, observed ${formatPrice(observedPrice)}.`
    };
  }

  if (ratio >= OVERPRICED_RATIO) {
    return {
      flag: 'overpriced',
      message: `Slightly overpriced ${normalizedItem}: expected around ${formatPrice(expectedPrice)}, observed ${formatPrice(observedPrice)}.`
    };
  }

  if (ratio <= STEAL_RATIO) {
    return {
      flag: 'steal',
      message: `Very low price for ${normalizedItem}: expected around ${formatPrice(expectedPrice)}, observed ${formatPrice(observedPrice)}.`
    };
  }

  if (ratio <= CHEAP_RATIO) {
    return {
      flag: 'cheap',
      message: `Below-market ${normalizedItem}: expected around ${formatPrice(expectedPrice)}, observed ${formatPrice(observedPrice)}.`
    };
  }

  return {
    flag: 'fair',
    message: `Fair price for ${normalizedItem}. Baseline is around ${formatPrice(expectedPrice)}.`
  };
}

export function ingestDocumentToBaseline(documentText: string, baselinePath: string): IngestResult {
  const { extracted, ignoredLines } = extractBaselineFromDocument(documentText);
  const current = readBaselineFile(baselinePath);
  const { merged, created, updated } = mergeBaseline(current, extracted);
  writeBaselineFile(baselinePath, merged);

  return {
    extracted,
    created,
    updated,
    ignoredLines
  };
}

export type AdminModule = 'users' | 'products' | 'priceMonitoring' | 'alerts' | 'reports';
export type AiIntent = 'fetch' | 'create' | 'update' | 'delete' | 'generate';

export type UserRole = 'consumer' | 'supplier' | 'agency' | 'admin';
export type UserStatus = 'active' | 'pending' | 'suspended';

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

export type ProductStatus = 'active' | 'hidden' | 'low-stock';

export interface ProductRecord {
  id: string;
  name: string;
  category: string;
  supplier: string;
  basePrice: number;
  status: ProductStatus;
  imageName?: string;
  imageData?: string;
  imageText?: string;
  createdAt: string;
  updatedAt: string;
}

export type PriceMonitoringFlag = PriceFlag | 'unknown';

export interface PriceMonitoringRecord {
  id: string;
  item: string;
  observedPrice: number;
  expectedPrice?: number;
  differencePct?: number;
  flag: PriceMonitoringFlag;
  location: string;
  source: string;
  message: string;
  recordedAt: string;
}

export type AlertType = 'price' | 'supplier' | 'user' | 'system';
export type AlertPriority = 'high' | 'medium' | 'low';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved';

export interface AlertRecord {
  id: string;
  title: string;
  message: string;
  type: AlertType;
  priority: AlertPriority;
  status: AlertStatus;
  relatedEntityId?: string;
  createdAt: string;
  updatedAt: string;
}

export type ReportPeriod = 'weekly' | 'monthly' | 'quarterly';

export interface ReportMetrics {
  averageFairness: number;
  flaggedListings: number;
  highRiskCount: number;
  underpricedCount: number;
  totalUsers: number;
  totalProducts: number;
  openAlerts: number;
  estimatedSavings: number;
}

export interface ReportRecord {
  id: string;
  title: string;
  period: ReportPeriod;
  generatedAt: string;
  metrics: ReportMetrics;
  summary: string;
}

export interface AdminCollections {
  users: UserRecord[];
  products: ProductRecord[];
  priceMonitoring: PriceMonitoringRecord[];
  alerts: AlertRecord[];
  reports: ReportRecord[];
}

export interface AiDataCommand {
  intent: AiIntent;
  module: AdminModule;
  id?: string;
  payload?: Record<string, unknown>;
  filters?: Record<string, unknown>;
}

export interface AiExecutionResult {
  ok: boolean;
  message: string;
  collections: AdminCollections;
  baseline: BaselineMap;
  changedModules: AdminModule[];
  baselineChanged: boolean;
  result?: unknown;
}

export interface AnalyticsMetrics {
  totalUsers: number;
  activeSuppliers: number;
  productsTracked: number;
  openAlerts: number;
  averageFairness: number;
  flaggedListings: number;
  highRiskCount: number;
  underpricedCount: number;
  estimatedSavings: number;
}

export interface ActivityItem {
  id: string;
  actor: string;
  action: string;
  status: string;
  timestamp: string;
}

export interface AdminSnapshot {
  metrics: AnalyticsMetrics;
  recentActivity: ActivityItem[];
}

const USER_ROLES: readonly UserRole[] = ['consumer', 'supplier', 'agency', 'admin'];
const USER_STATUSES: readonly UserStatus[] = ['active', 'pending', 'suspended'];
const PRODUCT_STATUSES: readonly ProductStatus[] = ['active', 'hidden', 'low-stock'];
const ALERT_TYPES: readonly AlertType[] = ['price', 'supplier', 'user', 'system'];
const ALERT_PRIORITIES: readonly AlertPriority[] = ['high', 'medium', 'low'];
const ALERT_STATUSES: readonly AlertStatus[] = ['open', 'acknowledged', 'resolved'];
const REPORT_PERIODS: readonly ReportPeriod[] = ['weekly', 'monthly', 'quarterly'];

const MODULE_ALIASES: Record<string, AdminModule> = {
  user: 'users',
  users: 'users',
  'user-management': 'users',
  product: 'products',
  products: 'products',
  'product-catalog': 'products',
  catalog: 'products',
  price: 'priceMonitoring',
  prices: 'priceMonitoring',
  monitoring: 'priceMonitoring',
  pricemonitoring: 'priceMonitoring',
  'price-monitoring': 'priceMonitoring',
  'price-monitorings': 'priceMonitoring',
  alert: 'alerts',
  alerts: 'alerts',
  report: 'reports',
  reports: 'reports',
  analytics: 'reports',
  'reports-analytics': 'reports'
};

const INTENT_ALIASES: Record<string, AiIntent> = {
  fetch: 'fetch',
  get: 'fetch',
  read: 'fetch',
  list: 'fetch',
  create: 'create',
  add: 'create',
  insert: 'create',
  new: 'create',
  update: 'update',
  edit: 'update',
  modify: 'update',
  patch: 'update',
  delete: 'delete',
  remove: 'delete',
  generate: 'generate',
  analyze: 'generate',
  analyse: 'generate'
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function toStringValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNumberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function toPositiveNumberValue(value: unknown): number | null {
  const parsed = toNumberValue(value);
  if (parsed === null || parsed <= 0) {
    return null;
  }

  return roundPrice(parsed);
}

function normalizeIntent(value: unknown): AiIntent | null {
  if (typeof value !== 'string') {
    return null;
  }

  return INTENT_ALIASES[value.trim().toLowerCase()] ?? null;
}

function normalizeModule(value: unknown): AdminModule | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[&]+/g, '-')
    .replace(/[\s_]+/g, '-');
  return MODULE_ALIASES[normalized] ?? null;
}

function findKey(record: Record<string, unknown>, key: string): string | null {
  const lower = key.toLowerCase();
  for (const existing of Object.keys(record)) {
    if (existing.toLowerCase() === lower) {
      return existing;
    }
  }

  return null;
}

function getRecordValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const matchedKey = findKey(record, key);
    if (matchedKey) {
      return record[matchedKey];
    }
  }

  return undefined;
}

function hasRecordValue(record: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => findKey(record, key) !== null);
}

function toEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof value !== 'string') {
    return fallback;
  }

  const candidate = value.trim().toLowerCase();
  return (allowed.find((entry) => entry === candidate) ?? fallback) as T;
}

function createId(prefix: string, rows: Array<{ id: string }>): string {
  let candidate = '';
  do {
    candidate = `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  } while (rows.some((row) => row.id === candidate));

  return candidate;
}

function parseValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }

  const unquoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ? trimmed.slice(1, -1).trim()
      : trimmed;

  if (/^(true|false)$/i.test(unquoted)) {
    return unquoted.toLowerCase() === 'true';
  }

  const maybeNumber = Number(unquoted.replace(/,/g, ''));
  if (Number.isFinite(maybeNumber) && /^-?[0-9][0-9,]*(\.[0-9]+)?$/.test(unquoted)) {
    return maybeNumber;
  }

  return unquoted;
}

function parseAssignments(raw: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const segments = raw
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const separatorIndex = segment.includes('=') ? segment.indexOf('=') : segment.indexOf(':');
    if (separatorIndex < 1) {
      continue;
    }

    const key = segment.slice(0, separatorIndex).trim();
    const value = segment.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }

    payload[key] = parseValue(value);
  }

  return payload;
}

function cloneCollections(collections: AdminCollections): AdminCollections {
  return {
    users: collections.users.map((row) => ({ ...row })),
    products: collections.products.map((row) => ({ ...row })),
    priceMonitoring: collections.priceMonitoring.map((row) => ({ ...row })),
    alerts: collections.alerts.map((row) => ({ ...row })),
    reports: collections.reports.map((row) => ({ ...row }))
  };
}

function applyFilters<T extends object>(rows: T[], filters?: Record<string, unknown>): T[] {
  if (!filters || Object.keys(filters).length === 0) {
    return rows.map((row) => ({ ...row }));
  }

  return rows.filter((row) => {
    for (const [filterKey, filterValue] of Object.entries(filters)) {
      if (filterValue === undefined || filterValue === null || filterValue === '') {
        continue;
      }

      const rowValue = (row as Record<string, unknown>)[filterKey];
      if (typeof rowValue === 'string' && typeof filterValue === 'string') {
        if (!rowValue.toLowerCase().includes(filterValue.toLowerCase())) {
          return false;
        }
        continue;
      }

      if (typeof rowValue === 'number' && typeof filterValue === 'number') {
        if (rowValue !== filterValue) {
          return false;
        }
        continue;
      }

      if (String(rowValue).toLowerCase() !== String(filterValue).toLowerCase()) {
        return false;
      }
    }

    return true;
  });
}

function createUserRecord(payload: Record<string, unknown>, rows: UserRecord[], nowIso: string): UserRecord | null {
  const name = toStringValue(getRecordValue(payload, ['name', 'fullName', 'username']));
  const email = toStringValue(getRecordValue(payload, ['email', 'mail']))?.toLowerCase();
  if (!name || !email) {
    return null;
  }

  return {
    id: createId('USR', rows),
    name,
    email,
    role: toEnum(getRecordValue(payload, ['role']), USER_ROLES, 'consumer'),
    status: toEnum(getRecordValue(payload, ['status']), USER_STATUSES, 'active'),
    createdAt: nowIso,
    updatedAt: nowIso
  };
}

function updateUserRecord(current: UserRecord, payload: Record<string, unknown>, nowIso: string): UserRecord {
  const next: UserRecord = { ...current, updatedAt: nowIso };

  const name = toStringValue(getRecordValue(payload, ['name', 'fullName', 'username']));
  if (name) {
    next.name = name;
  }

  const email = toStringValue(getRecordValue(payload, ['email', 'mail']))?.toLowerCase();
  if (email) {
    next.email = email;
  }

  if (hasRecordValue(payload, ['role'])) {
    next.role = toEnum(getRecordValue(payload, ['role']), USER_ROLES, next.role);
  }

  if (hasRecordValue(payload, ['status'])) {
    next.status = toEnum(getRecordValue(payload, ['status']), USER_STATUSES, next.status);
  }

  return next;
}

function createProductRecord(payload: Record<string, unknown>, rows: ProductRecord[], nowIso: string): ProductRecord | null {
  const name = toStringValue(getRecordValue(payload, ['name', 'product', 'item']));
  const category = toStringValue(getRecordValue(payload, ['category'])) ?? 'general';
  const supplier = toStringValue(getRecordValue(payload, ['supplier', 'vendor'])) ?? 'Unknown Supplier';
  const basePrice = toPositiveNumberValue(getRecordValue(payload, ['basePrice', 'price', 'srp']));
  if (!name || basePrice === null) {
    return null;
  }

  return {
    id: createId('PRD', rows),
    name,
    category,
    supplier,
    basePrice,
    status: toEnum(getRecordValue(payload, ['status']), PRODUCT_STATUSES, 'active'),
    imageName: toStringValue(getRecordValue(payload, ['imageName', 'pictureName', 'fileName'])) ?? undefined,
    imageData: toStringValue(getRecordValue(payload, ['imageData', 'image', 'photo'])) ?? undefined,
    imageText: toStringValue(getRecordValue(payload, ['imageText', 'pictureText', 'ocrText', 'text'])) ?? undefined,
    createdAt: nowIso,
    updatedAt: nowIso
  };
}

function updateProductRecord(current: ProductRecord, payload: Record<string, unknown>, nowIso: string): ProductRecord {
  const next: ProductRecord = { ...current, updatedAt: nowIso };

  const name = toStringValue(getRecordValue(payload, ['name', 'product', 'item']));
  if (name) {
    next.name = name;
  }

  const category = toStringValue(getRecordValue(payload, ['category']));
  if (category) {
    next.category = category;
  }

  const supplier = toStringValue(getRecordValue(payload, ['supplier', 'vendor']));
  if (supplier) {
    next.supplier = supplier;
  }

  const basePrice = toPositiveNumberValue(getRecordValue(payload, ['basePrice', 'price', 'srp']));
  if (basePrice !== null) {
    next.basePrice = basePrice;
  }

  if (hasRecordValue(payload, ['status'])) {
    next.status = toEnum(getRecordValue(payload, ['status']), PRODUCT_STATUSES, next.status);
  }

  const imageName = toStringValue(getRecordValue(payload, ['imageName', 'pictureName', 'fileName']));
  if (imageName) {
    next.imageName = imageName;
  }

  const imageData = toStringValue(getRecordValue(payload, ['imageData', 'image', 'photo']));
  if (imageData) {
    next.imageData = imageData;
  }

  const imageText = toStringValue(getRecordValue(payload, ['imageText', 'pictureText', 'ocrText', 'text']));
  if (imageText) {
    next.imageText = imageText;
  }

  return next;
}

function createPriceMonitoringRecord(
  payload: Record<string, unknown>,
  rows: PriceMonitoringRecord[],
  baseline: BaselineMap,
  nowIso: string
): PriceMonitoringRecord | null {
  const itemRaw = toStringValue(getRecordValue(payload, ['item', 'name', 'product']));
  const observedPrice = toPositiveNumberValue(getRecordValue(payload, ['price', 'observedPrice', 'marketPrice']));
  if (!itemRaw || observedPrice === null) {
    return null;
  }

  const item = normalizeItemName(itemRaw);
  const explicitExpected = toPositiveNumberValue(getRecordValue(payload, ['expectedPrice']));
  const expectedPrice = explicitExpected ?? baseline[item];

  let flag: PriceMonitoringFlag = 'unknown';
  let message = `No baseline available for "${item}" yet.`;

  if (expectedPrice !== undefined) {
    const assessment = assessPrice(item, observedPrice, expectedPrice);
    flag = assessment.flag;
    message = assessment.message;
  }

  return {
    id: createId('PM', rows),
    item,
    observedPrice,
    expectedPrice: expectedPrice === undefined ? undefined : roundPrice(expectedPrice),
    differencePct:
      expectedPrice === undefined ? undefined : roundPrice(((observedPrice - expectedPrice) / expectedPrice) * 100),
    flag,
    location: toStringValue(getRecordValue(payload, ['location', 'region'])) ?? 'Unknown',
    source: toStringValue(getRecordValue(payload, ['source'])) ?? 'manual',
    message,
    recordedAt: toStringValue(getRecordValue(payload, ['recordedAt', 'timestamp'])) ?? nowIso
  };
}

function updatePriceMonitoringRecord(
  current: PriceMonitoringRecord,
  payload: Record<string, unknown>,
  baseline: BaselineMap
): PriceMonitoringRecord {
  const next: PriceMonitoringRecord = { ...current };

  const itemRaw = toStringValue(getRecordValue(payload, ['item', 'name', 'product']));
  if (itemRaw) {
    next.item = normalizeItemName(itemRaw);
  }

  const observedPrice = toPositiveNumberValue(getRecordValue(payload, ['price', 'observedPrice', 'marketPrice']));
  if (observedPrice !== null) {
    next.observedPrice = observedPrice;
  }

  if (hasRecordValue(payload, ['expectedPrice'])) {
    const explicitExpected = toPositiveNumberValue(getRecordValue(payload, ['expectedPrice']));
    next.expectedPrice = explicitExpected === null ? undefined : explicitExpected;
  } else if (next.expectedPrice === undefined && baseline[next.item] !== undefined) {
    next.expectedPrice = roundPrice(baseline[next.item]);
  }

  const location = toStringValue(getRecordValue(payload, ['location', 'region']));
  if (location) {
    next.location = location;
  }

  const source = toStringValue(getRecordValue(payload, ['source']));
  if (source) {
    next.source = source;
  }

  const recordedAt = toStringValue(getRecordValue(payload, ['recordedAt', 'timestamp']));
  if (recordedAt) {
    next.recordedAt = recordedAt;
  }

  if (next.expectedPrice === undefined) {
    next.flag = 'unknown';
    next.message = `No baseline available for "${next.item}" yet.`;
    next.differencePct = undefined;
  } else {
    const assessment = assessPrice(next.item, next.observedPrice, next.expectedPrice);
    next.flag = assessment.flag;
    next.message = assessment.message;
    next.differencePct = roundPrice(((next.observedPrice - next.expectedPrice) / next.expectedPrice) * 100);
  }

  return next;
}

function createAlertRecord(payload: Record<string, unknown>, rows: AlertRecord[], nowIso: string): AlertRecord | null {
  const title = toStringValue(getRecordValue(payload, ['title', 'name']));
  const message = toStringValue(getRecordValue(payload, ['message', 'details'])) ?? title;
  if (!title || !message) {
    return null;
  }

  return {
    id: createId('ALT', rows),
    title,
    message,
    type: toEnum(getRecordValue(payload, ['type']), ALERT_TYPES, 'system'),
    priority: toEnum(getRecordValue(payload, ['priority']), ALERT_PRIORITIES, 'medium'),
    status: toEnum(getRecordValue(payload, ['status']), ALERT_STATUSES, 'open'),
    relatedEntityId: toStringValue(getRecordValue(payload, ['relatedEntityId', 'relatedId'])) ?? undefined,
    createdAt: nowIso,
    updatedAt: nowIso
  };
}

function updateAlertRecord(current: AlertRecord, payload: Record<string, unknown>, nowIso: string): AlertRecord {
  const next: AlertRecord = { ...current, updatedAt: nowIso };

  const title = toStringValue(getRecordValue(payload, ['title', 'name']));
  if (title) {
    next.title = title;
  }

  const message = toStringValue(getRecordValue(payload, ['message', 'details']));
  if (message) {
    next.message = message;
  }

  if (hasRecordValue(payload, ['type'])) {
    next.type = toEnum(getRecordValue(payload, ['type']), ALERT_TYPES, next.type);
  }

  if (hasRecordValue(payload, ['priority'])) {
    next.priority = toEnum(getRecordValue(payload, ['priority']), ALERT_PRIORITIES, next.priority);
  }

  if (hasRecordValue(payload, ['status'])) {
    next.status = toEnum(getRecordValue(payload, ['status']), ALERT_STATUSES, next.status);
  }

  const relatedEntityId = toStringValue(getRecordValue(payload, ['relatedEntityId', 'relatedId']));
  if (relatedEntityId) {
    next.relatedEntityId = relatedEntityId;
  }

  return next;
}

function calculateFairnessScore(flag: PriceMonitoringFlag): number {
  switch (flag) {
    case 'high-risk':
      return 25;
    case 'overpriced':
      return 45;
    case 'fair':
      return 80;
    case 'cheap':
      return 90;
    case 'steal':
      return 97;
    case 'unknown':
    default:
      return 50;
  }
}

export function computeAnalyticsMetrics(collections: AdminCollections): AnalyticsMetrics {
  const totalUsers = collections.users.length;
  const activeSuppliers = collections.users.filter((row) => row.role === 'supplier' && row.status === 'active').length;
  const productsTracked = collections.products.length;
  const openAlerts = collections.alerts.filter((row) => row.status !== 'resolved').length;
  const highRiskCount = collections.priceMonitoring.filter((row) => row.flag === 'high-risk').length;
  const overpricedCount = collections.priceMonitoring.filter((row) => row.flag === 'overpriced').length;
  const underpricedCount = collections.priceMonitoring.filter((row) => row.flag === 'cheap' || row.flag === 'steal').length;
  const flaggedListings = highRiskCount + overpricedCount;

  const fairnessTotal = collections.priceMonitoring.reduce((sum, row) => sum + calculateFairnessScore(row.flag), 0);
  const averageFairness =
    collections.priceMonitoring.length === 0
      ? 0
      : roundPrice(fairnessTotal / collections.priceMonitoring.length);

  const estimatedSavings = roundPrice(
    collections.priceMonitoring.reduce((sum, row) => {
      if (row.expectedPrice === undefined) {
        return sum;
      }

      const diff = row.expectedPrice - row.observedPrice;
      return diff > 0 ? sum + diff : sum;
    }, 0)
  );

  return {
    totalUsers,
    activeSuppliers,
    productsTracked,
    openAlerts,
    averageFairness,
    flaggedListings,
    highRiskCount,
    underpricedCount,
    estimatedSavings
  };
}

function createGeneratedReport(
  payload: Record<string, unknown>,
  rows: ReportRecord[],
  collections: AdminCollections,
  nowIso: string
): ReportRecord {
  const period = toEnum(getRecordValue(payload, ['period']), REPORT_PERIODS, 'monthly');
  const metrics = computeAnalyticsMetrics(collections);
  const summary =
    toStringValue(getRecordValue(payload, ['summary'])) ??
    `${period.toUpperCase()} report: ${metrics.flaggedListings} flagged listings, ${metrics.highRiskCount} high-risk findings, ${metrics.openAlerts} open alerts.`;

  return {
    id: createId('RPT', rows),
    title: toStringValue(getRecordValue(payload, ['title'])) ?? `${period[0].toUpperCase()}${period.slice(1)} Price Report`,
    period,
    generatedAt: nowIso,
    metrics: {
      averageFairness: metrics.averageFairness,
      flaggedListings: metrics.flaggedListings,
      highRiskCount: metrics.highRiskCount,
      underpricedCount: metrics.underpricedCount,
      totalUsers: metrics.totalUsers,
      totalProducts: metrics.productsTracked,
      openAlerts: metrics.openAlerts,
      estimatedSavings: metrics.estimatedSavings
    },
    summary
  };
}

function updateReportRecord(current: ReportRecord, payload: Record<string, unknown>): ReportRecord {
  const next: ReportRecord = { ...current };

  const title = toStringValue(getRecordValue(payload, ['title']));
  if (title) {
    next.title = title;
  }

  const summary = toStringValue(getRecordValue(payload, ['summary']));
  if (summary) {
    next.summary = summary;
  }

  if (hasRecordValue(payload, ['period'])) {
    next.period = toEnum(getRecordValue(payload, ['period']), REPORT_PERIODS, next.period);
  }

  return next;
}

function maybeCreateOrUpdatePriceAlert(
  monitoring: PriceMonitoringRecord,
  alerts: AlertRecord[],
  nowIso: string
): AlertRecord | null {
  if (!isExpensiveFlag(monitoring.flag)) {
    return null;
  }

  const existingIndex = alerts.findIndex(
    (alert) => alert.type === 'price' && alert.relatedEntityId === monitoring.id && alert.status !== 'resolved'
  );

  const title = monitoring.flag === 'high-risk' ? 'High-risk price detected' : 'Overpriced item detected';
  const message =
    monitoring.expectedPrice === undefined
      ? `${monitoring.item} has no baseline for comparison.`
      : `${monitoring.item} observed at PHP ${monitoring.observedPrice.toFixed(2)} vs baseline PHP ${monitoring.expectedPrice.toFixed(2)}.`;

  if (existingIndex >= 0) {
    const existing = alerts[existingIndex];
    const updated: AlertRecord = {
      ...existing,
      title,
      message,
      priority: monitoring.flag === 'high-risk' ? 'high' : 'medium',
      updatedAt: nowIso
    };
    alerts[existingIndex] = updated;
    return updated;
  }

  const created: AlertRecord = {
    id: createId('ALT', alerts),
    title,
    message,
    type: 'price',
    priority: monitoring.flag === 'high-risk' ? 'high' : 'medium',
    status: 'open',
    relatedEntityId: monitoring.id,
    createdAt: nowIso,
    updatedAt: nowIso
  };
  alerts.unshift(created);
  return created;
}

function parseModuleFromTokens(tokens: string[]): { module: AdminModule | null; consumed: number } {
  if (tokens.length === 0) {
    return { module: null, consumed: 0 };
  }

  const first = normalizeModule(tokens[0]);
  if (first) {
    return { module: first, consumed: 1 };
  }

  const twoToken = normalizeModule(`${tokens[0]}-${tokens[1] ?? ''}`.replace(/-$/, ''));
  if (twoToken) {
    return { module: twoToken, consumed: 2 };
  }

  return { module: null, consumed: 0 };
}

export function parseAiCommandBody(value: unknown): AiDataCommand | null {
  const raw = toRecord(value);
  if (!raw) {
    return null;
  }

  const intent = normalizeIntent(getRecordValue(raw, ['intent', 'action', 'operation']));
  const module = normalizeModule(getRecordValue(raw, ['module', 'entity', 'collection', 'target']));
  if (!intent || !module) {
    return null;
  }

  const id = toStringValue(getRecordValue(raw, ['id', 'recordId']));
  const payload = toRecord(getRecordValue(raw, ['payload', 'data', 'record'])) ?? undefined;
  const filters = toRecord(getRecordValue(raw, ['filters', 'filter'])) ?? undefined;

  return {
    intent,
    module,
    id: id ?? undefined,
    payload,
    filters
  };
}

export function parseAiTextCommand(rawText: string): AiDataCommand | null {
  const text = rawText.trim();
  if (!text) {
    return null;
  }

  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      return parseAiCommandBody(JSON.parse(text));
    } catch {
      return null;
    }
  }

  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    return null;
  }

  const intent = normalizeIntent(tokens[0]);
  if (!intent) {
    return null;
  }

  const moduleMatch = parseModuleFromTokens(tokens.slice(1));
  if (!moduleMatch.module) {
    return null;
  }

  const remainderTokens = tokens.slice(1 + moduleMatch.consumed);
  const remainder = remainderTokens.join(' ').trim();
  const parsedPayload = parseAssignments(remainder);
  let id = toStringValue(parsedPayload.id);
  if (!id && (intent === 'update' || intent === 'delete') && remainderTokens.length > 0 && !remainder.includes('=')) {
    id = remainderTokens[0];
  }

  const idKey = findKey(parsedPayload, 'id');
  if (idKey) {
    delete parsedPayload[idKey];
  }

  return {
    intent,
    module: moduleMatch.module,
    id: id ?? undefined,
    payload: intent === 'fetch' ? undefined : parsedPayload,
    filters: intent === 'fetch' ? parsedPayload : undefined
  };
}

export function executeAiDataCommand(
  command: AiDataCommand,
  context: { collections: AdminCollections; baseline: BaselineMap; nowIso?: string }
): AiExecutionResult {
  const intent = normalizeIntent(command.intent);
  const module = normalizeModule(command.module);
  const collections = cloneCollections(context.collections);
  const baseline: BaselineMap = { ...context.baseline };
  const changedModules: AdminModule[] = [];
  let baselineChanged = false;
  const nowIso = context.nowIso ?? new Date().toISOString();
  const payload = toRecord(command.payload) ?? {};
  const filters = toRecord(command.filters) ?? undefined;

  const markChanged = (moduleName: AdminModule): void => {
    if (!changedModules.includes(moduleName)) {
      changedModules.push(moduleName);
    }
  };

  const response = (ok: boolean, message: string, result?: unknown): AiExecutionResult => ({
    ok,
    message,
    collections,
    baseline,
    changedModules,
    baselineChanged,
    result
  });

  if (!intent || !module) {
    return response(false, 'Invalid AI command: module or intent is missing.');
  }

  if (intent === 'fetch') {
    switch (module) {
      case 'users':
        return response(true, 'Users fetched.', applyFilters(collections.users, filters));
      case 'products':
        return response(true, 'Products fetched.', applyFilters(collections.products, filters));
      case 'priceMonitoring':
        return response(true, 'Price monitoring entries fetched.', applyFilters(collections.priceMonitoring, filters));
      case 'alerts':
        return response(true, 'Alerts fetched.', applyFilters(collections.alerts, filters));
      case 'reports':
        return response(true, 'Reports fetched.', applyFilters(collections.reports, filters));
      default:
        return response(false, 'Unsupported module for fetch.');
    }
  }

  if (module === 'users') {
    if (intent === 'create') {
      const created = createUserRecord(payload, collections.users, nowIso);
      if (!created) {
        return response(false, 'Unable to create user. Provide at least name and email.');
      }

      collections.users.unshift(created);
      markChanged('users');
      return response(true, 'User created through AI.', created);
    }

    if (intent === 'update') {
      if (!command.id) {
        return response(false, 'User update requires an id.');
      }

      const index = collections.users.findIndex((row) => row.id === command.id);
      if (index < 0) {
        return response(false, `User not found: ${command.id}`);
      }

      const updated = updateUserRecord(collections.users[index], payload, nowIso);
      collections.users[index] = updated;
      markChanged('users');
      return response(true, 'User updated through AI.', updated);
    }

    if (intent === 'delete') {
      if (!command.id) {
        return response(false, 'User delete requires an id.');
      }

      const index = collections.users.findIndex((row) => row.id === command.id);
      if (index < 0) {
        return response(false, `User not found: ${command.id}`);
      }

      const [removed] = collections.users.splice(index, 1);
      markChanged('users');
      return response(true, 'User deleted through AI.', removed);
    }

    return response(false, `Intent "${intent}" is not supported for users.`);
  }

  if (module === 'products') {
    if (intent === 'create') {
      const created = createProductRecord(payload, collections.products, nowIso);
      if (!created) {
        return response(false, 'Unable to create product. Provide name and positive basePrice.');
      }

      collections.products.unshift(created);
      markChanged('products');

      const syncBaseline = getRecordValue(payload, ['syncBaseline']) !== false;
      if (syncBaseline) {
        baseline[normalizeItemName(created.name)] = created.basePrice;
        baselineChanged = true;
      }

      return response(true, 'Product created through AI.', created);
    }

    if (intent === 'update') {
      if (!command.id) {
        return response(false, 'Product update requires an id.');
      }

      const index = collections.products.findIndex((row) => row.id === command.id);
      if (index < 0) {
        return response(false, `Product not found: ${command.id}`);
      }

      const updated = updateProductRecord(collections.products[index], payload, nowIso);
      collections.products[index] = updated;
      markChanged('products');

      const syncBaseline = getRecordValue(payload, ['syncBaseline']) !== false;
      if (syncBaseline) {
        baseline[normalizeItemName(updated.name)] = updated.basePrice;
        baselineChanged = true;
      }

      return response(true, 'Product updated through AI.', updated);
    }

    if (intent === 'delete') {
      if (!command.id) {
        return response(false, 'Product delete requires an id.');
      }

      const index = collections.products.findIndex((row) => row.id === command.id);
      if (index < 0) {
        return response(false, `Product not found: ${command.id}`);
      }

      const [removed] = collections.products.splice(index, 1);
      markChanged('products');
      return response(true, 'Product deleted through AI.', removed);
    }

    return response(false, `Intent "${intent}" is not supported for products.`);
  }

  if (module === 'priceMonitoring') {
    if (intent === 'create') {
      const created = createPriceMonitoringRecord(payload, collections.priceMonitoring, baseline, nowIso);
      if (!created) {
        return response(false, 'Unable to create monitoring row. Provide item and price.');
      }

      collections.priceMonitoring.unshift(created);
      markChanged('priceMonitoring');

      const autoAlert = maybeCreateOrUpdatePriceAlert(created, collections.alerts, nowIso);
      if (autoAlert) {
        markChanged('alerts');
      }

      return response(true, 'Price monitoring row created through AI.', created);
    }

    if (intent === 'update') {
      if (!command.id) {
        return response(false, 'Price monitoring update requires an id.');
      }

      const index = collections.priceMonitoring.findIndex((row) => row.id === command.id);
      if (index < 0) {
        return response(false, `Price monitoring row not found: ${command.id}`);
      }

      const updated = updatePriceMonitoringRecord(collections.priceMonitoring[index], payload, baseline);
      collections.priceMonitoring[index] = updated;
      markChanged('priceMonitoring');

      const autoAlert = maybeCreateOrUpdatePriceAlert(updated, collections.alerts, nowIso);
      if (autoAlert) {
        markChanged('alerts');
      }

      return response(true, 'Price monitoring row updated through AI.', updated);
    }

    if (intent === 'delete') {
      if (!command.id) {
        return response(false, 'Price monitoring delete requires an id.');
      }

      const index = collections.priceMonitoring.findIndex((row) => row.id === command.id);
      if (index < 0) {
        return response(false, `Price monitoring row not found: ${command.id}`);
      }

      const [removed] = collections.priceMonitoring.splice(index, 1);
      markChanged('priceMonitoring');
      return response(true, 'Price monitoring row deleted through AI.', removed);
    }

    return response(false, `Intent "${intent}" is not supported for price monitoring.`);
  }

  if (module === 'alerts') {
    if (intent === 'create') {
      const created = createAlertRecord(payload, collections.alerts, nowIso);
      if (!created) {
        return response(false, 'Unable to create alert. Provide title and message.');
      }

      collections.alerts.unshift(created);
      markChanged('alerts');
      return response(true, 'Alert created through AI.', created);
    }

    if (intent === 'update') {
      if (!command.id) {
        return response(false, 'Alert update requires an id.');
      }

      const index = collections.alerts.findIndex((row) => row.id === command.id);
      if (index < 0) {
        return response(false, `Alert not found: ${command.id}`);
      }

      const updated = updateAlertRecord(collections.alerts[index], payload, nowIso);
      collections.alerts[index] = updated;
      markChanged('alerts');
      return response(true, 'Alert updated through AI.', updated);
    }

    if (intent === 'delete') {
      if (!command.id) {
        return response(false, 'Alert delete requires an id.');
      }

      const index = collections.alerts.findIndex((row) => row.id === command.id);
      if (index < 0) {
        return response(false, `Alert not found: ${command.id}`);
      }

      const [removed] = collections.alerts.splice(index, 1);
      markChanged('alerts');
      return response(true, 'Alert deleted through AI.', removed);
    }

    return response(false, `Intent "${intent}" is not supported for alerts.`);
  }

  if (module === 'reports') {
    if (intent === 'create' || intent === 'generate') {
      const created = createGeneratedReport(payload, collections.reports, collections, nowIso);
      collections.reports.unshift(created);
      markChanged('reports');
      return response(true, 'Report generated through AI.', created);
    }

    if (intent === 'update') {
      if (!command.id) {
        return response(false, 'Report update requires an id.');
      }

      const index = collections.reports.findIndex((row) => row.id === command.id);
      if (index < 0) {
        return response(false, `Report not found: ${command.id}`);
      }

      const updated = updateReportRecord(collections.reports[index], payload);
      collections.reports[index] = updated;
      markChanged('reports');
      return response(true, 'Report updated through AI.', updated);
    }

    if (intent === 'delete') {
      if (!command.id) {
        return response(false, 'Report delete requires an id.');
      }

      const index = collections.reports.findIndex((row) => row.id === command.id);
      if (index < 0) {
        return response(false, `Report not found: ${command.id}`);
      }

      const [removed] = collections.reports.splice(index, 1);
      markChanged('reports');
      return response(true, 'Report deleted through AI.', removed);
    }

    return response(false, `Intent "${intent}" is not supported for reports.`);
  }

  return response(false, 'Unsupported AI command.');
}

export function buildAdminSnapshot(collections: AdminCollections): AdminSnapshot {
  const metrics = computeAnalyticsMetrics(collections);
  const activity: ActivityItem[] = [];

  for (const user of collections.users.slice(0, 5)) {
    activity.push({
      id: `user-${user.id}`,
      actor: user.name,
      action: 'User profile updated',
      status: user.status,
      timestamp: user.updatedAt
    });
  }

  for (const row of collections.priceMonitoring.slice(0, 5)) {
    activity.push({
      id: `price-${row.id}`,
      actor: 'AI Monitor',
      action: `Assessed ${row.item}`,
      status: row.flag,
      timestamp: row.recordedAt
    });
  }

  for (const alert of collections.alerts.slice(0, 5)) {
    activity.push({
      id: `alert-${alert.id}`,
      actor: 'Alert Engine',
      action: alert.title,
      status: alert.status,
      timestamp: alert.updatedAt
    });
  }

  for (const report of collections.reports.slice(0, 3)) {
    activity.push({
      id: `report-${report.id}`,
      actor: 'AI Reports',
      action: report.title,
      status: report.period,
      timestamp: report.generatedAt
    });
  }

  activity.sort((a, b) => {
    const aTime = Date.parse(a.timestamp);
    const bTime = Date.parse(b.timestamp);
    const safeA = Number.isNaN(aTime) ? 0 : aTime;
    const safeB = Number.isNaN(bTime) ? 0 : bTime;
    return safeB - safeA;
  });

  return {
    metrics,
    recentActivity: activity.slice(0, 10)
  };
}
