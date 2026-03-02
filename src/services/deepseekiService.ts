import axios, { isAxiosError } from 'axios';
import { parseJsonResponse, requireEnv, sanitizeText } from './serviceUtils';

export type DeepseekVerdict = 'OVERPRICED' | 'FAIR' | 'GREAT DEAL' | 'STEAL';

export interface DeepseekRequestInput {
  name: string;
  price: number;
  region: string;
  srp_price?: number | null;
}

export interface DeepseekAnalysis {
  verdict: DeepseekVerdict;
  fair_market_value: number;
  reasoning: string;
}

const ALLOWED_VERDICTS: DeepseekVerdict[] = ['OVERPRICED', 'FAIR', 'GREAT DEAL', 'STEAL'];

function validateDeepseekOutput(payload: unknown): DeepseekAnalysis {
  if (!payload || typeof payload !== 'object') {
    throw new Error('AI response is not a JSON object.');
  }

  const { verdict, fair_market_value, reasoning } = payload as Record<string, unknown>;

  if (typeof verdict !== 'string' || !ALLOWED_VERDICTS.includes(verdict as DeepseekVerdict)) {
    throw new Error('AI response has invalid verdict.');
  }

  const parsedFairValue = Number(fair_market_value);
  if (!Number.isFinite(parsedFairValue) || parsedFairValue <= 0) {
    throw new Error('AI response has invalid fair_market_value.');
  }

  if (typeof reasoning !== 'string' || sanitizeText(reasoning).length < 3) {
    throw new Error('AI response has invalid reasoning.');
  }

  return {
    verdict: verdict as DeepseekVerdict,
    fair_market_value: Number(parsedFairValue.toFixed(2)),
    reasoning: sanitizeText(reasoning)
  };
}

function buildSystemPrompt(): string {
  return [
    'You are a strict price intelligence engine.',
    'Return ONLY valid JSON. No markdown. No extra text.',
    'JSON schema:',
    '{',
    '  "verdict": "OVERPRICED" | "FAIR" | "GREAT DEAL" | "STEAL",',
    '  "fair_market_value": number,',
    '  "reasoning": string',
    '}',
    'Use concise, objective reasoning.'
  ].join('\n');
}

export async function analyzeWithDeepseek(input: DeepseekRequestInput): Promise<DeepseekAnalysis> {
  const apiKey = requireEnv('DEEPSEEK_API_KEY');

  try {
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: buildSystemPrompt()
          },
          {
            role: 'user',
            content: JSON.stringify({
              name: input.name,
              price: input.price,
              region: input.region,
              srp_price: input.srp_price ?? null
            })
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 20000
      }
    );

    const rawContent = response.data?.choices?.[0]?.message?.content;
    if (typeof rawContent !== 'string' || !rawContent.trim()) {
      throw new Error('AI response content is empty.');
    }

    const parsed = parseJsonResponse(rawContent);
    return validateDeepseekOutput(parsed);
  } catch (error) {
    if (isAxiosError(error)) {
      const status = error.response?.status;
      const details = status ? `status ${status}` : 'network failure';
      throw new Error(`AI service unavailable (${details}).`);
    }

    if (error instanceof SyntaxError) {
      throw new Error('AI service returned malformed JSON.');
    }

    if (error instanceof Error) {
      throw new Error(`AI analysis failed: ${error.message}`);
    }

    throw new Error('AI analysis failed due to an unknown error.');
  }
}
