import { randomUUID } from 'node:crypto';
import { query } from '../index';
import type { InsertMetricInput, LiveMetricRow } from '../types';

export async function insertMetric(input: InsertMetricInput): Promise<LiveMetricRow> {
  const id = input.id ?? randomUUID();
  const recordedAt = input.recordedAt ?? new Date();
  const createdAt = input.createdAt ?? new Date();

  const result = await query<LiveMetricRow>(
    `
      INSERT INTO live_metrics (id, metric, value, recorded_at, created_at)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, metric, value, recorded_at, created_at
    `,
    [id, input.metric, input.value, recordedAt, createdAt]
  );

  return result.rows[0];
}
