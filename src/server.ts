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

const rootDir = path.join(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const baselinePath = path.join(rootDir, 'data', 'baseline.json');

const pageRoutes: Record<string, string> = {
  '/': 'index.html',
  '/home': 'index.html',
  '/index.html': 'index.html',
  '/product-scanner': 'product-scanner.html',
  '/product-scanner.html': 'product-scanner.html',
  '/dashboard': 'dashboard.html',
  '/dashboard.html': 'dashboard.html',
  '/marketplace': 'marketplace.html',
  '/marketplace.html': 'marketplace.html',
  '/admin-panel': 'admin-panel.html',
  '/admin-panel.html': 'admin-panel.html'
};

app.disable('x-powered-by');
app.use(express.json({ limit: '512kb' }));
app.use(express.static(publicDir));

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

for (const [route, fileName] of Object.entries(pageRoutes)) {
  app.get(route, (_req, res) => {
    res.sendFile(path.join(publicDir, fileName));
  });
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
