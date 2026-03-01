import 'dotenv/config';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

const connectionString = process.env.DATABASE_URL?.trim();

if (!connectionString) {
  throw new Error('DATABASE_URL is required.');
}

const max = Number(process.env.PG_POOL_MAX ?? 20);
const idleTimeoutMillis = Number(process.env.PG_POOL_IDLE_TIMEOUT_MS ?? 30_000);
const connectionTimeoutMillis = Number(process.env.PG_POOL_CONNECTION_TIMEOUT_MS ?? 5_000);

export const pool = new Pool({
  connectionString,
  max: Number.isFinite(max) ? max : 20,
  idleTimeoutMillis: Number.isFinite(idleTimeoutMillis) ? idleTimeoutMillis : 30_000,
  connectionTimeoutMillis: Number.isFinite(connectionTimeoutMillis) ? connectionTimeoutMillis : 5_000
});

pool.on('error', (error: Error) => {
  console.error('Unexpected PostgreSQL pool error:', error.message);
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = []
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as unknown[]);
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
