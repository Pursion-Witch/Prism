import path from 'node:path';
import { query, withDbClient } from '../db';
import {
  extractProductsFromDocument,
  type ImportedProductDraftEntry,
  type ImportedProductEntry
} from './productImportService';
import { upsertCatalogProduct } from './productCatalogService';

export interface DocumentRecord {
  product_name: string;
  category: string;
  region: string;
  market_name: string;
  stall_name: string;
  brand_name: string | null;
  srp_price: number | null;
}

export interface DocumentIngestionResult {
  ingestion_id: string;
  filename: string;
  file_type: string;
  source: 'ai' | 'fallback';
  record_count: number;
  draft_count: number;
  rows_without_price: number;
  inserted_products: number;
  updated_products: number;
  payload: {
    filename: string;
    file_type: string;
    extracted_text: string;
    records: DocumentRecord[];
    drafts: ImportedProductDraftEntry[];
  };
}

const SUPPORTED_EXTENSIONS = new Set(['.txt', '.csv', '.json', '.md']);

function inferFileType(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported document type: ${extension || 'unknown'}. Use txt, csv, json, or md.`);
  }

  return extension.slice(1) || 'txt';
}

function toDocumentRecord(entry: ImportedProductEntry): DocumentRecord {
  return {
    product_name: entry.name,
    category: entry.category,
    region: entry.region,
    market_name: entry.market_name,
    stall_name: entry.stall_name,
    brand_name: entry.brand_name,
    srp_price: entry.srp_price
  };
}

export async function ingestDocument(
  filename: string,
  fileBuffer: Buffer,
  source: string | null
): Promise<DocumentIngestionResult> {
  const fileType = inferFileType(filename);
  const extractedText = fileBuffer.toString('utf8').trim();

  if (!extractedText) {
    throw new Error('Document is empty or unreadable as UTF-8 text.');
  }

  const { entries, drafts, source: parserSource } = await extractProductsFromDocument(extractedText);
  if (!entries.length) {
    throw new Error('No valid product rows were found in this document.');
  }

  const records = entries.map(toDocumentRecord);
  const rowsWithoutPrice = drafts.filter((draft) => draft.srp_price === null).length;

  return withDbClient(async (client) => {
    await client.query('BEGIN');

    try {
      const ingestionResult = await client.query<{ id: string }>(
        `
          INSERT INTO document_ingestions (filename, source, file_type, extracted_text, parsed_json)
          VALUES ($1, $2, $3, $4, $5::jsonb)
          RETURNING id
        `,
        [filename, source, fileType, extractedText, JSON.stringify({ source: parserSource, records, drafts })]
      );

      const ingestionId = ingestionResult.rows[0]?.id;
      if (!ingestionId) {
        throw new Error('Failed to create ingestion record.');
      }

      let insertedProducts = 0;
      let updatedProducts = 0;

      for (const entry of entries) {
        const productResult = await upsertCatalogProduct(
          client,
          {
            name: entry.name,
            category: entry.category,
            brandName: entry.brand_name,
            region: entry.region,
            marketName: entry.market_name,
            stallName: entry.stall_name,
            srpPrice: entry.srp_price,
            isProtected: false
          },
          { updateExisting: true }
        );

        if (productResult.action === 'inserted') {
          insertedProducts += 1;
        } else if (productResult.action === 'updated') {
          updatedProducts += 1;
        }

        await client.query(
          `
            INSERT INTO ingested_records (ingestion_id, product_name, category, region, srp_price, raw_record)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb)
          `,
          [ingestionId, entry.name, entry.category, entry.region, entry.srp_price, JSON.stringify(entry)]
        );
      }

      await client.query('COMMIT');

      return {
        ingestion_id: ingestionId,
        filename,
        file_type: fileType,
        source: parserSource,
        record_count: records.length,
        draft_count: drafts.length,
        rows_without_price: rowsWithoutPrice,
        inserted_products: insertedProducts,
        updated_products: updatedProducts,
        payload: {
          filename,
          file_type: fileType,
          extracted_text: extractedText,
          records,
          drafts
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
