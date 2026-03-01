import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import { closePool } from './db';
import { errorHandler } from './middleware/error-handler';
import { PgNotifyListener } from './realtime/pg-listener';
import { initializeSocketServer } from './realtime/socket';
import { postgresRouter } from './routes/postgres-routes';

const port = Number(process.env.PORT ?? 3001);
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required.');
}

const app = express();
app.use(express.json({ limit: process.env.MAX_BODY_LIMIT ?? '1mb' }));

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.use('/api', postgresRouter);
app.use(errorHandler);

const httpServer = http.createServer(app);
const io = initializeSocketServer(httpServer);
const pgListener = new PgNotifyListener(io, databaseUrl);

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  console.log(`[server] received ${signal}, shutting down`);

  await pgListener.stop();
  await closePool();

  await new Promise<void>((resolve, reject) => {
    httpServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

process.on('SIGINT', () => {
  void shutdown('SIGINT').finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM').finally(() => process.exit(0));
});

httpServer.listen(port, async () => {
  console.log(`Postgres API server listening on http://localhost:${port}`);

  try {
    await pgListener.start();
  } catch (error) {
    console.error('[server] failed to start PostgreSQL listener:', error);
  }
});
