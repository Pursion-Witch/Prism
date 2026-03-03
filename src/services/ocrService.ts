import { createWorker } from 'tesseract.js';
import { sanitizeText } from './serviceUtils';

const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS ?? 25000);

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('OCR request timed out.')), timeoutMs);
    })
  ]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

export async function extractTextFromImageBuffer(imageBuffer: Buffer): Promise<string> {
  if (!imageBuffer || !imageBuffer.length) {
    return '';
  }

  const worker = await createWorker('eng', 1, {
    logger: () => {
      // OCR progress is intentionally suppressed in API logs.
    }
  });

  try {
    const result = await withTimeout(worker.recognize(imageBuffer), OCR_TIMEOUT_MS);
    const rawText = result?.data?.text ?? '';
    return sanitizeText(rawText);
  } finally {
    await worker.terminate();
  }
}

