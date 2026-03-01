import { randomUUID } from 'node:crypto';
import type { QueryResult, QueryResultRow } from 'pg';
import type { AIAuditLogEntry, AIAuditSource, AuditMetadata } from '../types/realtime';

export interface AIAuditLogInput {
  productId: string;
  action: string;
  message: string;
  source: AIAuditSource;
  anomalyScore?: number;
  metadata?: AuditMetadata;
  timestamp?: Date;
}

export interface AIAuditQuery {
  limit?: number;
  productId?: string;
  action?: string;
  source?: AIAuditSource;
}

export type PostgresQueryFn = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: readonly unknown[]
) => Promise<QueryResult<T>>;

export type AuditPersister = (entry: AIAuditLogEntry) => Promise<void>;

function sanitizeTableName(tableName: string): string {
  const sanitized = tableName.trim().replace(/[^a-zA-Z0-9_]/g, '');
  if (!sanitized) {
    throw new Error('Invalid table name for AI audit persistence.');
  }
  return sanitized;
}

export function createPostgresAuditPersister(
  queryFn: PostgresQueryFn,
  tableName = 'ai_audit_log'
): AuditPersister {
  const safeTableName = sanitizeTableName(tableName);

  return async (entry: AIAuditLogEntry): Promise<void> => {
    const statement = `
      INSERT INTO ${safeTableName}
      (id, product_id, action, message, source, anomaly_score, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
    `;

    await queryFn(statement, [
      entry.id,
      entry.productId,
      entry.action,
      entry.message,
      entry.source,
      entry.anomalyScore ?? null,
      JSON.stringify(entry.metadata ?? {}),
      entry.timestamp.toISOString()
    ]);
  };
}

export interface AIAuditServiceOptions {
  maxEntries?: number;
  persister?: AuditPersister;
}

export class AIAuditService {
  private readonly maxEntries: number;

  private readonly records: AIAuditLogEntry[] = [];

  private readonly persister?: AuditPersister;

  constructor(options: AIAuditServiceOptions = {}) {
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 10_000));
    this.persister = options.persister;
  }

  async append(input: AIAuditLogInput): Promise<AIAuditLogEntry> {
    const timestamp = input.timestamp ?? new Date();
    const entry: AIAuditLogEntry = {
      id: randomUUID(),
      productId: input.productId,
      action: input.action,
      message: input.message,
      source: input.source,
      anomalyScore: input.anomalyScore,
      metadata: input.metadata,
      timestamp
    };

    this.records.push(entry);
    if (this.records.length > this.maxEntries) {
      const excess = this.records.length - this.maxEntries;
      this.records.splice(0, excess);
    }

    if (this.persister) {
      try {
        await this.persister(entry);
      } catch (error) {
        console.error('[ai-audit] failed to persist entry:', error);
      }
    }

    return entry;
  }

  query(params: AIAuditQuery = {}): AIAuditLogEntry[] {
    const limit = Math.max(1, Math.min(2_000, Math.floor(params.limit ?? 100)));
    const productId = params.productId?.trim();
    const action = params.action?.trim().toLowerCase();
    const source = params.source;

    const output: AIAuditLogEntry[] = [];

    for (let index = this.records.length - 1; index >= 0; index -= 1) {
      const entry = this.records[index];

      if (productId && entry.productId !== productId) {
        continue;
      }
      if (action && entry.action.toLowerCase() !== action) {
        continue;
      }
      if (source && entry.source !== source) {
        continue;
      }

      output.push(entry);
      if (output.length >= limit) {
        break;
      }
    }

    return output;
  }
}
