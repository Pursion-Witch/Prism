import { randomUUID } from 'node:crypto';
import { query } from '../index';
import type { AlertRow, CreateAlertInput } from '../types';

interface ListAlertsOptions {
  userId?: string;
  limit?: number;
}

export async function listAlerts(options: ListAlertsOptions = {}): Promise<AlertRow[]> {
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(200, Number(options.limit))) : 100;

  if (options.userId) {
    const result = await query<AlertRow>(
      `
        SELECT id, user_id, type, message, occurred_at, created_at
        FROM alerts
        WHERE user_id = $1
        ORDER BY occurred_at DESC
        LIMIT $2
      `,
      [options.userId, limit]
    );

    return result.rows;
  }

  const result = await query<AlertRow>(
    `
      SELECT id, user_id, type, message, occurred_at, created_at
      FROM alerts
      ORDER BY occurred_at DESC
      LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}

export async function createAlert(input: CreateAlertInput): Promise<AlertRow> {
  const id = input.id ?? randomUUID();
  const occurredAt = input.occurredAt ?? new Date();
  const createdAt = input.createdAt ?? new Date();

  const result = await query<AlertRow>(
    `
      INSERT INTO alerts (id, user_id, type, message, occurred_at, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, user_id, type, message, occurred_at, created_at
    `,
    [id, input.userId, input.type, input.message, occurredAt, createdAt]
  );

  return result.rows[0];
}
