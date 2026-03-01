import { AppError } from '../errors/app-error';

export function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError(400, `"${field}" must be a non-empty string.`);
  }
  return value.trim();
}

export function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AppError(400, `"${field}" must be a finite number.`);
  }
  return value;
}

export function parseOptionalPositiveInt(value: unknown, field: string, defaultValue: number): number {
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(400, `"${field}" must be a positive integer.`);
  }
  return parsed;
}

export function parseOptionalIsoDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new AppError(400, '"timestamp" must be a valid ISO date string.');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, '"timestamp" must be a valid ISO date string.');
  }
  return parsed;
}
