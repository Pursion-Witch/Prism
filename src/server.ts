import 'dotenv/config';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import adminRoutes from './routes/admin';
import analyzeRoutes from './routes/analyze';
import imageAnalyzeRoute from './routes/imageAnalyze';
import documentRoutes from './routes/documents';

const app = express();
const port = Number(process.env.PORT ?? 3000);
const hasExplicitPort = process.env.PORT !== undefined;

const rootDir = path.join(__dirname, '..');
const publicDir = path.join(rootDir, 'public');

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(publicDir));

app.use('/api/analyze', analyzeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', imageAnalyzeRoute);
app.use('/api/documents', documentRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ message: 'Endpoint not found.' });
  }

  return res.status(404).send('Page not found.');
});

function isAggregateErrorLike(error: unknown): error is { name?: string; errors?: unknown[] } {
  return Boolean(
    error &&
      typeof error === 'object' &&
      (((error as { name?: unknown }).name === 'AggregateError') ||
        Array.isArray((error as { errors?: unknown[] }).errors))
  );
}

function deriveErrorMessage(error: unknown): string {
  if (isAggregateErrorLike(error)) {
    const nestedErrors = error.errors ?? [];
    const nestedText = nestedErrors
      .map((nestedError) => {
        if (nestedError instanceof Error) {
          const errorCode =
            typeof (nestedError as { code?: unknown }).code === 'string'
              ? ((nestedError as unknown as { code: string }).code ?? 'ERROR')
              : 'ERROR';
          return `${errorCode}: ${nestedError.message}`;
        }

        return String(nestedError);
      })
      .join(' | ');

    if (/ECONNREFUSED|connect ECONNREFUSED|5432|postgres|database/i.test(nestedText)) {
      return 'Database connection failed. Start PostgreSQL and verify DATABASE_URL.';
    }

    return nestedText || 'Internal server error.';
  }

  if (error && typeof error === 'object') {
    const maybeCode = (error as { code?: unknown }).code;
    if (typeof maybeCode === 'string' && maybeCode.toUpperCase() === 'ECONNREFUSED') {
      return 'Database connection failed. Start PostgreSQL and verify DATABASE_URL.';
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Internal server error.';
}

function deriveStatusCode(message: string): number {
  if (/required|invalid|positive|non-negative|provide|must/i.test(message)) {
    return 400;
  }

  if (/database connection failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|timeout/i.test(message)) {
    return 503;
  }

  return 500;
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = deriveErrorMessage(error);
  const status = deriveStatusCode(message);

  if (status >= 500) {
    console.error(error);
  }

  return res.status(status).json({ message });
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
