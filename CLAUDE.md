# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

OrderBot is an AI-powered document comparison tool for Blind Designs (blind/shutter manufacturer). It compares customer order documents against Blind IQ documents using Google Gemini 2.5-Pro and validates extracted specifications against stored reference data.

## Architecture

```
Frontend (index.html + js/)             →    Backend proxy (index.js)
Hosted on GitHub Pages / SharePoint         Hosted on Google Cloud Run (africa-south1)
                                                ↓
                                        Google Gemini API (2.5-Pro / 3-Flash)
Firebase Firestore (6 collections) ←————— Firebase SDK (client-side, anonymous auth)
```

All business logic lives in `index.html`. The backend is intentionally minimal — a stateless proxy that injects the Gemini API key from Secret Manager and forwards requests. It caches nothing except the API key in memory.

## Development Commands

```bash
# Install dependencies (backend only — frontend has no npm deps)
npm install

# Start backend locally
npm start                    # Runs on port 8080

# Test backend health
curl -X POST http://localhost:8080 \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-2.5-pro","payload":{"contents":[]}}'

# Deploy backend to Cloud Run
gcloud run deploy gemini-secure-proxy \
  --source . \
  --region africa-south1 \
  --project orderbot-2b212
```

There are no tests, linters, or build steps. The frontend is served as static files — open `index.html` directly or push to `main` for GitHub Pages.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Single-page app — all HTML, CSS, and JS |
| `index.js` | Express proxy — forwards requests to Gemini API via Secret Manager |
| `js/config.js` | Firebase config, `PROXY_API_URL`, `PROMPT_VERSION` |
| `js/constants.js` | Validation constants: blind type exclusion lists, `CACHE_TTL_MS` |
| `package.json` | 2 dependencies: `express` and `@google-cloud/secret-manager` |
| `Dockerfile` | Cloud Run deployment (node:20-slim, port 8080) |

## Frontend Module Pattern

The frontend uses browser-native ES modules (`<script type="module">`). No build tools.

```javascript
// CDN imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
// Local module imports
import { firebaseConfig, PROXY_API_URL, PROMPT_VERSION } from './js/config.js';
import { BLIND_TYPE_EXCLUSIONS_FOR_COLOUR_CHECK, ... } from './js/constants.js';
```

When extracting more modules to `js/`, follow this pattern: named exports only (`export const`), no default exports, no CommonJS.

## Backend Details

- **Secret Manager path:** `projects/orderbot-2b212/secrets/gemini-api-key/versions/latest`
- **JSON body limit:** 10MB (to handle base64-encoded document images)
- **Safety settings:** All 4 Gemini safety categories set to `BLOCK_NONE` server-side
- **CORS origins:** `russedybussedy.github.io`, `app.lab-pa.googleapis.com`, `blinddesignscoza.sharepoint.com`

## Firebase Collections

| Collection | Purpose |
|-----------|---------|
| `orderbot_comparisons` | Saved comparison results with full line item data |
| `orderbot_feedback` | User-submitted error corrections (used in AI prompt) |
| `orderbot_guidelines` | Consolidated business rules (used in AI prompt) |
| `orderbot_fabric_properties` | Fabric name, weight, width, canTurn |
| `orderbot_motor_properties` | Motor name, torque, blind type, adapter, accessories |
| `orderbot_tube_properties` | Blind type → tube diameter mapping |

## Deployment

- **Frontend:** Push `index.html` to the `main` branch on GitHub. It is served from GitHub Pages at `https://russedybussedy.github.io` and embedded in SharePoint.
- **Backend:** Deploy via `gcloud run deploy` or Cloud Run build trigger. The image is built from `Dockerfile`.

## AI Models

- `gemini-2.5-pro` — main document comparison (configured via `EXTRACTION_MODEL` in `js/config.js`)
- `gemini-3-flash-preview` — guideline consolidation and feedback enhancement (fast, lower cost)

## Critical Rules for Future Changes

### 1. One concern per commit
Never mix frontend and backend changes in the same commit. Never add a new dependency and restructure code simultaneously. The failed modularization (commit `ef4eea8`, reverted in `42b7a65`) did all of this at once and broke production.

### 2. Backend stays minimal
`index.js` is a proxy, not an application server. Do not add helmet, rate-limiting middleware, or server-side timeouts unless tested in isolation. These caused the previous failure.

### 3. No build tools (yet)
The frontend uses browser-native ES module imports (`<script type="module">`). No webpack, vite, or rollup. Keep it that way until a proper build pipeline is established and tested.

### 4. Extract, don't rewrite
When modularizing the frontend, move working functions into separate `.js` files — don't redesign them. Pure functions with no DOM dependencies are the safest to extract first.

### 5. Test before proceeding
Each change must be deployed and manually verified before the next change begins. The app must work end-to-end: upload → compare → view results → history search.

### 6. Firebase config exposure is intentional
The Firebase `apiKey` is a client-side API key (standard Firebase practice). It is restricted by Firebase security rules and allowed origins.

## Post-AI Validation Logic

After Gemini returns results, the frontend runs these validations locally:

1. **Fabric validation** — checks blind width/drop against fabric width; handles "can turn" and "out of warranty" cases
2. **Colour validation** — required for most blind types (exclusion list in `js/constants.js`)
3. **Control validation** — specific blind types require chain/motor/dual keywords
4. **Dual control validation** — some blind types require both Control 1 and Control 2 populated
5. **Motor torque validation** — calculates required torque from dimensions + fabric weight + bar weight; validates against motor specs

## Improvement Phases (Planned)

See the planning document. Phases in priority order:
0. Foundation (toasts, accessibility, docs) — **DONE**
1. Export & Reporting (print, CSV export)
2. History & Search (Firestore query optimization, date filter, pagination)
3. UI/UX Polish (responsive grid, skeleton loaders, file management)
4. Incremental Architecture (extract pure functions to JS files, carefully)
5. Analytics Dashboard (mismatch heatmap, comparison stats)
6. Security & Resilience (Firebase rules, error boundary, graceful disconnection)
7. Advanced Features (templates, batch re-compare, real-time updates)
