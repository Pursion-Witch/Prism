import multer, { MulterError } from 'multer';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { ingestDocument, listDocumentIngestions } from '../services/documentIngestionService';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES }
});

const router = Router();

function uploadErrorMessage(error: unknown): string {
  if (error instanceof MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return 'Document file is too large. Maximum upload size is 10MB.';
    }

    return 'Invalid document upload.';
  }

  return 'Invalid document upload.';
}

router.post('/ingest', (req: Request, res: Response, next: NextFunction) => {
  upload.single('document')(req, res, async (uploadError: unknown) => {
    if (uploadError) {
      return res.status(400).json({ message: uploadErrorMessage(uploadError) });
    }

    try {
      if (!req.file || !req.file.buffer?.length) {
        return res.status(400).json({ message: 'Document file is required.' });
      }

      const sourceRaw = typeof req.body?.source === 'string' ? req.body.source.trim() : '';
      const source = sourceRaw.length ? sourceRaw : null;
      const result = await ingestDocument(req.file.originalname || 'upload.txt', req.file.buffer, source);

      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  });
});

router.get('/ingestions', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await listDocumentIngestions();
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

export default router;
