import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

let pool: Pool | null = null;

function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured.');
  }

  return databaseUrl;
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getDatabaseUrl()
    });
  }

  return pool;
}

export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  const clientPool = getPool();
  return clientPool.query<T>(text, params);
}

export async function withDbClient<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();

  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export async function closeDb(): Promise<void> {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = null;
}
