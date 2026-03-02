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

## Document ingestion API

### POST `/api/documents/ingest`

`multipart/form-data` with:
- `document`: file (required)
- `source`: string (optional)

Supported file extensions:
- `.txt`, `.md`, `.json`, `.csv`, `.tsv`
- `.ts`, `.tsx`, `.js`, `.jsx`
- `.sql`, `.html`, `.css`

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
