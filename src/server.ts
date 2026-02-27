import express from 'express';
import path from 'path';
import {
  assessPrice,
  ingestDocumentToBaseline,
  readBaselineFile,
  type BaselineMap
} from './ai';

const app = express();
const port = Number(process.env.PORT ?? 3000);

const rootDir = path.join(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const baselinePath = path.join(rootDir, 'data', 'baseline.json');

app.use(express.json());
app.use(express.static(publicDir));

const pageRoutes: Record<string, string> = {
  '/': 'index.html',
  '/home': 'index.html',
  '/product-scanner': 'product-scanner.html',
  '/dashboard': 'dashboard.html',
  '/marketplace': 'marketplace.html',
  '/admin-panel': 'admin-panel.html'
};

function readBaseline(): BaselineMap {
  return readBaselineFile(baselinePath);
}

for (const [route, fileName] of Object.entries(pageRoutes)) {
  app.get(route, (_req, res) => {
    res.sendFile(path.join(publicDir, fileName));
  });
}

app.post('/api/assess', (req, res) => {
  const item = String(req.body?.item ?? '').trim().toLowerCase();
  const price = Number(req.body?.price);

  if (!item || !Number.isFinite(price) || price <= 0) {
    return res.status(400).json({
      flag: 'invalid',
      message: 'Please provide a valid item and price.'
    });
  }

  const baseline = readBaseline();
  const expectedPrice = baseline[item];

  if (!expectedPrice) {
    return res.json({
      flag: 'unknown',
      message: `No baseline available for "${item}" yet.`
    });
  }

  return res.json(assessPrice(item, price, expectedPrice));
});

app.post('/api/ingest-document', (req, res) => {
  const documentText = String(req.body?.document ?? '').trim();

  if (!documentText) {
    return res.status(400).json({
      message: 'Please provide document text in the "document" field.'
    });
  }

  const baselineBefore = readBaseline();
  const ingestResult = ingestDocumentToBaseline(documentText, baselinePath);

  const expensiveFindings = Object.entries(ingestResult.extracted)
    .map(([item, observedPrice]) => {
      const expected = baselineBefore[item];
      if (!expected) {
        return null;
      }

      const result = assessPrice(item, observedPrice, expected);
      if (result.flag === 'overpriced' || result.flag === 'high-risk of corruption') {
        return {
          item,
          observedPrice,
          expectedPrice: expected,
          flag: result.flag,
          message: result.message
        };
      }

      return null;
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);

  return res.json({
    message: 'Doc has been merged cuh (check baseline)',
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

  const recommendations = entries
    .map((entry) => {
      const item = String(entry?.item ?? '').trim().toLowerCase();
      const price = Number(entry?.price);

      if (!item || !Number.isFinite(price) || price <= 0) {
        return null;
      }

      const expectedPrice = baseline[item];
      if (!expectedPrice) {
        return {
          item,
          price,
          flag: 'unknown',
          message: `No wawart available for "${item}" yet.`
        };
      }

      const assessment = assessPrice(item, price, expectedPrice);
      return {
        item,
        price,
        expectedPrice,
        ...assessment
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);

  const expensiveOnly = recommendations.filter(
    (row) => row.flag === 'overpriced' || row.flag === 'hell naw bruh, high risk of price manip'
  );

  return res.json({
    recommendations,
    expensive: expensiveOnly
  });
});

app.get('*', (_req, res) => {
  res.status(404).send('Page not found.');
});

app.listen(port, () => {
  console.log(`PRISM server running on http://localhost:${port}`);
});
