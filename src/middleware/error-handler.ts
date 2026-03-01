import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app-error';

interface PgErrorLike {
  code?: string;
  detail?: string;
}

function isPgErrorLike(error: unknown): error is PgErrorLike {
  return typeof error === 'object' && error !== null && 'code' in error;
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      message: error.message,
      details: error.details
    });
    return;
  }

  if (isPgErrorLike(error)) {
    if (error.code === '23503') {
      res.status(400).json({ message: 'Foreign key constraint failed.', detail: error.detail });
      return;
    }
    if (error.code === '23505') {
      res.status(409).json({ message: 'Duplicate key violation.', detail: error.detail });
      return;
    }
    if (error.code === '22P02') {
      res.status(400).json({ message: 'Invalid identifier format.', detail: error.detail });
      return;
    }
  }

  console.error('Unhandled error:', error);
  res.status(500).json({ message: 'Internal server error.' });
}
