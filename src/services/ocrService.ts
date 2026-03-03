import { createWorker } from 'tesseract.js';
import { sanitizeText } from './serviceUtils';

const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS ?? 30000);

// Support multiple languages for better recognition in Cebu area
// 'eng' = English, 'fil' = Filipino (similar to Cebuano)
const OCR_LANGUAGES = ['eng', 'fil'].join('+');
type OcrWorker = Awaited<ReturnType<typeof createWorker>>;
let workerPromise: Promise<OcrWorker> | null = null;
let cleanupHookRegistered = false;

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

  const worker = await getWorker();

  try {
    const result = await withTimeout(worker.recognize(imageBuffer), OCR_TIMEOUT_MS);
    const rawText = result?.data?.text ?? '';
    return sanitizeText(rawText);
  } catch (error) {
    if (error instanceof Error && /timed out/i.test(error.message)) {
      await resetWorker();
    }
    throw error;
  }
}

async function getWorker(): Promise<OcrWorker> {
  if (!workerPromise) {
    workerPromise = createWorker(OCR_LANGUAGES, 1, {
      logger: () => {
        // OCR progress is intentionally suppressed in API logs.
      }
    });
  }

  if (!cleanupHookRegistered) {
    cleanupHookRegistered = true;
    const cleanup = () => {
      void resetWorker();
    };
    process.once('beforeExit', cleanup);
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  }

  return workerPromise;
}

async function resetWorker(): Promise<void> {
  if (!workerPromise) {
    return;
  }

  try {
    const worker = await workerPromise;
    await worker.terminate();
  } catch {
    // ignore cleanup errors
  } finally {
    workerPromise = null;
  }
}

