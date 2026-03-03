import { sanitizeText } from './serviceUtils';

interface OpenAiTranscriptionResponse {
  text?: unknown;
}

interface DeepseekChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
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

function inferAudioFormatFromMimeType(mimeType: string): string {
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

async function transcribeWithDeepseek(audioBuffer: Buffer, mimeType: string, languageHint: string): Promise<string> {
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (!deepseekKey) {
    throw new Error('DEEPSEEK_API_KEY is not configured for audio transcription.');
  }

  const model = sanitizeText(
    process.env.DEEPSEEK_AUDIO_MODEL ?? process.env.DEEPSEEK_V3_MODEL ?? process.env.DEEPSEEK_TEXT_MODEL ?? 'deepseek-chat'
  );
  const audioFormat = inferAudioFormatFromMimeType(mimeType);
  const audioBase64 = audioBuffer.toString('base64');

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${deepseekKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model || 'deepseek-chat',
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: 'Transcribe spoken audio to plain text only. Do not return JSON.'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Transcribe this audio.${languageHint ? ` Language hint: ${languageHint}.` : ''} Return only transcript text.`
            },
            {
              type: 'input_audio',
              input_audio: {
                data: audioBase64,
                format: audioFormat
              }
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = sanitizeText(await response.text());
    throw new Error(
      `DeepSeek audio transcription unavailable (${response.status}${errorText ? `: ${errorText}` : ''}).`
    );
  }

  const payload = (await response.json()) as DeepseekChatCompletionResponse;
  const content = payload.choices?.[0]?.message?.content;
  const transcript = typeof content === 'string' ? sanitizeText(content) : '';
  if (!transcript) {
    throw new Error('DeepSeek audio transcription returned an empty result.');
  }

  return transcript;
}

export async function transcribeAudioBase64(rawBase64: string, rawMimeType: unknown, rawLanguage: unknown): Promise<string> {
  const mimeType = normalizeMimeType(rawMimeType);
  const languageHint = typeof rawLanguage === 'string' ? sanitizeText(rawLanguage).toLowerCase() : '';
  const audioBuffer = decodeBase64Audio(rawBase64);
  const errors: string[] = [];

  if (process.env.DEEPSEEK_API_KEY) {
    try {
      return await transcribeWithDeepseek(audioBuffer, mimeType, languageHint);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'DeepSeek transcription failed.');
    }
  }

  if (process.env.OPENAI_API_KEY) {
    try {
      return await transcribeWithOpenAi(audioBuffer, mimeType, languageHint);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'OpenAI transcription failed.');
    }
  }

  if (!errors.length) {
    throw new Error('No audio transcription provider is configured. Set DEEPSEEK_API_KEY or OPENAI_API_KEY.');
  }

  throw new Error(`Audio transcription failed. ${errors.join(' | ')}`);
}
