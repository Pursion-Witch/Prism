import path from 'node:path';
import { query, withDbClient } from '../db';

export interface DocumentRecord {
  product_name: string;
  category: string | null;
  region: string | null;
  srp_price: number | null;
}

export interface DocumentIngestionResult {
  ingestion_id: string;
  filename: string;
  file_type: string;
  record_count: number;
  inserted_products: number;
  payload: {
    filename: string;
    file_type: string;
    extracted_text: string;
    records: DocumentRecord[];
  };
}

const SUPPORTED_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.json',
  '.csv',
  '.tsv',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.sql',
  '.html',
  '.css'
]);

function splitCsvLine(line: string, delimiter: ',' | '\t'): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      const isEscapedQuote = quoted && line[index + 1] === '"';
      if (isEscapedQuote) {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseTabularText(raw: string, delimiter: ',' | '\t'): Record<string, string>[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    return [];
  }

  const headers = splitCsvLine(lines[0], delimiter).map((header) => header.toLowerCase());
  const output: Record<string, string>[] = [];

  for (const line of lines.slice(1)) {
    const values = splitCsvLine(line, delimiter);
    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });

    output.push(row);
  }

  return output;
}

function sanitizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function pickStringField(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && sanitizeText(value)) {
      return sanitizeText(value);
    }
  }

  return '';
}

function pickNumericField(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (value === undefined || value === null || value === '') {
      continue;
    }

    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Number(parsed.toFixed(2));
    }
  }

  return null;
}

function normalizeRecord(row: Record<string, unknown>): DocumentRecord | null {
  const productName = pickStringField(row, ['product_name', 'name', 'product', 'item']);
  if (!productName) {
    return null;
  }

  return {
    product_name: productName,
    category: pickStringField(row, ['category', 'type']) || null,
    region: pickStringField(row, ['region', 'location', 'area']) || null,
    srp_price: pickNumericField(row, ['srp_price', 'price', 'amount', 'fair_market_value'])
  };
}

function inferRecordsFromText(raw: string): DocumentRecord[] {
  const lines = raw.split(/\r?\n/);
  return lines
    .map((line) => sanitizeText(line))
    .filter((line) => line.length > 0)
    .slice(0, 200)
    .map((line) => ({
      product_name: line.slice(0, 160),
      category: null,
      region: null,
      srp_price: null
    }));
}

function parseDocument(filename: string, fileBuffer: Buffer): { file_type: string; extracted_text: string; records: DocumentRecord[] } {
  const extension = path.extname(filename).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported document type: ${extension || 'unknown'}.`);
  }

  const extractedText = fileBuffer.toString('utf8');
  if (!sanitizeText(extractedText)) {
    throw new Error('Document is empty or unreadable as UTF-8 text.');
  }

  if (extension === '.json') {
    const payload = JSON.parse(extractedText) as unknown;
    const recordsSource = Array.isArray(payload)
      ? payload
      : typeof payload === 'object' && payload !== null && Array.isArray((payload as { records?: unknown }).records)
      ? (payload as { records: unknown[] }).records
      : [];

    const records = recordsSource
      .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null && !Array.isArray(row))
      .map(normalizeRecord)
      .filter((row): row is DocumentRecord => row !== null);

    return {
      file_type: extension.slice(1),
      extracted_text: extractedText,
      records: records.length ? records : inferRecordsFromText(extractedText)
    };
  }

  if (extension === '.csv' || extension === '.tsv') {
    const rows = parseTabularText(extractedText, extension === '.tsv' ? '\t' : ',');
    const records = rows.map(normalizeRecord).filter((row): row is DocumentRecord => row !== null);

    return {
      file_type: extension.slice(1),
      extracted_text: extractedText,
      records: records.length ? records : inferRecordsFromText(extractedText)
    };
  }

  return {
    file_type: extension.slice(1),
    extracted_text: extractedText,
    records: inferRecordsFromText(extractedText)
  };
}

export async function ingestDocument(
  filename: string,
  fileBuffer: Buffer,
  source: string | null
): Promise<DocumentIngestionResult> {
  const parsed = parseDocument(filename, fileBuffer);

  return withDbClient(async (client) => {
    await client.query('BEGIN');

    try {
      const ingestResult = await client.query<{ id: string }>(
        `
          INSERT INTO document_ingestions (filename, source, file_type, extracted_text, parsed_json)
          VALUES ($1, $2, $3, $4, $5::jsonb)
          RETURNING id
        `,
        [filename, source, parsed.file_type, parsed.extracted_text, JSON.stringify(parsed.records)]
      );

      const ingestionId = ingestResult.rows[0]?.id;
      if (!ingestionId) {
        throw new Error('Failed to create document ingestion record.');
      }

      let insertedProducts = 0;

      for (const record of parsed.records) {
        await client.query(
          `
            INSERT INTO ingested_records (ingestion_id, product_name, category, region, srp_price, raw_record)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb)
          `,
          [ingestionId, record.product_name, record.category, record.region, record.srp_price, JSON.stringify(record)]
        );

        await client.query(
          `
            INSERT INTO products (name, category, region, srp_price)
            VALUES ($1, $2, $3, $4)
          `,
          [record.product_name, record.category, record.region, record.srp_price]
        );

        insertedProducts += 1;
      }

      await client.query('COMMIT');

      return {
        ingestion_id: ingestionId,
        filename,
        file_type: parsed.file_type,
        record_count: parsed.records.length,
        inserted_products: insertedProducts,
        payload: {
          filename,
          file_type: parsed.file_type,
          extracted_text: parsed.extracted_text,
          records: parsed.records
        }
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function listDocumentIngestions(): Promise<
  Array<{
    id: string;
    filename: string;
    source: string | null;
    file_type: string;
    created_at: string;
    record_count: number;
  }>
> {
  const result = await query<{
    id: string;
    filename: string;
    source: string | null;
    file_type: string;
    created_at: string;
    record_count: string;
  }>(
    `
      SELECT
        di.id,
        di.filename,
        di.source,
        di.file_type,
        di.created_at,
        COUNT(ir.id)::text AS record_count
      FROM document_ingestions di
      LEFT JOIN ingested_records ir ON ir.ingestion_id = di.id
      GROUP BY di.id
      ORDER BY di.created_at DESC
    `
  );

  return result.rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    source: row.source,
    file_type: row.file_type,
    created_at: row.created_at,
    record_count: Number(row.record_count)
  }));
}
