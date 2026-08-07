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
| `js/biq-converter.js` | Document converter core (pure, no DOM): parses Blind Guys xlsx / Mathéo PDF / BD forms / AI JSON → BlindIQ order + XML; name→ID resolution via `orderbot_biq_mappings` (Firestore) |
| `js/biq-converter-ui.js` | Converter UI (Drawings tab): drag-drop, preview, mappings manager |
| `js/biq-form-specs.js` | Converter seed mappings / extraction schema / form specs |
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
6. **One Touch Dual rule** (Paul, 2026-08-05) — a System 40 roller blind taking a One Touch Dual motor (1.1/2/3Nm family; thinner motor head) must be spec'd "LH DUAL"/"RH DUAL", NOT "LH Motor"/"RH Motor" (plain-motor spec → blind made too narrow); the reverse (DUAL spec, no One Touch Dual motors ordered) is also flagged
7. **Critical-field surfacing** (Paul, 2026-08-05) — mismatches/omissions on Product Type, Range, Colour, QTY, Width, Drop, Control 1/2 (`CRITICAL_FIELDS` in `js/constants.js`) get the strongest cell highlight (`.critical-cell`), a CRITICAL FIELD CHECK summary at the top of every report, and an end-of-run popup (`#critical-modal`) listing the affected line items per order
8. **Valance validation** (rules corrected 2026-08-06 after Sharon's cassette false alarms) — runs only when the customer order instructs valances on ALL blinds. A valance ordered AS PART OF THE BLIND (cassette blind, or a valance/cassette in the line's specifications) satisfies the requirement with NO size check — the factory sizes it to the blind. Only STANDALONE valance line items (linear / half round / pelmet — valance wording AND no blind-sized drop) are width-matched: they must be **10–15mm larger** than the blind (was wrongly 20–25mm, and cassette specs were wrongly size-parsed, e.g. "Sys 40" read as 40mm)

## Converter Rules (Drawings tab)

- **Motor/remote/accessory sundries resolve ONLY within the seven BlindIQ motor sundry types** (Russel 2026-08-07): Motors Somfy Rts, Motors Motion, Motors One Touch +, Motors One Touch Dual, Motors Somfy Zigbee, Motors Somfy Io, Motors Shawsmart. In BlindIQ the capturer picks the sundry TYPE first, then the item linked to it — so the item id + type must come from these lists. The "Motors …" records under type 13 "components motor" are factory component data, NOT orderable motor sundries, and are excluded from motor resolution entirely (`biqMotorSundryView`; all motorisation call sites pass `motorContext=true`). Historical note: the original Blind Guys bug (Sharon, Paul 2026-08-07) was ambiguity between a type-13 record and its orderable twin leaving the sundry blank so BlindIQ asked for a part number on every motorised line; an interim fix preferred the type-13 entries before Russel clarified the type model the same day.
- **Marketing tails are stripped before matching** — Blind Guys accessory column appends "(max width 4000mm) Available in white, black and grey" which no catalogue key carries.
- **"adaptor" spellings are canonicalized on both sides** (`adaptor/adapter/adpator/adpater`) because BlindIQ itself carries typo'd entries ("Sys 55 Motor Adpator Kit for Sonesse 40", "… Adpater … White/Black").
- **Colour-variant parts with no colour on the order default to WHITE** (Russel 2026-08-07): after a colour-ambiguous match, the resolver retries with " white" appended and accepts a unique hit, appending "— WHITE assumed (no colour on order)" to the sundry notes. An explicit colour in the text is never overridden — an explicit colour with no matching catalogue variant (e.g. grey) stays flagged for the operator.
- **Generalized matching rules** (Russel 2026-08-07, verified by sweeping all 502 items under the seven motor types + Nm/# spelling variants against the live Firestore catalogue — 502/502 resolve, 0 wrong parts, 0 type-13 leaks): torque/speed ratios canonicalize "15Nm/17" ↔ "15/17" on both sides; exact lookup also tries the name + " #" (dealers copy "#"-marked names without the marker); single-letter tokens (side L/R) kept with letter-boundary matching; the canon pass uses the same boundary token rules as pass 1 (a dropped "3" once collided "3/30" with the "40/30/28" charger); several keys naming the SAME item id are aliases, not ambiguity; and a minimal-superset tiebreak picks the entry that adds nothing beyond the dealer's text ("Mercure 3/30" beats "Wood Ven Mercure 3nm/30 Ext Receiver") — except in colour-only families, which the WHITE default handles.

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
