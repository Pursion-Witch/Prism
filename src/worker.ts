import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { closeDb, query } from './db';

const INTERVAL_MS = Number(process.env.ETL_INTERVAL_MS ?? 24 * 60 * 60 * 1000);

async function runBaselineSync(): Promise<void> {
  const baselinePath = path.join(__dirname, '..', 'data', 'baseline.json');
  const raw = await fs.readFile(baselinePath, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const entries = Object.entries(parsed)
    .map(([name, value]) => ({ name: name.trim(), price: Number(value) }))
    .filter((row) => row.name.length > 0 && Number.isFinite(row.price) && row.price >= 0);

  for (const entry of entries) {
    await query(
      `
        INSERT INTO products (name, category, region, srp_price)
        VALUES ($1, 'BASELINE', 'NATIONAL', $2)
      `,
      [entry.name, Number(entry.price.toFixed(2))]
    );
  }

  console.log(`ETL sync complete. Inserted ${entries.length} baseline rows at ${new Date().toISOString()}`);
}

async function startWorker(): Promise<void> {
  await runBaselineSync();

  setInterval(() => {
    runBaselineSync().catch((error) => {
      console.error('ETL sync failed:', error);
    });
  }, INTERVAL_MS);
}

startWorker().catch(async (error) => {
  console.error('Worker startup failed:', error);
  await closeDb();
  process.exit(1);
});
