# OrderBot — CLAUDE.md

## What This Is

OrderBot is an AI-powered document comparison tool for Blind Designs (blind/shutter manufacturer). It compares customer order documents against Blind IQ documents using Google Gemini 2.5-Pro and validates extracted specifications against stored reference data.

## Architecture

```
Frontend (index.html, ~2400 lines)     →    Backend proxy (index.js, ~103 lines)
Hosted on GitHub Pages / SharePoint         Hosted on Google Cloud Run (africa-south1)
                                                ↓
                                        Google Gemini API (2.5-Pro / 3-Flash)
Firebase Firestore (6 collections) ←————— Firebase SDK (client-side, anonymous auth)
```

All business logic lives in `index.html`. The backend is intentionally minimal.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Single-page app — all HTML, CSS, and JS |
| `index.js` | Express proxy server — forwards requests to Gemini API via Secret Manager |
| `package.json` | Only 2 dependencies: `express` and `@google-cloud/secret-manager` |
| `Dockerfile` | Cloud Run deployment (node:20-slim) |

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
- **Allowed CORS origins:** `russedybussedy.github.io`, `app.lab-pa.googleapis.com`, `blinddesignscoza.sharepoint.com`

## AI Models

- `gemini-2.5-pro` — main document comparison (high accuracy, lower speed)
- `gemini-3-flash-preview` — guideline consolidation and feedback enhancement (fast, lower cost)

## Critical Rules for Future Changes

### 1. One concern per commit
Never mix frontend and backend changes in the same commit. Never add a new dependency and restructure code simultaneously. The failed modularization (commit `ef4eea8`, reverted in `42b7a65`) did all of this at once and broke production.

### 2. Backend stays minimal
`index.js` is a proxy, not an application server. Do not add helmet, rate-limiting middleware, or server-side timeouts unless tested in isolation. These caused the previous failure.

### 3. No build tools (yet)
The frontend uses browser-native ES module imports (`<script type="module">`). No webpack, vite, or rollup. Keep it that way until a proper build pipeline is established and tested.

### 4. Extract, don't rewrite
When modularizing the frontend (Phase 4 in the improvement plan), move working functions into separate `.js` files — don't redesign them. Pure functions with no DOM dependencies are the safest to extract first.

### 5. Test before proceeding
Each change must be deployed and manually verified before the next change begins. The app must work end-to-end: upload → compare → view results → history search.

### 6. Firebase config exposure is intentional
The Firebase `apiKey` in `index.html` is a client-side API key (standard Firebase practice). It is restricted by Firebase security rules and allowed origins. Do not panic about it appearing in the source.

## Post-AI Validation Logic

After Gemini returns results, the frontend runs these validations locally:

1. **Fabric validation** — checks blind width/drop against fabric width; handles "can turn" and "out of warranty" cases
2. **Colour validation** — required for most blind types (exclusion list: element double roller, curtain glide curtain ripple, curtain somfy, curtain motion)
3. **Control validation** — specific blind types require chain/motor/dual keywords
4. **Dual control validation** — some blind types require both Control 1 and Control 2 populated
5. **Motor torque validation** — calculates required torque from dimensions + fabric weight + bar weight; validates against motor specs

## Improvement Phases (Planned)

See the planning document. Phases in priority order:
0. Foundation (toasts, accessibility, docs) ← **DONE**
1. Export & Reporting (print, CSV export)
2. History & Search (Firestore query optimization, date filter, pagination)
3. UI/UX Polish (responsive grid, skeleton loaders, file management)
4. Incremental Architecture (extract pure functions to JS files, carefully)
5. Analytics Dashboard (mismatch heatmap, comparison stats)
6. Security & Resilience (Firebase rules, error boundary, graceful disconnection)
7. Advanced Features (templates, batch re-compare, real-time updates)
