import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';

interface JsonUser {
  id: string;
  email: string;
  name: string;
  created_at?: string;
}

interface JsonProduct {
  id: string;
  name: string;
  price: number;
  seller_id: string;
  created_at?: string;
}

interface JsonAlert {
  id: string;
  user_id: string;
  type: string;
  message: string;
  timestamp?: string;
  created_at?: string;
}

interface JsonLiveMetric {
  id: string;
  metric: string;
  value: number;
  timestamp?: string;
  created_at?: string;
}

function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid "${field}": expected non-empty string.`);
  }
  return value.trim();
}

function parseDateLike(value: unknown, fallback: Date): Date {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallback;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return parsed;
}

function parseFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid "${field}": expected finite number.`);
  }
  return value;
}

function toUser(row: unknown): JsonUser {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('Invalid user row: expected object.');
  }

  const record = row as Record<string, unknown>;
  return {
    id: assertNonEmptyString(record.id, 'users.id'),
    email: assertNonEmptyString(record.email, 'users.email').toLowerCase(),
    name: assertNonEmptyString(record.name, 'users.name'),
    created_at: typeof record.created_at === 'string' ? record.created_at : undefined
  };
}

function toProduct(row: unknown): JsonProduct {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('Invalid product row: expected object.');
  }

  const record = row as Record<string, unknown>;
  return {
    id: assertNonEmptyString(record.id, 'products.id'),
    name: assertNonEmptyString(record.name, 'products.name'),
    price: parseFiniteNumber(record.price, 'products.price'),
    seller_id: assertNonEmptyString(record.seller_id, 'products.seller_id'),
    created_at: typeof record.created_at === 'string' ? record.created_at : undefined
  };
}

function toAlert(row: unknown): JsonAlert {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('Invalid alert row: expected object.');
  }

  const record = row as Record<string, unknown>;
  return {
    id: assertNonEmptyString(record.id, 'alerts.id'),
    user_id: assertNonEmptyString(record.user_id, 'alerts.user_id'),
    type: assertNonEmptyString(record.type, 'alerts.type'),
    message: assertNonEmptyString(record.message, 'alerts.message'),
    timestamp: typeof record.timestamp === 'string' ? record.timestamp : undefined,
    created_at: typeof record.created_at === 'string' ? record.created_at : undefined
  };
}

function toLiveMetric(row: unknown): JsonLiveMetric {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('Invalid live metric row: expected object.');
  }

  const record = row as Record<string, unknown>;
  return {
    id: assertNonEmptyString(record.id, 'live_metrics.id'),
    metric: assertNonEmptyString(record.metric, 'live_metrics.metric'),
    value: parseFiniteNumber(record.value, 'live_metrics.value'),
    timestamp: typeof record.timestamp === 'string' ? record.timestamp : undefined,
    created_at: typeof record.created_at === 'string' ? record.created_at : undefined
  };
}

async function findInputFile(sourceDir: string, fallbackDir: string, fileName: string): Promise<string> {
  const preferred = path.join(sourceDir, fileName);
  try {
    await fs.access(preferred);
    return preferred;
  } catch {
    const fallback = path.join(fallbackDir, fileName);
    await fs.access(fallback);
    return fallback;
  }
}

async function readJsonArray<T>(filePath: string, parser: (row: unknown) => T): Promise<T[]> {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`File "${filePath}" must contain a JSON array.`);
  }
  return parsed.map(parser);
}

function dedupeById<T extends { id: string }>(rows: T[], label: string): T[] {
  const map = new Map<string, T>();
  for (const row of rows) {
    if (map.has(row.id)) {
      console.warn(`[warn] ${label}: duplicate id "${row.id}" found. Keeping last occurrence.`);
    }
    map.set(row.id, row);
  }
  return [...map.values()];
}

