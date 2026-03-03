import { sanitizeText } from './serviceUtils';

interface OpenAiTranscriptionResponse {
  text?: unknown;
}

function normalizeMimeType(input: unknown): string {
  const value = typeof input === 'string' ? sanitizeText(input).toLowerCase() : '';
  if (!value) {
    return 'audio/webm';
  }

  const allowed = new Set([
    'audio/webm',
    'audio/wav',
    'audio/x-wav',
    'audio/mpeg',
    'audio/mp3',
    'audio/mp4',
    'audio/ogg'
  ]);

  if (allowed.has(value)) {
    return value === 'audio/x-wav' ? 'audio/wav' : value;
  }

  return 'audio/webm';
}

function inferExtensionFromMimeType(mimeType: string): string {
  if (mimeType === 'audio/wav') return 'wav';
  if (mimeType === 'audio/mpeg' || mimeType === 'audio/mp3') return 'mp3';
  if (mimeType === 'audio/mp4') return 'm4a';
  if (mimeType === 'audio/ogg') return 'ogg';
  return 'webm';
}

function decodeBase64Audio(rawBase64: string): Buffer {
  const cleaned = sanitizeText(rawBase64).replace(/^data:audio\/[a-z0-9.+-]+;base64,/i, '');
  if (!cleaned) {
    throw new Error('Audio payload is empty.');
  }

  const decoded = Buffer.from(cleaned, 'base64');
  if (!decoded.length) {
    throw new Error('Audio payload is invalid.');
  }

  const maxBytes = 12 * 1024 * 1024;
  if (decoded.length > maxBytes) {
    throw new Error('Audio file is too large. Maximum upload size is 12MB.');
  }

  return decoded;
}

async function transcribeWithOpenAi(audioBuffer: Buffer, mimeType: string, languageHint: string): Promise<string> {
  const openAiKey = process.env.OPENAI_API_KEY;
  if (!openAiKey) {
    throw new Error('OPENAI_API_KEY is not configured for audio transcription.');
  }

  const model = sanitizeText(process.env.OPENAI_TRANSCRIBE_MODEL ?? 'gpt-4o-mini-transcribe');
  const extension = inferExtensionFromMimeType(mimeType);
  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: mimeType });

  formData.append('file', blob, `voice-input.${extension}`);
  formData.append('model', model || 'gpt-4o-mini-transcribe');
  formData.append('temperature', '0');

  if (languageHint) {
    formData.append('language', languageHint);
  }

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openAiKey}`
    },
    body: formData
  });

  if (!response.ok) {
    const errorText = sanitizeText(await response.text());
    throw new Error(
      `Audio transcription service unavailable (${response.status}${errorText ? `: ${errorText}` : ''}).`
    );
  }

  const payload = (await response.json()) as OpenAiTranscriptionResponse;
  const transcript = typeof payload.text === 'string' ? sanitizeText(payload.text) : '';
  if (!transcript) {
    throw new Error('Audio transcription returned an empty result.');
  }

  return transcript;
}

export async function transcribeAudioBase64(rawBase64: string, rawMimeType: unknown, rawLanguage: unknown): Promise<string> {
  const mimeType = normalizeMimeType(rawMimeType);
  const languageHint = typeof rawLanguage === 'string' ? sanitizeText(rawLanguage).toLowerCase() : '';
  const audioBuffer = decodeBase64Audio(rawBase64);
  return transcribeWithOpenAi(audioBuffer, mimeType, languageHint);
}
