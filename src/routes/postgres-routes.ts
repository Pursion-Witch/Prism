import { Router } from 'express';
import { getAlertsHandler } from '../controllers/alerts-controller';
import { createMetricHandler } from '../controllers/metrics-controller';
import { createProductHandler } from '../controllers/products-controller';
import { getUserByIdHandler } from '../controllers/users-controller';
import { asyncHandler } from '../middleware/async-handler';

export const postgresRouter = Router();

postgresRouter.get('/users/:id', asyncHandler(getUserByIdHandler));
postgresRouter.post('/products', asyncHandler(createProductHandler));
postgresRouter.get('/alerts', asyncHandler(getAlertsHandler));
postgresRouter.post('/metrics', asyncHandler(createMetricHandler));