async function migrate(): Promise<void> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error('DATABASE_URL is required.');
  }

  const sourceDir = process.env.JSON_SOURCE_DIR?.trim() || path.join(process.cwd(), 'data', 'streams');
  const fallbackDir = path.join(process.cwd(), 'data');

  const usersPath = await findInputFile(sourceDir, fallbackDir, 'users.json');
  const productsPath = await findInputFile(sourceDir, fallbackDir, 'products.json');
  const alertsPath = await findInputFile(sourceDir, fallbackDir, 'alerts.json');
  const metricsPath = await findInputFile(sourceDir, fallbackDir, 'live-metrics.json');

  console.log(`[migrate] source users: ${usersPath}`);
  console.log(`[migrate] source products: ${productsPath}`);
  console.log(`[migrate] source alerts: ${alertsPath}`);
  console.log(`[migrate] source live metrics: ${metricsPath}`);

  const [usersRaw, productsRaw, alertsRaw, metricsRaw] = await Promise.all([
    readJsonArray(usersPath, toUser),
    readJsonArray(productsPath, toProduct),
    readJsonArray(alertsPath, toAlert),
    readJsonArray(metricsPath, toLiveMetric)
  ]);

  const users = dedupeById(usersRaw, 'users');
  const products = dedupeById(productsRaw, 'products');
  const alerts = dedupeById(alertsRaw, 'alerts');
  const metrics = dedupeById(metricsRaw, 'live_metrics');

  const usersById = new Set(users.map((row) => row.id));
  const filteredProducts = products.filter((row) => usersById.has(row.seller_id));
  const filteredAlerts = alerts.filter((row) => usersById.has(row.user_id));

  if (filteredProducts.length !== products.length) {
    console.warn(
      `[warn] Skipping ${products.length - filteredProducts.length} product rows due to missing seller_id references.`
    );
  }
  if (filteredAlerts.length !== alerts.length) {
    console.warn(`[warn] Skipping ${alerts.length - filteredAlerts.length} alert rows due to missing user_id references.`);
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    console.log('[migrate] transaction started');

    for (const row of users) {
      const createdAt = parseDateLike(row.created_at, new Date());
      await client.query(
        `
          INSERT INTO users (id, email, name, created_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id)
          DO UPDATE SET
            email = EXCLUDED.email,
            name = EXCLUDED.name,
            created_at = EXCLUDED.created_at
        `,
        [row.id, row.email, row.name, createdAt]
      );
    }
    console.log(`[migrate] upserted users: ${users.length}`);

    for (const row of filteredProducts) {
      const createdAt = parseDateLike(row.created_at, new Date());
      await client.query(
        `
          INSERT INTO products (id, name, price, seller_id, created_at)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id)
          DO UPDATE SET
            name = EXCLUDED.name,
            price = EXCLUDED.price,
            seller_id = EXCLUDED.seller_id,
            created_at = EXCLUDED.created_at
        `,
        [row.id, row.name, row.price, row.seller_id, createdAt]
      );
    }
    console.log(`[migrate] upserted products: ${filteredProducts.length}`);

    for (const row of filteredAlerts) {
      const occurredAt = parseDateLike(row.timestamp, new Date());
      const createdAt = parseDateLike(row.created_at, occurredAt);
      await client.query(
        `
          INSERT INTO alerts (id, user_id, type, message, occurred_at, created_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (id)
          DO UPDATE SET
            user_id = EXCLUDED.user_id,
            type = EXCLUDED.type,
            message = EXCLUDED.message,
            occurred_at = EXCLUDED.occurred_at,
            created_at = EXCLUDED.created_at
        `,
        [row.id, row.user_id, row.type, row.message, occurredAt, createdAt]
      );
    }
    console.log(`[migrate] upserted alerts: ${filteredAlerts.length}`);

    for (const row of metrics) {
      const recordedAt = parseDateLike(row.timestamp, new Date());
      const createdAt = parseDateLike(row.created_at, recordedAt);
      await client.query(
        `
          INSERT INTO live_metrics (id, metric, value, recorded_at, created_at)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id)
          DO UPDATE SET
            metric = EXCLUDED.metric,
            value = EXCLUDED.value,
            recorded_at = EXCLUDED.recorded_at,
            created_at = EXCLUDED.created_at
        `,
        [row.id, row.metric, row.value, recordedAt, createdAt]
      );
    }
    console.log(`[migrate] upserted live metrics: ${metrics.length}`);

    await client.query('COMMIT');
    console.log('[migrate] transaction committed');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[migrate] transaction rolled back');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate()
  .then(() => {
    console.log('[migrate] completed successfully');
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[migrate] failed: ${message}`);
    process.exitCode = 1;
  });
