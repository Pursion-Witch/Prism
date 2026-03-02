import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import {
  assessPrice,
  ingestDocumentToBaseline,
  isExpensiveFlag,
  normalizeItemName,
  readBaselineFile,
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
const hasExplicitPort = process.env.PORT !== undefined;

const rootDir = path.join(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const webDir = path.join(rootDir, 'WEB');
const baselinePath = path.join(rootDir, 'data', 'baseline.json');
const homePage = path.join(webDir, 'home-page', 'home-page.html');
const productScannerPage = path.join(webDir, 'product-scanner', 'product.scanner.html');
const dashboardPage = path.join(webDir, 'dashboard', 'dashboard.html');
const marketplacePage = path.join(webDir, 'marketplace', 'marketplace.html');
const adminPanelPage = path.join(webDir, 'admin-panel', 'admin-panel.html');
const termsPage = path.join(webDir, 'terms', 'terms.html');
const privacyPage = path.join(webDir, 'privacy', 'privacy.html');
const faqsPage = path.join(webDir, 'faqs', 'faqs.html');
const aboutPage = path.join(webDir, 'about', 'about.html');
const loginPage = path.join(webDir, 'login', 'login.html');
const createAccountPage = path.join(webDir, 'create-account', 'create-account.html');

const pageRouteMap: Array<{ routes: string[]; filePath: string }> = [
  {
    routes: [
      '/',
      '/web',
      '/web/',
      '/home',
      '/index.html',
      '/home-page',
      '/home-page.html',
      '/home-page/home-page.html',
      '/web/home-page',
      '/web/home-page/',
      '/web/home-page/home-page.html'
    ],
    filePath: homePage
  },
  {
    routes: [
      '/product-scanner',
      '/product-scanner.html',
      '/product-scanner/product.scanner.html',
      '/web/product-scanner',
      '/web/product-scanner/',
      '/web/product-scanner/product.scanner.html'
    ],
    filePath: productScannerPage
  },
  {
    routes: ['/dashboard', '/dashboard.html', '/dashboard/dashboard.html', '/web/dashboard', '/web/dashboard/', '/web/dashboard/dashboard.html'],
    filePath: dashboardPage
  },
  {
    routes: [
      '/marketplace',
      '/marketplace.html',
      '/marketplace/marketplace.html',
      '/web/marketplace',
      '/web/marketplace/',
      '/web/marketplace/marketplace.html'
    ],
    filePath: marketplacePage
  },
  {
    routes: ['/admin-panel', '/admin-panel.html', '/admin-panel/admin-panel.html', '/web/admin-panel', '/web/admin-panel/', '/web/admin-panel/admin-panel.html'],
    filePath: adminPanelPage
  },
  { routes: ['/terms/terms.html', '/web/terms/terms.html'], filePath: termsPage },
  { routes: ['/privacy/privacy.html', '/web/privacy/privacy.html'], filePath: privacyPage },
  { routes: ['/faqs/faqs.html', '/web/faqs/faqs.html'], filePath: faqsPage },
  { routes: ['/about/about.html', '/web/about/about.html'], filePath: aboutPage },
  { routes: ['/login/login.html', '/web/login/login.html'], filePath: loginPage },
  { routes: ['/create-account/create-account.html', '/web/create-account/create-account.html'], filePath: createAccountPage }
];

app.disable('x-powered-by');
app.use(express.json({ limit: '512kb' }));
app.use('/web', express.static(webDir));
app.use('/images', express.static(path.join(publicDir, 'images')));
app.use('/fonts', express.static(path.join(publicDir, 'fonts')));
app.use('/web/images', express.static(path.join(publicDir, 'images')));
app.use('/web/fonts', express.static(path.join(publicDir, 'fonts')));

function readBaseline(): BaselineMap {
  return readBaselineFile(baselinePath);
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

for (const { routes, filePath } of pageRouteMap) {
  for (const route of routes) {
    app.get(route, (_req, res) => {
      res.sendFile(filePath);
    });
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
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

  if (path.extname(req.path)) {
    return res.status(404).send('Page not found.');
  }

  return res.sendFile(homePage);
});

app.use((_error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  return res.status(500).json({
    message: 'Internal server error.'
  });
});

function startServer(preferredPort: number, retriesLeft = 10): void {
  const server = app.listen(preferredPort, () => {
    console.log(`PRISM server running on http://localhost:${preferredPort}`);
  });

  server.once('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE' && retriesLeft > 0 && !hasExplicitPort) {
      const nextPort = preferredPort + 1;
      console.warn(`Port ${preferredPort} is in use. Retrying on port ${nextPort}...`);
      startServer(nextPort, retriesLeft - 1);
      return;
    }

    if (error.code === 'EADDRINUSE') {
      console.error(
        `Port ${preferredPort} is already in use. Set a different PORT (for example, PORT=${
          preferredPort + 1
        }).`
      );
    } else {
      console.error('Failed to start server:', error);
    }

    process.exit(1);
  });
}

startServer(port);
