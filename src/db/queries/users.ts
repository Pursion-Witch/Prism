import { randomUUID } from 'node:crypto';
import { query } from '../index';
import type { CreateUserInput, UserRow } from '../types';

export async function getUserById(id: string): Promise<UserRow | null> {
  const result = await query<UserRow>(
    `
      SELECT id, email, name, created_at
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0] ?? null;
}

export async function createUser(input: CreateUserInput): Promise<UserRow> {
  const id = input.id ?? randomUUID();
  const createdAt = input.createdAt ?? new Date();

  const result = await query<UserRow>(
    `
      INSERT INTO users (id, email, name, created_at)
      VALUES ($1, $2, $3, $4)
      RETURNING id, email, name, created_at
    `,
    [id, input.email, input.name, createdAt]
  );

  return result.rows[0];
}
