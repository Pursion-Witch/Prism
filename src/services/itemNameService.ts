import axios, { isAxiosError } from 'axios';
import { parseJsonResponse, requireEnv, sanitizeText } from './serviceUtils';

type ItemExtractionSource = 'raw' | 'rules' | 'ai' | 'rules+ai';

export interface ItemNameExtractionResult {
  raw_text: string;
  item_name: string;
  source: ItemExtractionSource;
}

const AI_TIMEOUT_MS = Number(process.env.AI_ITEM_EXTRACTION_TIMEOUT_MS ?? 8000);
const MAX_REASONABLE_PRICE = 200000;

const SENTENCE_CUT_WORDS = new Set([
  'was',
  'were',
  'is',
  'are',
  'at',
  'for',
  'worth',
  'cost',
  'costs',
  'costing',
  'priced',
  'price',
  'today',
  'yesterday',
  'now',
  'currently',
  'around',
  'about',
  'kay',
  'presyo',
  'tag',
  'amount',
  'value'
]);

const NUMBER_WORDS = new Map<string, number>([
  ['zero', 0],
  ['one', 1],
  ['isa', 1],
  ['usa', 1],
  ['two', 2],
  ['duha', 2],
  ['dos', 2],
  ['three', 3],
  ['tulo', 3],
  ['tres', 3],
  ['four', 4],
  ['upat', 4],
  ['kwatro', 4],
  ['quatro', 4],
  ['five', 5],
  ['lima', 5],
  ['cinco', 5],
  ['sinko', 5],
  ['six', 6],
  ['unom', 6],
  ['seis', 6],
  ['seven', 7],
  ['pito', 7],
  ['siete', 7],
  ['eight', 8],
  ['walo', 8],
  ['otso', 8],
  ['ocho', 8],
  ['nine', 9],
  ['siyam', 9],
  ['nueve', 9],
  ['ten', 10],
  ['napulo', 10],
  ['dies', 10],
  ['twenty', 20],
  ['beinte', 20],
  ['baynte', 20],
  ['vente', 20],
  ['thirty', 30],
  ['trenta', 30],
  ['forty', 40],
  ['kwarenta', 40],
  ['quarenta', 40],
  ['fifty', 50],
  ['fifti', 50],
  ['singkwenta', 50],
  ['sinkwenta', 50],
  ['singkuwenta', 50],
  ['limampu', 50],
  ['sixty', 60],
  ['sesenta', 60],
  ['seventy', 70],
  ['sitenta', 70],
  ['eighty', 80],
  ['otsenta', 80],
  ['ochenta', 80],
  ['ninety', 90],
  ['nubenta', 90],
  ['nobenta', 90]
]);

const HUNDRED_WORDS = new Set(['hundred', 'gatos']);
const THOUSAND_WORDS = new Set(['thousand', 'libo']);
const CONNECTOR_WORDS = new Set(['ka', 'ug', 'and', 'plus', 'lang', 'mga']);
const PRICE_CONTEXT_WORDS = new Set(['tag', 'priced', 'price', 'presyo', 'worth', 'cost', 'costs', 'at', 'for']);

