import axios, { isAxiosError } from 'axios';
import { getDeepseekTextModelCandidates } from './deepseekModelService';
import { parseJsonResponse, requireEnv, sanitizeText } from './serviceUtils';

type TranslationSource = 'none' | 'dictionary' | 'ai' | 'dictionary+ai';
type CanonicalSource = 'none' | 'rules';

export interface TranslationResult {
  original_text: string;
  english_text: string;
  source: TranslationSource;
  canonical_english_text: string;
  canonical_source: CanonicalSource;
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
  { pattern: /\bkarne\b/gi, replacement: 'meat' },
  { pattern: /\bkarneng\b/gi, replacement: 'meat' },
  { pattern: /\bkarning\b/gi, replacement: 'meat' },
  { pattern: /\bkarni\b/gi, replacement: 'meat' },
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

function hasAnyWord(text: string, words: string[]): boolean {
  return words.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(text));
}

function canonicalizeEnglishText(input: string): { canonicalText: string; source: CanonicalSource } {
  const normalized = sanitizeText(input).toLowerCase();
  if (!normalized) {
    return { canonicalText: '', source: 'none' };
  }

  const hasSpecificPorkCut = hasAnyWord(normalized, ['liempo', 'kasim', 'giniling', 'belly', 'ham', 'bacon', 'chop']);
  const hasSpecificBeefCut = hasAnyWord(normalized, ['sirloin', 'brisket', 'round', 'shank', 'tenderloin', 'ribeye']);
  const hasSpecificChickenCut = hasAnyWord(normalized, ['breast', 'thigh', 'drumstick', 'wing', 'fillet', 'quarter']);
  const hasSpecificRiceVariant = hasAnyWord(normalized, [
    'jasmine',
    'sinandomeng',
    'dinorado',
    'malagkit',
    'brown',
    'nfa',
    'well-milled',
    'well',
    'adlai'
  ]);

  if ((hasAnyWord(normalized, ['pork', 'pig']) || /meat\s+pork/i.test(normalized)) && !hasSpecificPorkCut) {
    return { canonicalText: 'Pork Meat', source: 'rules' };
  }

  if (hasAnyWord(normalized, ['beef', 'cow']) && !hasSpecificBeefCut) {
    return { canonicalText: 'Beef Meat', source: 'rules' };
  }

  if (hasAnyWord(normalized, ['chicken', 'poultry']) && !hasSpecificChickenCut) {
    return { canonicalText: 'Chicken Meat', source: 'rules' };
  }

  if (hasAnyWord(normalized, ['onion', 'onions'])) {
    return { canonicalText: 'Onion', source: 'rules' };
  }

  if (hasAnyWord(normalized, ['garlic'])) {
    return { canonicalText: 'Garlic', source: 'rules' };
  }

  if (hasAnyWord(normalized, ['tomato', 'tomatoes'])) {
    return { canonicalText: 'Tomato', source: 'rules' };
  }

  if (hasAnyWord(normalized, ['carrot', 'carrots'])) {
    return { canonicalText: 'Carrot', source: 'rules' };
  }

  if (hasAnyWord(normalized, ['potato', 'potatoes'])) {
    return { canonicalText: 'Potato', source: 'rules' };
  }

  if (hasAnyWord(normalized, ['rice']) && !hasSpecificRiceVariant) {
    return { canonicalText: 'Rice', source: 'rules' };
  }

  return {
    canonicalText: input,
    source: 'none'
  };
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
  const modelCandidates = getDeepseekTextModelCandidates();

  for (const model of modelCandidates) {
    try {
      const response = await axios.post(
        'https://api.deepseek.com/v1/chat/completions',
        {
          model,
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
        continue;
      }

      const parsed = parseJsonResponse(content);
      if (!parsed || typeof parsed !== 'object') {
        continue;
      }

      const englishText = (parsed as Record<string, unknown>).english_text;
      if (typeof englishText !== 'string') {
        continue;
      }

      const normalized = sanitizeText(englishText);
      if (!normalized) {
        continue;
      }

      return normalized;
    } catch (error) {
      if (isAxiosError(error)) {
        continue;
      }
    }
  }

  return null;
}

export async function normalizeToEnglish(inputText: string): Promise<TranslationResult> {
  const input = sanitizeText(inputText);
  if (!input) {
    return {
      original_text: inputText,
      english_text: '',
      source: 'none',
      canonical_english_text: '',
      canonical_source: 'none'
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
    source,
    canonical_english_text: '',
    canonical_source: 'none'
  };

  const canonical = canonicalizeEnglishText(result.english_text || input);
  result.canonical_english_text = canonical.canonicalText || result.english_text || input;
  result.canonical_source = canonical.source;

  translationCache.set(cacheKey, result);
  return result;
}
