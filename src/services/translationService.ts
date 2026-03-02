import axios, { isAxiosError } from 'axios';
import { parseJsonResponse, requireEnv, sanitizeText } from './serviceUtils';

type TranslationSource = 'none' | 'dictionary' | 'ai' | 'dictionary+ai';

export interface TranslationResult {
  original_text: string;
  english_text: string;
  source: TranslationSource;
}

const translationCache = new Map<string, TranslationResult>();
const AI_TIMEOUT_MS = Number(process.env.AI_TRANSLATION_TIMEOUT_MS ?? 8000);

const DICTIONARY_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bpresyo\s+sa\b/gi, replacement: '' },
  { pattern: /\bpresyo\b/gi, replacement: '' },
  { pattern: /\bsa\b/gi, replacement: ' ' },
  { pattern: /\bng\b/gi, replacement: ' ' },
  { pattern: /\bni\b/gi, replacement: ' ' },
  { pattern: /\bde\b/gi, replacement: ' ' },
  { pattern: /\bbigas\b/gi, replacement: 'rice' },
  { pattern: /\bbugas\b/gi, replacement: 'rice' },
  { pattern: /\bmais\b/gi, replacement: 'corn' },
  { pattern: /\bsibuyas\b/gi, replacement: 'onion' },
  { pattern: /\bbawang\b/gi, replacement: 'garlic' },
  { pattern: /\bkamatis\b/gi, replacement: 'tomato' },
  { pattern: /\bpatatas\b/gi, replacement: 'potato' },
  { pattern: /\bkarot\b/gi, replacement: 'carrot' },
  { pattern: /\bmanok\b/gi, replacement: 'chicken' },
  { pattern: /\bbaboy\b/gi, replacement: 'pork' },
  { pattern: /\bbaka\b/gi, replacement: 'beef' },
  { pattern: /\bisda\b/gi, replacement: 'fish' },
  { pattern: /\bitlog\b/gi, replacement: 'egg' },
  { pattern: /\basukal\b/gi, replacement: 'sugar' },
  { pattern: /\basin\b/gi, replacement: 'salt' },
  { pattern: /\blana\b/gi, replacement: 'cooking oil' },
  { pattern: /\blangis\b/gi, replacement: 'cooking oil' },
  { pattern: /\bgulay\b/gi, replacement: 'vegetable' },
  { pattern: /\butas\b/gi, replacement: 'fruit' },
  { pattern: /\bpalengke\b/gi, replacement: 'public market' },
  { pattern: /\btindahan\b/gi, replacement: 'store' },
  { pattern: /\bsari[-\s]?sari\b/gi, replacement: 'small neighborhood store' }
];

function applyDictionaryTranslation(input: string): string {
  let output = input;

  for (const item of DICTIONARY_REPLACEMENTS) {
    output = output.replace(item.pattern, item.replacement);
  }

  return sanitizeText(output);
}

function isLikelyEnglish(input: string): boolean {
  return /^[a-z0-9\s.,()\-/'"&]+$/i.test(input);
}

function shouldUseAiTranslation(input: string, dictionaryOutput: string): boolean {
  const translationEnabled = String(process.env.AI_TRANSLATION_ENABLED ?? 'true').toLowerCase() !== 'false';
  if (!translationEnabled) {
    return false;
  }

  const changedByDictionary = dictionaryOutput.toLowerCase() !== input.toLowerCase();
  if (changedByDictionary) {
    return false;
  }

  if (!isLikelyEnglish(input)) {
    return true;
  }

  const containsLocalSignal = /\b(ng|sa|presyo|palengke|tindahan|manok|baboy|isda|bigas|gulay)\b/i.test(input);
  return containsLocalSignal;
}

function buildAiPrompt(): string {
  return [
    'You translate short shopping/product text into English.',
    'Return JSON only.',
    'Schema:',
    '{',
    '  "english_text": "string"',
    '}',
    'Rules:',
    '- Keep brand names and sizes unchanged.',
    '- Keep numbers and units unchanged.',
    '- If already English, return same text.'
  ].join('\n');
}

async function translateWithAi(input: string): Promise<string | null> {
  try {
    const response = await axios.post(
      'https://api.deepseek.com/v1/chat/completions',
      {
        model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: buildAiPrompt()
          },
          {
            role: 'user',
            content: input
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${requireEnv('DEEPSEEK_API_KEY')}`,
          'Content-Type': 'application/json'
        },
        timeout: AI_TIMEOUT_MS
      }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      return null;
    }

    const parsed = parseJsonResponse(content);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const englishText = (parsed as Record<string, unknown>).english_text;
    if (typeof englishText !== 'string') {
      return null;
    }

    const normalized = sanitizeText(englishText);
    if (!normalized) {
      return null;
    }

    return normalized;
  } catch (error) {
    if (isAxiosError(error)) {
      return null;
    }

    return null;
  }
}

export async function normalizeToEnglish(inputText: string): Promise<TranslationResult> {
  const input = sanitizeText(inputText);
  if (!input) {
    return {
      original_text: inputText,
      english_text: '',
      source: 'none'
    };
  }

  const cacheKey = input.toLowerCase();
  const cached = translationCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const dictionaryOutput = applyDictionaryTranslation(input);
  const dictionaryChanged = dictionaryOutput.toLowerCase() !== input.toLowerCase();

  let finalOutput = dictionaryOutput;
  let source: TranslationSource = dictionaryChanged ? 'dictionary' : 'none';

  if (shouldUseAiTranslation(input, dictionaryOutput)) {
    const aiOutput = await translateWithAi(input);
    if (aiOutput && aiOutput.toLowerCase() !== input.toLowerCase()) {
      finalOutput = aiOutput;
      source = dictionaryChanged ? 'dictionary+ai' : 'ai';
    }
  }

  const result: TranslationResult = {
    original_text: input,
    english_text: finalOutput || input,
    source
  };

  translationCache.set(cacheKey, result);
  return result;
}
