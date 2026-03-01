import axios from 'axios';
import { normalizeItemName, type BaselineMap } from './ai';

export interface CriticalAssessment {
  criticalLevel: 1 | 2 | 3 | 4 | 5;
  criticalLabel: string;
  criticalColor: string;
  criticalMessage: string;
  score: number;
}

export interface ImageAnalysisResult {
  provider: 'deepseek' | 'heuristic';
  extractedText: string;
  suggestedName: string;
  suggestedCategory: string;
  summary: string;
  confidence: number;
  critical: CriticalAssessment;
}

export interface ScannerSourceRecord {
  marketplaceId: string;
  marketplaceName: string;
  name: string;
  category: string;
  supplier: string;
  basePrice: number;
  listedPrice: number;
  location: string;
}

export interface ProductScannerResult {
  product: string;
  category: string;
  fairnessScore: number;
  dtiPrice: number;
  marketPrice: number;
  onlinePrice: number;
  diffPct: number;
  critical: CriticalAssessment;
  insights: string;
  narrative: string;
  alternatives: Array<{
    marketplace: string;
    product: string;
    price: number;
    location: string;
  }>;
}

interface DeepSeekChoice {
  message?: {
    content?: unknown;
  };
}

interface DeepSeekResponse {
  choices?: DeepSeekChoice[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseJsonObjectFromText<T>(raw: string): T | null {
  const cleaned = raw.trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // continue
  }

  const fencedMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    try {
      return JSON.parse(fencedMatch[1].trim()) as T;
    } catch {
      // continue
    }
  }

  const firstCurly = cleaned.indexOf('{');
  const lastCurly = cleaned.lastIndexOf('}');
  if (firstCurly >= 0 && lastCurly > firstCurly) {
    const candidate = cleaned.slice(firstCurly, lastCurly + 1);
    try {
      return JSON.parse(candidate) as T;
    } catch {
      return null;
    }
  }

  return null;
}

