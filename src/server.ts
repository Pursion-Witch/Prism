import express from 'express';
import fs from 'fs';
import path from 'path';

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

function readBaseline(): Record<string, number> {
  try {
    const raw = fs.readFileSync(baselinePath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    return Object.entries(parsed).reduce<Record<string, number>>((acc, [key, value]) => {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        acc[key.toLowerCase()] = value;
      }
      return acc;
    }, {});
  } catch (_error) {
    return {};
  }
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

  const ratio = price / expectedPrice;
// gian pa check kos ratio pricing diay ani later
  if (ratio > 1.3) {
    return res.json({
      flag: 'high-risk of corruption',
      message: `This looks high-risk. Expected around ₱${expectedPrice.toFixed(2)}, but got ₱${price.toFixed(2)}.`
    });
  }
// if tyako raba nang .1/.3 kay i feel like in the hundredths place dapat ang ratio
  if (ratio > 1.1) {
    return res.json({
      flag: 'overpriced',
      message: `This looks slightly overpriced. Expected around ₱${expectedPrice.toFixed(2)}, but got ₱${price.toFixed(2)}.`
    });
  }

    if (ratio > 0.9) {
    return res.json({
      flag: 'cheap',
      message: `This looks slightly underpriced than normal. Expected around ₱${expectedPrice.toFixed(2)}, but got ₱${price.toFixed(2)}.`
    });
  }

      if (ratio > 0.8) {
    return res.json({
      flag: 'steal',
      message: `This looks like a steal. Expected around ₱${expectedPrice.toFixed(2)}, but got ₱${price.toFixed(2)}.`
    });
  }

  return res.json({
    flag: 'fair',
    message: `This price looks fair. Market average is around ₱${expectedPrice.toFixed(2)}.`
  });
});

app.get('*', (_req, res) => {
  res.status(404).send('Page not found.');
});

app.listen(port, () => {
  console.log(`PRISM server running on http://localhost:${port}`);
});