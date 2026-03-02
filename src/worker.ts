import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { closeDb, withDbClient } from './db';
import { upsertCatalogProduct } from './services/productCatalogService';

const INTERVAL_MS = Number(process.env.ETL_INTERVAL_MS ?? 24 * 60 * 60 * 1000);

async function runBaselineSync(): Promise<void> {
  const baselinePath = path.join(__dirname, '..', 'data', 'baseline.json');
  const raw = await fs.readFile(baselinePath, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const entries = Object.entries(parsed)
    .map(([name, value]) => ({ name: name.trim(), price: Number(value) }))
    .filter((row) => row.name.length > 0 && Number.isFinite(row.price) && row.price >= 0);

  await withDbClient(async (client) => {
    await client.query('BEGIN');

    try {
      for (const entry of entries) {
        await upsertCatalogProduct(
          client,
          {
            name: entry.name,
            category: 'BASELINE',
            region: 'NATIONAL',
            marketName: 'Baseline Feed',
            stallName: 'Stall B-00',
            srpPrice: Number(entry.price.toFixed(2))
          },
          { updateExisting: true }
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

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
