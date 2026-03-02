import type { Request, Response } from 'express';
import {
  getHistoricalAveragePrice,
  listAnalysisHistory,
  listMarketIndex,
  recordPriceAnalysis
} from '../db/queries/price-intelligence';
import { AppError } from '../errors/app-error';
import { analyzeProductPrice, parseRawProductText } from '../services/price-intelligence-service';
import type { AnalyzeProductPriceRequest, AnalyzeRawProductTextRequest } from '../types';
import { parseOptionalPositiveInt, requireFiniteNumber, requireNonEmptyString } from '../utils/validation';

function parseOptionalText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

export async function analyzeProductPriceHandler(req: Request, res: Response): Promise<void> {
  const payload = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Partial<AnalyzeProductPriceRequest>;

  const name = requireNonEmptyString(payload.name, 'name');
  const price = requireFiniteNumber(payload.price, 'price');
  if (price <= 0) {
    throw new AppError(400, '"price" must be greater than 0.');
  }

  const region = parseOptionalText(payload.region, 'National');
  const category = parseOptionalText(payload.category, 'Essentials');
  const rawText = typeof payload.rawText === 'string' ? payload.rawText.trim() : undefined;
  const historicalAverage = await getHistoricalAveragePrice(name);

  const aiResult = await analyzeProductPrice({
    name,
    price,
    region,
    category,
    rawText,
    historicalAverage
  });

  const persisted = await recordPriceAnalysis({
    name: aiResult.productName,
    category: aiResult.category,
    fairValue: aiResult.fairValue,
    price: aiResult.observedPrice,
    region: aiResult.region,
    anomalyScore: aiResult.anomalyScore,
    source: aiResult.source,
    rawText
  });

  res.status(200).json({
    ...aiResult,
    productId: persisted.product.id,
    transactionId: persisted.transaction.id
  });
}

export async function analyzeRawProductTextHandler(req: Request, res: Response): Promise<void> {
  const payload = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Partial<AnalyzeRawProductTextRequest> & {
    input?: unknown;
    rawText?: unknown;
  };

  const rawTextValue = payload.text ?? payload.input ?? payload.rawText;
  const text = requireNonEmptyString(rawTextValue, 'text');
  const region = parseOptionalText(payload.region, 'National');
  const category = parseOptionalText(payload.category, '');

  const parsed = parseRawProductText(text, { category: category || undefined });
  const historicalAverage = await getHistoricalAveragePrice(parsed.name);
  const aiResult = await analyzeProductPrice({
    name: parsed.name,
    price: parsed.price,
    region,
    category: parsed.category,
    rawText: parsed.rawText,
    historicalAverage
  });

  const persisted = await recordPriceAnalysis({
    name: aiResult.productName,
    category: aiResult.category,
    fairValue: aiResult.fairValue,
    price: aiResult.observedPrice,
    region: aiResult.region,
    anomalyScore: aiResult.anomalyScore,
    source: aiResult.source,
    rawText: parsed.rawText
  });

  res.status(200).json({
    parsed,
    ...aiResult,
    productId: persisted.product.id,
    transactionId: persisted.transaction.id
  });
}

export async function getMarketIndexHandler(req: Request, res: Response): Promise<void> {
  const limit = parseOptionalPositiveInt(req.query.limit, 'limit', 12);
  const rows = await listMarketIndex(limit);
  const records = rows.map((row) => {
    const avgObservedPrice = Number(row.avg_observed_price);
    const avgFairValue = Number(row.avg_fair_value);
    const variancePct =
      Number.isFinite(avgObservedPrice) && Number.isFinite(avgFairValue) && avgFairValue > 0
        ? Number((((avgObservedPrice - avgFairValue) / avgFairValue) * 100).toFixed(2))
        : 0;

    return {
      category: row.category,
      sampleCount: row.sample_count,
      avgObservedPrice: Number.isFinite(avgObservedPrice) ? Number(avgObservedPrice.toFixed(2)) : 0,
      avgFairValue: Number.isFinite(avgFairValue) ? Number(avgFairValue.toFixed(2)) : 0,
      variancePct,
      lastUpdated: row.last_updated ? row.last_updated.toISOString() : null
    };
  });

  res.status(200).json({
    count: records.length,
    records
  });
}

export async function getAnalysisHistoryHandler(req: Request, res: Response): Promise<void> {
  const limit = parseOptionalPositiveInt(req.query.limit, 'limit', 25);
  const rows = await listAnalysisHistory(limit);
  const records = rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    category: row.category,
    observedPrice: Number(row.price),
    fairValue: Number(row.fair_value),
    region: row.region,
    anomalyScore: Number(row.anomaly_score),
    source: row.source,
    rawText: row.raw_text,
    createdAt: row.created_at.toISOString()
  }));

  res.status(200).json({
    count: records.length,
    records
  });
}
