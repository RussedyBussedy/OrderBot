# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OrderBot is a web-based document comparison tool for Blind Designs (a blind/shutter manufacturer). It compares customer orders against internal Blind IQ (BDO) orders to identify discrepancies using Google's Gemini AI to extract and analyze line items from PDF and image documents.

## Commands

### Backend (Cloud Run proxy)
```bash
npm start          # Run the Express server locally on port 8080
npm install        # Install dependencies
```

### Docker
```bash
docker build -t orderbot .
docker run -p 8080:8080 orderbot
```

There is no test runner, linter, or build step configured.

## Architecture

The project has two components:

**[index.js](index.js)** — Node.js/Express backend deployed on Google Cloud Run. Acts as a secure CORS proxy: receives requests from the frontend, retrieves the Gemini API key from Google Cloud Secret Manager (`projects/orderbot-2b212/secrets/gemini-api-key/versions/latest`), then forwards the request to the Gemini API. Features include:
- 10MB JSON payload limit with custom 413 error handler
- CORS whitelist (GitHub Pages, Google Canvas, SharePoint)
- Model allowlist validation (`ALLOWED_MODELS` array — update when adding new Gemini models)
- Rate limiting (30 req/min per IP via `express-rate-limit`)
- Secret cache with 60-minute TTL
- `/health` endpoint for Cloud Run readiness checks

**[index.html](index.html)** — Single-file frontend SPA (~2,400 lines). Contains all UI, state management, Firebase integration, and AI orchestration. Deployed statically (GitHub Pages or SharePoint). Key sections by line range:
- **Lines ~340–490**: Firebase init, global state, utility functions, file upload helpers
- **Lines ~490–680**: History search (Firestore query with `limit(200)`), batch comparison orchestration (`runAllComparisons`)
- **Lines ~680–925**: Core AI logic — `processSingleComparison()` builds the Gemini prompt (injecting guidelines + feedback examples from Firestore), sends via proxy with circuit-breaker retry (3 attempts, exponential backoff + jitter, 120s AbortController timeout), validates response structure
- **Lines ~925–1250**: Report rendering and user interaction
- **Lines ~1250–1460**: Feedback submission (enhanced via Flash model) and guideline management (consolidated via Flash model)
- **Lines ~1460–1960**: Property CRUD for Fabric, Motor, Tube (near-identical patterns — prime refactoring target)
- **Lines ~1760–1840**: `runPostAIValidations()` — post-AI checks: fabric width/turn, colour presence, control configuration, motor torque calculation

**External services:**
- **Gemini 2.5 Pro** (`gemini-2.5-pro`, temperature 0.1) — vision + structured JSON extraction
- **Firebase** (project: `orderbot-2b212`) — Firestore for comparisons, feedback, guidelines, and property tables; anonymous auth
- **Google Cloud Secret Manager** — stores Gemini API key, accessed only by the backend

## Data Flow

1. User uploads customer order + Blind IQ order files (up to 10 pairs)
2. Frontend loads guidelines and feedback examples from Firestore, encodes files to Base64
3. Frontend POSTs to Cloud Run proxy with files + structured prompt
4. Proxy validates model against allowlist, fetches API key from Secret Manager, forwards to Gemini API
5. Gemini returns structured JSON with per-line comparison results (MATCH / MISMATCH / OMISSION / NOTE)
6. Frontend validates response structure (hallucination guards: missing lineItems, count > 100, empty bdoOrderNumber)
7. Frontend runs post-AI validation (fabric colour checks, motor torque, mandatory controls)
8. Results rendered as interactive report; saved to `orderbot_comparisons` Firestore collection
9. User feedback saved to `orderbot_feedback` and injected into future AI prompts (learning system)

## Firestore Collections

| Collection | Purpose |
|---|---|
| `orderbot_comparisons` | Stored AI comparison results, searchable by order number |
| `orderbot_feedback` | User corrections injected into future AI prompts (queried with `orderBy('timestamp', 'desc'), limit(10)`) |
| `orderbot_guidelines` | Dynamic business rules added by users |
| `orderbot_fabric_properties` | Fabric specs used for post-AI colour validation |
| `orderbot_motor_properties` | Motor specs used for torque/control validation |
| `orderbot_tube_properties` | Tube specs |

## Key Implementation Details

- **Circuit breaker**: 3 retries with exponential backoff + jitter on 429/503/5xx responses; 120-second hard timeout via AbortController
- **Payload guard**: Frontend estimates payload size before sending; rejects > 10MB, warns > 9MB
- **Structured output**: Gemini is called with `responseMimeType: "application/json"` + `responseSchema` to enforce parseable responses
- **Hallucination guards**: Response validation checks for missing `lineItems` array, line item count > 100, empty `bdoOrderNumber`
- **Spec parsing**: Secondary spec lines use `|` and `=` delimiters (e.g., `Colour=White|Control=Left`)
- **Blind type exclusions**: Certain blind types skip colour validation (hardcoded list `BLIND_TYPE_EXCLUSIONS_FOR_COLOUR_CHECK`)
- **Motor torque formula**: `Torque = (fabricWeight + bottomBarWeight) × 9.81 × tubeRadius` — uses fabric weight from `fabric_properties` and tube diameter from `tube_properties`
- **Multi-pair batching**: Order pairs processed sequentially with automatic retry of failed pairs
- **Model allowlist**: Backend rejects models not in `ALLOWED_MODELS` — must be updated when new Gemini models are adopted
- **Guideline consolidation**: Uses Gemini Flash model to merge, de-duplicate, and resolve conflicts when users add new guidelines
