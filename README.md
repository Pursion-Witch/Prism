# PRISM

AI-powered price checker and regulator backend for PRISM PH.

## What is implemented

- Product price analysis APIs (`/api/analyze`, `/api/analyze-image`, admin APIs).
- Document ingestion pipeline: **document file -> extracted text -> normalized JSON records -> PostgreSQL**.
- PostgreSQL schema for products, logs, market indices, and ingestion audit trail.
- Docker compose stack with:
  - `postgres`
  - `api`
  - `etl-worker` (daily baseline sync)
  - optional `pgadmin` profile

## Image Scanner Model Flow

`/api/analyze-image` now uses a text-first pipeline:

1. Extract image text with DeepSeek VL and/or DeepSeek OCR.
2. Classify item name and price from extracted text.
3. Send text-derived item/price to the existing market analysis flow.

Useful environment variables:

- `DEEPSEEK_IMAGE_TEXT_MODE=both|vl-first|ocr-first|vl-only|ocr-only`
- `DEEPSEEK_VL_MODEL` (default: `deepseek-vl2`)
- `DEEPSEEK_OCR_MODEL` (default: `deepseek-ocr`)
- `DEEPSEEK_TEXT_MODEL`, `DEEPSEEK_TEXT_MODEL_PREFERENCE=r1|v3`
- `DEEPSEEK_R1_MODEL` (default: `deepseek-reasoner`)
- `DEEPSEEK_V3_MODEL` (default: `deepseek-chat`)

## Document ingestion API

### POST `/api/documents/ingest`

`multipart/form-data` with:
- `document`: file (required)
- `source`: string (optional)

Supported file extensions:
- `.txt`, `.csv`, `.json`, `.md`

Parsing behavior:
- AI parsing is attempted first (DeepSeek).
- If AI parsing fails, fallback parsing runs automatically.
- Parsed rows are treated as trusted user reporting and normalized to PRISM product fields.

Response includes:
- ingestion metadata
- extracted text
- normalized records inserted into `ingested_records`
- mirrored product inserts in `products`

### GET `/api/documents/ingestions`

Returns ingestion history and record counts.

## Run with Docker

```bash
docker compose up --build
```

API will be available at `http://localhost:3000`.
