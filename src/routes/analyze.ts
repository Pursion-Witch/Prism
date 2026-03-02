import { Router, type NextFunction, type Request, type Response } from 'express';
import { analyzePrice } from '../services/priceService';

interface AnalyzeRequestBody {
  name?: unknown;
  price?: unknown;
  region?: unknown;
}

const router = Router();

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, price, region } = req.body as AnalyzeRequestBody;
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedRegion = typeof region === 'string' ? region.trim() : 'Metro Manila';
    const parsedPrice = typeof price === 'number' ? price : Number(price);

    if (!normalizedName || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      return res.status(400).json({
        message: 'Please provide valid name and positive price.'
      });
    }

    const result = await analyzePrice({
      name: normalizedName,
      price: parsedPrice,
      region: normalizedRegion || 'Metro Manila'
    });

    const fairPrice = result.fair_market_value;
    const anomalyScore = fairPrice > 0 ? Math.abs(parsedPrice - fairPrice) / fairPrice : 0;

    return res.json({
      ...result,
      fairPrice: Number(fairPrice.toFixed(2)),
      anomalyScore: Number(anomalyScore.toFixed(6))
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
