import { sanitizeText } from './serviceUtils';

type TextModelPreference = 'r1' | 'v3';

const DEFAULT_R1_MODEL = 'deepseek-reasoner';
const DEFAULT_V3_MODEL = 'deepseek-chat';

function normalizeModelName(value: string | undefined): string {
  if (!value) {
    return '';
  }

  return sanitizeText(value);
}

function addUniqueModel(target: string[], modelName: string): void {
  const normalized = normalizeModelName(modelName);
  if (!normalized) {
    return;
  }

  if (target.includes(normalized)) {
    return;
  }

  target.push(normalized);
}

function getTextModelPreference(): TextModelPreference {
  const rawPreference = normalizeModelName(
    process.env.DEEPSEEK_TEXT_MODEL_PREFERENCE ?? process.env.DEEPSEEK_REASONING_PREFERENCE
  ).toLowerCase();

  return rawPreference === 'v3' ? 'v3' : 'r1';
}

export function getDeepseekTextModelCandidates(): string[] {
  const models: string[] = [];
  const configuredPrimary = normalizeModelName(process.env.DEEPSEEK_TEXT_MODEL ?? process.env.DEEPSEEK_MODEL);
  const configuredFallback = normalizeModelName(process.env.DEEPSEEK_TEXT_FALLBACK_MODEL);
  const configuredR1 = normalizeModelName(process.env.DEEPSEEK_R1_MODEL) || DEFAULT_R1_MODEL;
  const configuredV3 = normalizeModelName(process.env.DEEPSEEK_V3_MODEL) || DEFAULT_V3_MODEL;
  const preference = getTextModelPreference();

  addUniqueModel(models, configuredPrimary);
  addUniqueModel(models, configuredFallback);

  if (preference === 'v3') {
    addUniqueModel(models, configuredV3);
    addUniqueModel(models, configuredR1);
  } else {
    addUniqueModel(models, configuredR1);
    addUniqueModel(models, configuredV3);
  }

  return models;
}
