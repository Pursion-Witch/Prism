import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  assessPrice,
  buildAdminSnapshot,
  executeAiDataCommand,
  ingestDocumentToBaseline,
  isExpensiveFlag,
  normalizeItemName,
  parseAiCommandBody,
  parseAiTextCommand,
  readBaselineFile,
  writeBaselineFile,
  type AdminCollections,
  type AdminModule,
  type AiDataCommand,
  type BaselineMap,
  type PriceFlag
} from './ai';

type ApiFlag = PriceFlag | 'unknown' | 'invalid';

interface RecommendationRow {
  item: string;
  price: number;
  flag: ApiFlag;
  message: string;
  expectedPrice?: number;
}

const app = express();
const port = Number(process.env.PORT ?? 3000);

const rootDir = path.join(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const dataDir = path.join(rootDir, 'data');
const baselinePath = path.join(dataDir, 'baseline.json');

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

function ensureDataFiles(): void {
  ensureDirectory(dataDir);

  if (!fs.existsSync(baselinePath)) {
    writeBaselineFile(baselinePath, defaultBaseline);
  }

  for (const moduleName of Object.keys(moduleFileMap) as AdminModule[]) {
    const filePath = moduleFileMap[moduleName];
    if (!fs.existsSync(filePath)) {
      writeJsonFile(filePath, defaultCollections[moduleName]);
    }
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

ensureDataFiles();

const pageRoutes = collectHtmlPages(publicDir).map(toRoutePath);
const pageRedirects = buildPageRedirects(pageRoutes);

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

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