function filenameToText(filename: string): string {
  return filename
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectCategory(text: string): string {
  const lower = text.toLowerCase();
  if (/(rice|oats|flour|grains?)/.test(lower)) return 'Rice & Grains';
  if (/(pork|chicken|beef|fish|seafood|shrimp|squid)/.test(lower)) return 'Meat & Seafood';
  if (/(onion|garlic|potato|tomato|carrot|vegetable|cabbage)/.test(lower)) return 'Vegetables';
  if (/(milk|cheese|butter|yogurt|egg)/.test(lower)) return 'Dairy & Eggs';
  if (/(soap|shampoo|toothpaste|deodorant|lotion|alcohol)/.test(lower)) return 'Personal Care';
  if (/(detergent|bleach|cleaner|tissue|trash|foil)/.test(lower)) return 'Household';
  if (/(juice|coffee|tea|soda|water|drink)/.test(lower)) return 'Beverages';
  if (/(sardines|corned|tuna|canned)/.test(lower)) return 'Canned';
  return 'Essentials';
}

export function assessCriticalLevelFromSignals(params: { text: string; ratio?: number }): CriticalAssessment {
  const text = params.text.toLowerCase();
  let score = 0;

  if (params.ratio !== undefined && Number.isFinite(params.ratio)) {
    const ratioDelta = Math.abs(params.ratio - 1);
    score += clamp(Math.round(ratioDelta * 140), 0, 70);
  }

  const severeKeywords = ['recall', 'contaminated', 'toxic', 'hazard', 'expired', 'counterfeit'];
  const highKeywords = ['spike', 'anomaly', 'abnormal', 'price surge', 'suspicious', 'fraud'];
  const mediumKeywords = ['inconsistent', 'mismatch', 'review', 'investigate', 'watchlist'];

  for (const keyword of severeKeywords) {
    if (text.includes(keyword)) score += 30;
  }
  for (const keyword of highKeywords) {
    if (text.includes(keyword)) score += 18;
  }
  for (const keyword of mediumKeywords) {
    if (text.includes(keyword)) score += 10;
  }

  score = clamp(score, 0, 100);

  if (score >= 85) {
    return {
      criticalLevel: 5,
      criticalLabel: 'Critical',
      criticalColor: '#ff1f1f',
      criticalMessage: 'Immediate intervention required.',
      score
    };
  }

  if (score >= 65) {
    return {
      criticalLevel: 4,
      criticalLabel: 'High Risk',
      criticalColor: '#ff5a5a',
      criticalMessage: 'Escalate quickly and monitor continuously.',
      score
    };
  }

  if (score >= 45) {
    return {
      criticalLevel: 3,
      criticalLabel: 'Moderate',
      criticalColor: '#ff9f1a',
      criticalMessage: 'Requires investigation and close monitoring.',
      score
    };
  }

  if (score >= 25) {
    return {
      criticalLevel: 2,
      criticalLabel: 'Low Watch',
      criticalColor: '#ffd166',
      criticalMessage: 'Keep under observation.',
      score
    };
  }

  return {
    criticalLevel: 1,
    criticalLabel: 'Stable',
    criticalColor: '#1ed760',
    criticalMessage: 'No urgent issue detected.',
    score
  };
}

async function callDeepSeekCompletion(params: {
  systemPrompt: string;
  userPrompt: string;
  imageData?: string;
}): Promise<string | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const baseUrl = (process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com').replace(/\/+$/, '');
  const model = process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-chat';
  const visionModel = process.env.DEEPSEEK_VISION_MODEL?.trim();
  const requestModel = params.imageData && visionModel ? visionModel : model;

  const userContent =
    params.imageData && visionModel
      ? [
          { type: 'text', text: params.userPrompt },
          { type: 'image_url', image_url: { url: params.imageData } }
        ]
      : params.userPrompt;

  try {
    const response = await axios.post<DeepSeekResponse>(
      `${baseUrl}/chat/completions`,
      {
        model: requestModel,
        temperature: 0.1,
        max_tokens: 900,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: userContent }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
      return content;
    }
  } catch {
    return null;
  }

  return null;
}

interface ImageAiPayload {
  extractedText?: string;
  suggestedName?: string;
  suggestedCategory?: string;
  summary?: string;
  confidence?: number;
  riskSignals?: string;
}

export async function analyzeImagePayload(params: {
  imageData?: string;
  imageName?: string;
  imageTextHint?: string;
}): Promise<ImageAnalysisResult> {
  const fileHint = params.imageName ? filenameToText(params.imageName) : '';
  const textHint = params.imageTextHint?.trim() || '';
  const baseHint = [fileHint, textHint].filter(Boolean).join(' ').trim();

  const systemPrompt =
    'You analyze product images for a pricing intelligence platform. Return strict JSON only.';
  const userPrompt = [
    'Analyze this product image and infer product text.',
    'Return JSON with keys: extractedText, suggestedName, suggestedCategory, summary, confidence, riskSignals.',
    'confidence must be 0-1.'
  ].join(' ');

  const aiRaw = await callDeepSeekCompletion({
    systemPrompt,
    userPrompt: `${userPrompt} Existing hint: ${baseHint || 'none'}`,
    imageData: params.imageData
  });

  const parsed = aiRaw ? parseJsonObjectFromText<ImageAiPayload>(aiRaw) : null;
  if (parsed && (parsed.extractedText || parsed.suggestedName || parsed.summary)) {
    const extractedText = (parsed.extractedText || baseHint || 'No text extracted').trim();
    const suggestedName = (parsed.suggestedName || extractedText || 'Unlabeled Product').trim();
    const suggestedCategory = (parsed.suggestedCategory || detectCategory(`${suggestedName} ${extractedText}`)).trim();
    const summary = (parsed.summary || `AI extracted "${suggestedName}" from image.`).trim();
    const confidence = clamp(Number(parsed.confidence ?? 0.72), 0.05, 1);
    const critical = assessCriticalLevelFromSignals({
      text: `${summary} ${parsed.riskSignals ?? ''}`
    });

    return {
      provider: 'deepseek',
      extractedText,
      suggestedName,
      suggestedCategory,
      summary,
      confidence: Number(confidence.toFixed(2)),
      critical
    };
  }

  const heuristicText = baseHint || 'No text extracted';
  const heuristicName = fileHint || textHint || 'Unlabeled Product';
  const heuristicCategory = detectCategory(`${heuristicName} ${heuristicText}`);
  const heuristicSummary = `Heuristic analysis inferred "${heuristicName}" from available image metadata.`;
  const critical = assessCriticalLevelFromSignals({ text: heuristicText });

  return {
    provider: 'heuristic',
    extractedText: heuristicText,
    suggestedName: heuristicName,
    suggestedCategory: heuristicCategory,
    summary: heuristicSummary,
    confidence: 0.45,
    critical
  };
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function scoreMatch(queryTokens: string[], row: ScannerSourceRecord): number {
  const hay = `${row.name} ${row.category} ${row.supplier} ${row.marketplaceName}`.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (hay.includes(token)) {
      score += 1;
    }
  }
  return score;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

interface ScannerAiNarrative {
  narrative?: string;
  insight?: string;
}

export async function buildScannerResult(params: {
  query: string;
  records: ScannerSourceRecord[];
  baseline: BaselineMap;
  mode?: string;
}): Promise<ProductScannerResult> {
  const query = params.query.trim();
  const queryTokens = tokenize(query);
  const normalizedQuery = normalizeItemName(query);

  const scored = params.records
    .map((row) => ({ row, score: scoreMatch(queryTokens, row) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.row.listedPrice - b.row.listedPrice);

  const matches = scored.length > 0 ? scored.slice(0, 30).map((entry) => entry.row) : params.records.slice(0, 30);
  const primary = matches[0] ?? params.records[0];

  const dtiPrice = params.baseline[normalizedQuery] ?? primary?.basePrice ?? 1;
  const marketPrice = average(matches.map((row) => row.listedPrice)) || dtiPrice;
  const onlineRows = matches.filter((row) => row.marketplaceId === 'lazada' || row.marketplaceId === 'shopee');
  const onlinePrice = average((onlineRows.length > 0 ? onlineRows : matches).map((row) => row.listedPrice)) || marketPrice;
  const ratio = dtiPrice > 0 ? marketPrice / dtiPrice : 1;
  const diffPct = dtiPrice > 0 ? ((marketPrice - dtiPrice) / dtiPrice) * 100 : 0;
  const fairnessScore = clamp(Math.round(100 - Math.abs(ratio - 1) * 120), 1, 99);
  const critical = assessCriticalLevelFromSignals({
    text: `${query} ${primary?.category ?? ''}`,
    ratio
  });

  const alternatives = matches
    .slice()
    .sort((a, b) => a.listedPrice - b.listedPrice)
    .slice(0, 5)
    .map((row) => ({
      marketplace: row.marketplaceName,
      product: row.name,
      price: Number(row.listedPrice.toFixed(2)),
      location: row.location
    }));

  const defaultInsight =
    diffPct > 0
      ? `Current market average is ${diffPct.toFixed(1)}% above baseline.`
      : `Current market average is ${Math.abs(diffPct).toFixed(1)}% below baseline.`;

  let narrative = `AI analyzed ${matches.length} records across live marketplaces.`;
  let insights = defaultInsight;

  const aiRaw = await callDeepSeekCompletion({
    systemPrompt:
      'You are an analyst for commodity pricing. Return strict JSON with keys narrative and insight (both short strings).',
    userPrompt: JSON.stringify({
      query,
      mode: params.mode ?? 'basic',
      dtiPrice,
      marketPrice,
      onlinePrice,
      diffPct: Number(diffPct.toFixed(2)),
      criticalLevel: critical.criticalLevel,
      alternatives
    })
  });

  const aiParsed = aiRaw ? parseJsonObjectFromText<ScannerAiNarrative>(aiRaw) : null;
  if (aiParsed?.narrative) {
    narrative = aiParsed.narrative;
  }
  if (aiParsed?.insight) {
    insights = aiParsed.insight;
  }

  return {
    product: primary?.name ?? query,
    category: primary?.category ?? detectCategory(query),
    fairnessScore,
    dtiPrice: Number(dtiPrice.toFixed(2)),
    marketPrice: Number(marketPrice.toFixed(2)),
    onlinePrice: Number(onlinePrice.toFixed(2)),
    diffPct: Number(diffPct.toFixed(2)),
    critical,
    insights,
    narrative,
    alternatives
  };
}

interface KnowledgeAiPayload {
  summary?: string;
  actions?: string[];
}

export async function buildKnowledgeNarrative(payload: Record<string, unknown>): Promise<{ summary: string; actions: string[] }> {
  const fallbackSummary = 'AI maintenance cycle completed with updated catalog, monitoring, and alert statistics.';
  const fallbackActions = ['Continue hourly maintenance and monitor high-risk price ratios.'];

  const aiRaw = await callDeepSeekCompletion({
    systemPrompt:
      'You summarize platform state for admins. Return strict JSON with keys summary (string) and actions (string array, max 5).',
    userPrompt: JSON.stringify(payload)
  });

  const parsed = aiRaw ? parseJsonObjectFromText<KnowledgeAiPayload>(aiRaw) : null;
  if (!parsed) {
    return { summary: fallbackSummary, actions: fallbackActions };
  }

  const summary = typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : fallbackSummary;
  const actions = Array.isArray(parsed.actions)
    ? parsed.actions.filter((value): value is string => typeof value === 'string').slice(0, 5)
    : fallbackActions;

  return {
    summary,
    actions: actions.length > 0 ? actions : fallbackActions
  };
}
