import type { Request, Response } from 'express';
import { getUserById } from '../db/queries';
import { AppError } from '../errors/app-error';
import { requireNonEmptyString } from '../utils/validation';

export async function getUserByIdHandler(req: Request, res: Response): Promise<void> {
  const userId = requireNonEmptyString(req.params.id, 'id');
  const user = await getUserById(userId);

  if (!user) {
    throw new AppError(404, 'User not found.');
  }

  res.status(200).json({
    id: user.id,
    email: user.email,
    name: user.name,
    created_at: user.created_at.toISOString()
  });
}
