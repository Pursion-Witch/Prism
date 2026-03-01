import type { Request, Response } from 'express';
import { insertMetric } from '../db/queries/metrics';
import { parseOptionalIsoDate, requireFiniteNumber, requireNonEmptyString } from '../utils/validation';

export async function createMetricHandler(req: Request, res: Response): Promise<void> {
  const payload = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;

  const metric = requireNonEmptyString(payload.metric, 'metric');
  const value = requireFiniteNumber(payload.value, 'value');
  const timestamp = parseOptionalIsoDate(payload.timestamp);

  const row = await insertMetric({
    metric,
    value,
    recordedAt: timestamp
  });

  res.status(201).json({
    id: row.id,
    metric: row.metric,
    value: row.value,
    timestamp: row.recorded_at.toISOString(),
    created_at: row.created_at.toISOString()
  });
}
