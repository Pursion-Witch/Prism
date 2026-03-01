import type { Request, Response } from 'express';
import { listAlerts } from '../db/queries/alerts';
import { parseOptionalPositiveInt, requireNonEmptyString } from '../utils/validation';

export async function getAlertsHandler(req: Request, res: Response): Promise<void> {
  const userIdParam = req.query.user_id;
  const userId =
    userIdParam === undefined ? undefined : requireNonEmptyString(userIdParam, 'user_id');
  const limit = parseOptionalPositiveInt(req.query.limit, 'limit', 100);

  const alerts = await listAlerts({
    userId,
    limit
  });

  res.status(200).json({
    count: alerts.length,
    records: alerts.map((alert) => ({
      id: alert.id,
      user_id: alert.user_id,
      type: alert.type,
      message: alert.message,
      timestamp: alert.occurred_at.toISOString(),
      created_at: alert.created_at.toISOString()
    }))
  });
}
