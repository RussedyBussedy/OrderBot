# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

OrderBot is an AI-powered document comparison tool for Blind Designs (blind/shutter manufacturer). It compares customer order documents against Blind IQ documents using Google Gemini 3.8 Flash and validates extracted specifications against stored reference data.

## Architecture

```
Frontend (index.html + js/)             →    Backend proxy (index.js)
Hosted on GitHub Pages / SharePoint         Hosted on Google Cloud Run (africa-south1)
                                                ↓
                                        Google Gemini API (3.8 Flash)
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
  -d '{"model":"gemini-3.8-flash","payload":{"contents":[]}}'

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

- `gemini-3.8-flash` (GA) — every AI call since Oct 2026, set by two constants in `js/config.js`:
  - `COMPARISON_MODEL` — main order comparison, second-pass re-extraction, converter discernment
  - `EXTRACTION_MODEL` — converter document extraction, guideline consolidation, feedback enhancement
- Reverting = change a constant back (previously `gemini-2.5-pro` / `gemini-3-flash-preview`).
- Temperature: Gemini 3+ models run at their default (Google: lowering it can cause looping or degraded output). Call sites only pin the old low temperatures (0.1 / 0.2 / 0) for 2.x models, via `isGemini3()` in `js/config.js`, so reverting a constant also restores that model's original settings.
- History: `gemini-3.1-pro-preview` was tried for extraction in Apr 2026 and reverted for lower-quality comparisons — that run used temperature 0.1, against Google's Gemini 3 guidance.

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

## Converter: Attached Items (valances & motors on blind lines)

Customers order valances/motors ON the blind line; BlindIQ orders them separately (Russel 2026-08-07, comprehensive resolution across all formats):

- **Motors/remotes/accessories** → sundry lines under the seven motor sundry types (see Converter Rules above). Applied on every path incl. AI-extracted sundries (motor view first — a unique hit there IS a motor part — then one full-catalogue attempt).
- **Valances** → BlindIQ's own variant template decides, per product: if the options tab carries the key (wood venetians' Val Size/Val Returns/Mitre/Val Type, Retro's Valance and Bottom Type/Colour), it stays an option; otherwise `biqStageInlineValances` moves the data to `_valance` staging and `biqExpandValances` orders it as its OWN line under `Valance` (14) / `Element Valance` (27) — range from Linear/Half Round wording (sibling-product fallback when the range only exists on the other valance product), drop from the profile size, parent line cross-referenced ("Valance for this blind is line N — do not add it here").
- **Cassettes stay options** — roller 70mm open/closed cassette, Double Roller/Vision/RomaShade cassette colour, outdoor fascia/full cassette — via the existing template-aware `biqFoldCassette`. (Roller System 55's only cassette option is "Closed Cassette (Motor Only)".)
- **Valance width**: the doc's stated width wins; when none is usable it is auto-sized to blind width + 15mm with "width auto-sized: blind +15mm — confirm" in the notes (Russel 2026-08-07).
- **Standalone valance rows** in dealer docs (e.g. Lifestyle) become real Valance line items when a width is readable; otherwise they stay in order notes.
- Wired on every deterministic parser (Blind Guys roller/DRB incl. the full v8 valance column group + End Cap/LH/RH Side, BD order form, TBD as before, Lifestyle) and the AI path (extraction prompt instructs Valance Type/Colour/Width option keys). Unknown blind types are never touched — flagging handles them.

Shakedown fixes from the first live order (Breed J0000509-4, Russel 2026-08-07):

- **Valance-ONLY rows** (no blind type, no fabric, no drop, valance columns filled — "Spare Bathroom Valance only") are rebuilt IN PLACE as the valance product: no phantom roller, no extra line. The row's own Finished Width IS the valance width; a conflicting Valance Width cell is noted "doc Valance Width=N — confirm", never silently preferred.
- **Valance width cells must be purely numeric** to count: Blind Guys' dropdown text "Standard (15mm wider than blind width)" once digit-stripped to a 15mm valance. "Standard" wording (which matches our +15 auto-size exactly) is consumed silently; any other non-numeric wording rides to the notes.
- **Shared-bracket options use the blind type's OWN key name**: BlindIQ names it "Intermediate Bracket"+"Coupled Bracket" (live Roller System 40 id 25 and Roller System 55 id 12), "Intermediate/Coupled  Bracket" (double space sic — exists ONLY on the retired "Z Roller System 40" id 5), "Intermediate" (live Vision Blind id 30). `biqBracketOptionKey` resolves per spec, so the pairing engine's option always imports instead of flagging "not a valid option". `biqApplyBracketPairs` also **folds-and-cleans first**: a dealer's literal "Intermediate Bracket=Yes", or a stale row left after the blind type resolved to a different product, is moved onto the type's real key and the phantom removed (Yes carries; No/blank phantoms drop — absence = No). Pair detection recognises a Yes on ANY bracket-family key; a combined-key Yes with no other signal is treated as intermediate (independent drives — the safer geometry).

## Mappings: source of truth is the BlindIQ database

The Firestore `orderbot_biq_mappings` were originally a snapshot that predated BlindIQ's Dec-2025/Jan-2026 catalogue clean-up (retired types got a `Z ` prefix + hidden; the "Element …" generation took the classic names). That drift caused every phantom-option/wrong-id incident of Aug 2026. On 2026-08-07 the mappings were rebuilt from a read-only SQL extract of `BlindIQ_BlindDesigns` (svr01) — full reference in the Claude project doc `specs/blindiq-catalogue.md`, applied via the mapping manager's **Import mappings file** (merge semantics: `Object.assign` per category, nothing deleted). Key facts:

- Live ids: Roller System 40 = **25** (5 is the retired Z type), Wood Venetian = 24, Retro Venetian = 26, Vision Blind = 30, Valance = 14 (27 is Z Valance). "Element …" names remain as alias keys; display names follow BlindIQ's `BT_Description`.
- `sundries` values are objects `{sundry, type}` — an import file with plain-number values breaks `biqMotorSundryView`'s type filter.
- **Options are per type+RANGE** in BlindIQ (`MatrixTriggers` → `Matrix_Price_NN` sheets). Two mapping categories model this: `variantSheetIndex` (`'<typeId>|<rangeId>'` → matrix id) and `variantTemplateSheets` (matrix id → option list). `biqVariantSpec(mappings, blindTypeName, rangeName)` prefers the range's own sheet and falls back to the per-type union template; every item-level call site passes `it.range`. This is what stops a Linear valance being asked for Finials (Deco Rod's sheet), Fabric Insert (70mm Cassette sheets, where it defaults to "None" per Russel) or a Curtain Glide order being asked for ripple-tape fields.
- The pass-2/pass-3 SQL scripts (schema, catalogue, usage aggregates) are re-runnable any time BlindIQ's catalogue changes; regenerate the import file from the fresh extract rather than hand-editing Firestore.

## Converter: BlindIQ catalogue linkage checks (2026-10-09 refresh)

The 2026-10-09 SQL extract (`biq-catalogue-refresh-2026-10-09.json`, applied with **Import mappings file**) refreshes the existing categories and adds eight that carry BlindIQ's own links and retirements. They are declared empty in `BIQ_SEED_MAPPINGS` but are not mapping-manager tabs — regenerate them from SQL, never hand-edit. Every rule below that reads them stays silent until they are imported.

| Category | Shape | BlindIQ source |
|----------|-------|----------------|
| `rangeColours`, `rangeFixes` | rangeId → [ids]; `[]` = the range takes none | `Relate_Range_Colours`, `Relate_Range_Fixes` |
| `rangeBlindType` | rangeId → blindTypeId | `BlindRanges.BR_BlindType_Link` |
| `blindTypeHidden`, `rangeHidden`, `colourHidden` | id → 0/1 (1 = retired) | `BT_Hidden`, `BR_Hidden`, `CO_Hidden` |
| `sundryInactive` | sundryId → 0/1 (1 = inactive) | `Sundries.SY_Active` |
| `sizeWarnings` | blindTypeId → [{dim, op, v, level, msg}] | `BlindTypes` size-warning columns + `SizeWarnings` |

- **Ranges resolve within the blind type first** (`biqScopedRangeFamily`): "5 Screen" on Roller System 55 is its own "5 Screen / Aventus 5%", never Roller System 40's "5 Screen" through the global name map. A range that still resolves to another type's range is a problem.
- **Colours are per range** (`biqResolveColour(mappings, range, colour, blindType)`): resolved inside the range's own list first; a colour the range doesn't carry is a problem that lists the range's colours and where the colour is offered; a colour learned in the UI is saved as `range|colour` when the range resolves. A missing or unknown range is taken from a colour that exactly one live range of the type carries (`biqInferRangeFromColour`, noted "— confirm").
- **Colourless ranges** (Double Roller, bamboo, headrails, Roller Kit): the fabric colour lives in the options, so the item colour is cleared or moved into the matching option.
- **Fixes are per range**: curtain ranges take no item fix — Top / Face / Face Double go into the Top Fix / Face Fix / Double Face Fix / Other Fix? options; any other fix the range doesn't offer is a problem.
- **Retired** blind types, ranges and colours are problems; a retired range + colour is moved onto the type's live "Discontinued" range (`biqRemapRetiredRanges`) with an amber heads-up.
- **Sundries**: every lookup uses active, non-component records only (`biqOrderableSundryView`; motors keep `biqMotorSundryView`, now also active-only). An inactive or type-13 sundry on a line is a problem.
- **Size limits**: BlindIQ messages saying the blind cannot be made / cannot accommodate a motor are problems; the rest are advisories from `biqCollectWarnings` (amber in the UI, never blocking — the server automation only reads `biqCollectProblems`).
- **AI extraction prompt** lists `biqExtractionVocabulary`: live ranges per live blind type, in BlindIQ's spelling.

Independent of the import (same change set): bottom bar and cassette follow the stated hardware colour (`biqApplyHardwareColours`; Grey hardware → Silver), a cassette that is on gets Cassette End Cap = Full End Cap, a required option with exactly one legal value is filled, intermediate-bracket costing sits on the Rh-Intermediate blind whatever the line order (`biqReconcileIntermediateCosting`), Mathéo "Dual" drives map to LH/RH Dual, courier delivery defaults packing to Boxed, and customer order numbers are exported without spaces or dashes (`biqOrderNumberForBiq`).

## Converter: valance extrapolation (Breed follow-up, Russel 2026-08-07 pm)

- **"Type of Blind" is inherited from the blind the valance was ordered with**: the parent's resolved type ID maps to the valance sheet's vocabulary (`BIQ_TYPE_OF_BLIND_BY_ID` — "System 40" → id 25 → "Roller Blind"; the old name-regex missed dealer wordings). Valance-only rows use the sheet's Product header the same way.
- **"Return: Black" style line notes fill End Cap Colour** when the range's sheet carries that option, the field is empty and the colour is a real catalogue value — noted "End Cap Colour Black taken from line note".
- **LH/RH Side follow Val Returns** on sheets that carry them: the side with a return gets "Return End Cap", the other "End Cap" (the dominant pattern in real stored orders); derived values add "End caps derived from Val Returns — confirm". Explicit dealer values are never overridden.

## Converter: rules learned from real orders (2026-10 replay)

Method: the customer documents of every order OrderBot converted since June 2026 (task repository → `Tasks`/`Relate_Tasks_Orders`, `JO_Import_Flag = 2`, blindiq.net imports excluded) were run through the converter again and compared, item by item, with what BlindIQ finally stored. A rule only went in when the stored orders (and 2026 manual capture) back it; each commit message carries its counts. Fair-comparison exclusions: values today's catalogue can't produce (Cassette End Cap before 11 Aug 2026, option keys/values no longer on the range's sheet, a fix the range doesn't take), formula/hidden options, and control drops within 1 mm.

- **Sizes**: widths/drops read off an order round to BlindIQ's 5 mm steps (`biqRoundSizes`, ...1/...2 down, ...3/...4 up; shutters, Perfect Fit, outdoor and skylight products are made to the millimetre and untouched). Control drops evaluate the range formula and round **half to even** like .NET (`biqRoundHalfEven`); a length the order states — "Custom: 3640", "4480mm", "Custom 2.5" (metres) — wins (`biqStatedControlLength`). Three-point shutter sizes take the smallest figure with an amber "confirm".
- **Controls**: wood/retro venetians under 600 mm are Split, 600 mm+ Grouped, 35 mm Aluminium always Grouped when the order is silent (`biqApplyVenetianOperation`). One Touch Dual motors drive BlindIQ's LH Dual / RH Dual (`biqApplyOneTouchDual`, decided per line from the motor the line names, else from an order whose only motors are OT Dual). Twin control records (Stack Left 29/45, Stack Right 30/46, Wand 28/57, Lh Spring 186/187) export the id the item's own range lists (`biqResolveControlScoped`). Hinged shutters carry the hinge layout ("H L R") as Control 1 (`biqShutterHingeControl`). Intermediate brackets: a line that names its own shared side is complete as stated (no "no matching pair" problem — BlindIQ keeps the neighbour's drive); when an order has more Rh than Lh Intermediates, the next line of the same window (same type, location starting with the same word, plain pin on its left) becomes the partner with an amber "confirm" (`biqPairIntermediatePartners`, right in 37 of 45 Mathéo cases). Per-side BlindIQ names ("Lh Pin / Rh Chain") are read side by side.
- **Fixes**: dealer wordings F/Fix, R/Fix, T Fix, Special - Reveal are aliases; a Top fix on a range without Top but with Reveal becomes Reveal with a note (`biqRepairTopFix` — no live range offers Top).
- **Options**: comma-joined BlindIQ value lists are split (`biqSplitSpecValues`); a required option with one legal value takes it when the order's wording is contained in it (double roller "Standard" → Top Waterfall Bottom Standard); motorised outdoor blinds get Crank Handle = None; a 90mm vertical with no Track Colour gets White (noted); a fitted cassette drops Remove Bracket Covers and keeps Cassette End Cap = Full End Cap; hardware colours match letter for letter; -ible/-able, US spellings and a value followed by a remark match BlindIQ's value (noted); template leftovers the range's own sheet doesn't have are removed while they still hold the template default.
- **Colours / ranges**: a colour written without BlindIQ's roll-width suffix ("2050mm @") resolves within its range; "5% SCREEN" / "DUOSCREEN" read as 5 Screen / Duo Screen; a fabric that only one live range sells is read as a colour and the range follows; retired single colours move to their Discontinued twin (amber "confirm stock").
- **Upgrade Mechanism (Blind Guys)** is deliberately NOT set automatically — capturers kept System 40 1.5:1 on 15 of 79 such lines; it goes to the notes with an amber heads-up.
- **Dealer formats** added or repaired: Mathéo roller/designer/venetian/valance/Zip X sheets (cassette cell, wrapped controls, margin remarks, price-group product), Blind Guys aluminium venetian / vertical / outdoor / shutter sheets, Lifestyle descriptions and cassette rows, TBD's printed BlindIQ ids (type/range/colour/fix used; the Ctrl pair ignored), Curtain & Blind Workshop (header-anchored columns; Components = hardware colour, Casette / Cassette + Colour, Waterfall, a "Blind Type" fabric column; the double roller sheet; the motorised roller sheet; locations kept).
- **Not automated on purpose**: vertical chain & cord colour (left empty on most 2026 verticals), shutter rail size / tilt split, capturer-specific choices (0.8 control lengths, Out of Warranty, matching hardware to dark fabrics) — they stay with the capturer.

Measured on the 2,380 stored items that every version could be replayed on: item fully correct 30.4% → 68.9% (fair rules; strict 30.0% → 58.3%), core fields 47.3% → 84.4%, options 48.1% → 76.2%; documents converting without an item-level problem 252 → 487 of 685. The node test files for each rule (`biq-*.test.mjs`, run against the catalogue refresh JSON) ship with the review package "OrderBot converter accuracy 2026-10-09", not in this repo.

OrderBot comparison history (`orderbot_comparisons`) against the same orders and BlindIQ's `OrderActivity` audit log: 74% of converted orders were compared, typically a few minutes after the order was first saved; on those orders about 90% of the converter's mistakes had already been corrected by then (most before the first save), the comparison prompted about 2.4% of the corrections, and only ~1.6% of its flags led to a change (over half its flags are values the customer document doesn't mention).

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