function toTitleCase(text: string): string {
  return text
    .split(' ')
    .filter(Boolean)
    .map((token) => {
      if (/^[0-9]/.test(token)) {
        return token;
      }
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join(' ');
}

function cleanupInput(rawText: string): string {
  return sanitizeText(rawText)
    .replace(/(?:\u20b1|₱|PHP|Php|php|P)\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?/g, ' ')
    .replace(/[0-9][0-9,]*(?:\.[0-9]{1,2})?\s*(?:pesos?|peso|php)/gi, ' ')
    .replace(/\b(?:tag|priced|price|presyo|worth|cost|costs)\s+[a-z-]+\b/gi, ' ')
    .replace(/\b(?:each|ea|per|\/)\s*(?:kg|kilo|pc|piece|pack|liter|l|ml|g)\b/gi, ' ')
    .replace(/[,:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cutSentenceTail(cleaned: string): string {
  if (!cleaned) {
    return '';
  }

  const tokens = cleaned.split(' ').filter(Boolean);
  const kept: string[] = [];

  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if (SENTENCE_CUT_WORDS.has(normalized)) {
      break;
    }

    kept.push(token);
  }

  return sanitizeText(kept.join(' '));
}

function applyRuleExtraction(rawText: string): string {
  const cleaned = cleanupInput(rawText);
  if (!cleaned) {
    return '';
  }

  const withoutTail = cutSentenceTail(cleaned);
  const candidate = withoutTail || cleaned;
  const filtered = candidate
    .replace(/\b(?:the|this|that|these|those|ang|yung|nga|lang|po|please|didto|diri|karon|adto)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const limited = filtered
    .split(' ')
    .filter(Boolean)
    .slice(0, 5)
    .join(' ');

  return toTitleCase(limited);
}

function looksSentenceLike(input: string): boolean {
  const words = input.split(' ').filter(Boolean);
  if (words.length >= 5) {
    return true;
  }

  return /\b(was|were|is|are|at|for|price|presyo|cost|worth|kay|today|now|tag)\b/i.test(input);
}

function parseNumberWords(tokens: string[]): number | null {
  let accumulated = 0;
  let current = 0;
  let used = 0;

  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if (!normalized) {
      continue;
    }

    if (CONNECTOR_WORDS.has(normalized)) {
      continue;
    }

    const mapped = NUMBER_WORDS.get(normalized);
    if (mapped !== undefined) {
      current += mapped;
      used += 1;
      continue;
    }

    if (HUNDRED_WORDS.has(normalized)) {
      current = (current || 1) * 100;
      used += 1;
      continue;
    }

    if (THOUSAND_WORDS.has(normalized)) {
      accumulated += (current || 1) * 1000;
      current = 0;
      used += 1;
      continue;
    }

    if (used > 0) {
      break;
    }
  }

  if (used === 0) {
    return null;
  }

  const total = accumulated + current;
  if (!Number.isFinite(total) || total <= 0 || total > MAX_REASONABLE_PRICE) {
    return null;
  }

  return Number(total.toFixed(2));
}

function extractNumericPrice(rawText: string): number | null {
  const directMatch = rawText.match(/(?:\u20b1|₱|PHP|Php|php|P)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/);
  if (directMatch?.[1]) {
    const value = Number(directMatch[1].replace(/,/g, ''));
    if (Number.isFinite(value) && value > 0 && value <= MAX_REASONABLE_PRICE) {
      return Number(value.toFixed(2));
    }
  }

  const trailingPesoMatch = rawText.match(/([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:pesos?|peso)/i);
  if (trailingPesoMatch?.[1]) {
    const value = Number(trailingPesoMatch[1].replace(/,/g, ''));
    if (Number.isFinite(value) && value > 0 && value <= MAX_REASONABLE_PRICE) {
      return Number(value.toFixed(2));
    }
  }

  return null;
}

function tokenize(rawText: string): string[] {
  return rawText
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function extractPriceFromNumberWords(rawText: string): number | null {
  const tokens = tokenize(rawText);
  if (!tokens.length) {
    return null;
  }

  for (let index = 0; index < tokens.length; index += 1) {
    if (!PRICE_CONTEXT_WORDS.has(tokens[index])) {
      continue;
    }

    const sliced = tokens.slice(index + 1);
    const parsed = parseNumberWords(sliced);
    if (parsed !== null) {
      return parsed;
    }
  }

  return parseNumberWords(tokens);
}

function buildItemExtractionPrompt(): string {
  return [
    'Extract only the product item name from a short sentence.',
    'Return JSON only.',
    'Schema:',
    '{',
    '  "item_name": "string"',
    '}',
    'Rules:',
    '- Return only one item name.',
    '- Remove sentence fillers and pricing words.',
    '- Keep brand and variant words when meaningful.',
    '- Output must be concise title case.'
  ].join('\n');
}

async function extractItemWithAi(rawText: string): Promise<string | null> {
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
            content: buildItemExtractionPrompt()
          },
          {
            role: 'user',
            content: rawText
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

    const itemName = (parsed as Record<string, unknown>).item_name;
    if (typeof itemName !== 'string') {
      return null;
    }

    const cleaned = sanitizeText(itemName);
    if (!cleaned) {
      return null;
    }

    return toTitleCase(cleaned);
  } catch (error) {
    if (isAxiosError(error)) {
      return null;
    }

    return null;
  }
}

export async function extractPrimaryItemName(rawText: string): Promise<ItemNameExtractionResult> {
  const raw = sanitizeText(rawText);
  if (!raw) {
    return {
      raw_text: rawText,
      item_name: '',
      source: 'raw'
    };
  }

  const ruleCandidate = applyRuleExtraction(raw);
  const aiEnabled = String(process.env.AI_ITEM_EXTRACTION_ENABLED ?? 'true').toLowerCase() !== 'false';

  if (!aiEnabled || !looksSentenceLike(raw)) {
    return {
      raw_text: raw,
      item_name: ruleCandidate || toTitleCase(raw),
      source: ruleCandidate ? 'rules' : 'raw'
    };
  }

  const aiCandidate = await extractItemWithAi(raw);
  if (aiCandidate) {
    return {
      raw_text: raw,
      item_name: aiCandidate,
      source: ruleCandidate && aiCandidate.toLowerCase() !== ruleCandidate.toLowerCase() ? 'rules+ai' : 'ai'
    };
  }

  return {
    raw_text: raw,
    item_name: ruleCandidate || toTitleCase(raw),
    source: ruleCandidate ? 'rules' : 'raw'
  };
}

export function extractPriceFromSentence(rawText: string): number | null {
  const raw = sanitizeText(rawText);
  if (!raw) {
    return null;
  }

  const numericPrice = extractNumericPrice(raw);
  if (numericPrice !== null) {
    return numericPrice;
  }

  return extractPriceFromNumberWords(raw);
}
