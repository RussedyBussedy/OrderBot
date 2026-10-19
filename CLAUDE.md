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
| `js/cost-report-console.js` | Admin-only "Cost report" view: Paul's settings for the Daily Cost Report (see below) |
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
| `orderbot_cost_report` | Daily Cost Report: `settings` (written by the Cost report view), `catalog` and `status` (written by the office PC) |

## Cost report console (Oct 2026)

Admin mode adds a third view, **Cost report** (`js/cost-report-console.js`), where Paul tunes the Daily Cost Report without touching the office PC. The report itself is `cost_report.py` (v1.1.0) on the office PC, not in this repo; it emails the 16:30 PDF. The spec is the Claude project doc `claude/daily-cost-report/orderbot-console-spec.md`. The contract below is shared with the PC, so don't change it from this side alone.
- **`orderbot_cost_report`**: the PC writes `catalog` (order types, blind and sundry types, defaults) and `status` (its last run); the page writes only `settings` (schema 1). A missing key means the PC's default, so only non-default blind and sundry entries are stored. `updatedAt` is `serverTimestamp()`; `updatedBy` is asked once and kept in localStorage `cr_name` ("Paul" by default). Recipients must be on `catalog.defaults.allowedRecipientDomains`.
- index.html loads the module with `import()` only in admin mode (`biq_admin`) and catches a failure, so a missing or broken module can't stop OrderBot. The module subscribes to Firestore only when the pill is clicked. The pill and the view are hidden by their own CSS rule, so capturers never see them, even without Tailwind.
- Any anonymous OrderBot client can write the collection, so the page shows Firestore data as text only (`textContent`, never `innerHTML`).
- Tests (jsdom, headless Chromium, and a round trip through `cost_report.py`'s own parsing) are in `tests.zip` of the "Cost report console 2026-10" package in `Document Converter/OrderBot reviews`, not in this repo.

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

## Comparison AI context (prompt v2.3, Oct 2026)

`processSingleComparison` (index.html) builds the prompt from `js/comparison-context.js` (pure, tested in node) plus the converter:
- **Corrections** (`orderbot_feedback`): `selectRelevantFeedback` + `formatCorrectionExamples` show the capturer's own words (`userExplanation`) and the cleaned AI rewrite. Before v2.3 only `enhancedExplanation` was used, which 47 of the first 63 corrections (July 2025) don't have, so they reached the AI as "undefined".
- **`BD_STANDARDS`**: what Blind Designs supplies when the customer is silent (White hardware, bar/cassette follow hardware, 5 mm size steps, control-drop formulas, Out of Warranty limits, venetian split/grouped, vertical chain colour = track, 107 mm Allusion, Urban rails, cellular White, System X cranks, master carriers by stack) and dealer name synonyms. It also names what follows from what the customer did state, so the critical-field rule doesn't flag it: the pin opposite a stated chain side, Linear Valance for a roller blind's valance whose style isn't named (403 of 520 valance lines in 2026 orders; not for venetian valances), and item letters shifted by Blind IQ's separate valance lines. Keep it in step with the converter rules above.
- **`NOT_SPECIFIED`** result (`RESULT_VALUES`): a field or specification the customer document doesn't mention at all is information, rendered grey "not on order", not counted as a flag or low confidence. Never for Paul's `CRITICAL_FIELDS` — the prompt says so and `applyConfidenceThresholds` turns any critical NOT_SPECIFIED back into OMISSION. Over half of the 13,679 flags in the first 841 comparisons were such values.
- **Converter reading**: `biqReadCustomerFile` (js/biq-converter-ui.js) runs each customer PDF through the Drawings tab's own layout detection (`biqDetectPdf` / `biqDetectXlsx`, shared with `loadPdf` / `loadXlsx`) and rule pipeline (`biqRunRulePipeline` — keep in step with `refresh()`), never the AI; `describeConverterReading` gives the AI the lines in Blind IQ names, options equal to the sheet default marked "(default)", and the converter's notes. Unrecognised layouts and images add nothing.
- `PROMPT_VERSION` is stored with each comparison (`pv`); see v2.4 below.

## Comparison AI: missed mistakes and noise (prompt v2.4, Oct 2026)

Every first check from July 2025 to October 2026 (16,511 orders) was joined with what changed on the BlindIQ order afterwards, and with the admin-error cases on checked orders. Two problems:
- **Missed mistakes were mostly customer values reported as exactly Blind IQ's value** ("read as Blind IQ"): handwritten 2720 read as 2700, "Opal" as "Bronze", widths written under sketch boxes read as drops (the sketch rule only said "above"), a header legend "(Steel Ball Chain)" taken as the row's value, a cassette colour given on the blind lines while Blind IQ carries the cassette as its own Valance line, "1350 x 2" (a pair) read as a drop.
- **Flagged mistakes were passed over** because about 1 flag in 90 led to a change: Blind IQ's 5 mm steps and shortened print, colour codes, QTY left blank, the pin that comes with the chain side, a range the colour decides.

What v2.4 does (A/B-tested against v2.3 on the real customer documents of 13 missed or ignored mistakes and the 8 earlier test pairs, with Blind IQ confirmations rebuilt as they stood at the check):
- **`READING_RULES`** (js/comparison-context.js) in Pass 1 and Pass 2: customer values read from the customer document on their own; confusable handwritten digits compared with the same writer's other digits; sketch widths above *or under* a box; values carried only by ditto marks/arrows; header legends are a column's options; "x 2" is a quantity; an order that only accepts a quote goes in specialInstructions. The sketch line in Pass 1's extraction principles says "above it or under it".
- **`BD_STANDARDS`** additions: a cassette/valance given as an option on the customer's blind lines pairs with Blind IQ's separate Valance line (a different colour is a MISMATCH there); "RC"/"LC" give the control side; a colour given for the chain itself ("Black chain", or a control-colour column that offers Steel Ball Chain as a choice) means the plastic chain, which matches the control colour (Russel), so Steel Ball Chain=Yes is then a MISMATCH. A mechanism colour alone and silence about the chain are NOT_SPECIFIED: 44% of 2026 chain rollers have a steel ball chain, concentrated in some dealers (2026 roller lines: Matheo 82% of 1,845, Color Blinds 76%, Level Line 94%), so it is often the dealer's standing choice.
- **Pass 2** no longer clears a flag on a critical field by agreeing with Blind IQ; the second look is kept beside the flag (`pass2`).
- **`js/comparison-checks.js`** (pure, tested in node): `applyDeterministicChecks(data, { catalogue })` turns formatting into MATCH, keeping the AI's result in `aiResult` and the rule in `autoMatched`: the same value after case, punctuation and Blind IQ's suffixes (never on "Not Specified" twice); Blind IQ's shortened print (location ≥ 8 characters, range/colour ≥ 12); colour codes ("129 White"); the 5 mm step from 300 mm up, not for made-to-the-mm products; QTY blank with Blind IQ 1; a valance's drop 0; the control side agreeing on roller-type blinds (Blind IQ Control 1 = left, Control 2 = right; one chain side with a pin opposite, or the intermediate/coupled bracket the customer named; a motor, crank or spring only when the customer says so; Dual ≠ Motor; not double rollers, venetians, verticals or shutters); venetian Grouped/Split by width; a range the customer left out when the converter's catalogue sells the customer's colour in only one live range (`biqCatalogueLookups` in js/biq-converter.js, via `BiqUI.biqComparisonCatalogue()`). An order that only accepts its own quote ("go ahead as per quote BDO669711") with no sizes on the customer's lines gets NOTE instead of OMISSION on every field (`data.quoteAccepted`). Replayed over the history: 29,161 of 349,295 flags (24,598 of 155,517 on critical fields) would have been matched; 129 of them (0.44%) were followed by a change on the order, against 0.7–1.8% for the flags left.
- **Second reading** (`SECOND_READING` in js/config.js): for handwritten or unclear orders the converter does not read, a customer-only Gemini call (`SECOND_READING_PROMPT`, no Blind IQ document in view) runs alongside Pass 1. Handwritten or unclear (Russel: only those, it costs about a third of a comparison) is decided from the files before any AI call by `needsSecondReading` / `customerFileLegibility` (js/comparison-checks.js, with pdf.js): a photo; a PDF page that paints a picture and has under 60 characters of typed text (a scan), or whose text is drawn invisibly over a picture (an OCR layer); 4,000+ curve segments on a page (pen strokes flattened by a tablet app; typed order forms have at most ~800); 10+ ink-annotation strokes (a signature is fewer); a PDF pdf.js cannot open. Typed PDFs, filled-in forms and spreadsheets are read once. On the A/B files all 10 handwritten orders were photos or text-less scans and all 11 typed ones ("as per quote" orders included) had 300+ characters of text. The result keeps why in `_secondReading.why`. `reconcileSecondReading` flags width, drop, qty or colour only where Pass 1 reported the customer value as exactly Blind IQ's and the second reading clearly differs (confidence ≥ 0.8, colour ≥ 0.85 with no word in common; sizes need the other dimension or the location to confirm the pairing, or a width/drop swap; readings under 300 mm and garbled answers are ignored). Shown as "2nd reading" with both readings.
- **`runComparisonPipeline`** (index.html): converter reading → [handwritten or unclear? second reading in parallel] → Pass 1 → Pass 2 → `reconcileSecondReading` → `applyDeterministicChecks` → `runPostAIValidations` → `applyConfidenceThresholds`. Fresh runs and retries share it.
- Still missed in the A/B test: handwriting the model reads as Blind IQ's value even on its own (1200 read as 1700, 560 as 860; the capturers read them the same way at first).
- `PROMPT_VERSION` 'v2.4'.

### Outdoor motors: the Zip X motor table (`js/outdoor-motors.js`, Oct 2026)

Russel: "zip x blinds should follow the specific zipx table to determine which Somfy motor to use". The table is the Outdoor Price List July 2026, page 14, "Maestria Motor for Zip X Blinds": two width × drop grids of the Maestria io torque (17 rpm), one for the 78 mm tube (135 mm cassette or none) and one for the 95 mm tube of the 165 mm cassette ("Full Cassette 165mm=Yes"); NA = no motor at that size. Ruling 3 (Russel, 23 Sep 2026) applies the same grids to Free Hang, Channel X and Wire X. A size between two lines is read at the next width and drop up (BDO652491: 5740 × 3690 on the 165 mm cassette → 6000 × 4000 → 25 Nm; it was made with 15 Nm and BDO658949 sent the 25 Nm motor free of charge; BDO653456 and BDO655012 were captured with 25 Nm and changed to 15 Nm).
- `validateOutdoorMotors(data)` runs last in `runPostAIValidations` for motorised Free Hang / Zip X / Channel X / Wire X lines: the Somfy Maestria motors on the order (sundries, one per unit) are paired strongest-first with the most demanding blinds, so an error means no fitting of those motors follows the table. `motorTableValidation`: error = a smaller motor than the table (red, counted as an alert and an issue); warning = the table has no motor at that size, or the size is beyond it (yellow; only when a Somfy motor is on the order); info = the table's motor, a bigger one, or no Somfy motor (ShawSmart, customer's own). For these lines the weight-based torque estimate (6.6 Nm for BDO652491) and its alert are dropped.
- Replayed over every motorised outdoor line on io orders since the io launch (19 May 2025): 225 lines — 130 as the table, 78 a bigger motor, 16 a smaller one (6 Zip X, 6 Free Hang, 3 Channel X, 1 Wire X). Tests: `biq-outdoor-motors.test.mjs`.

### BlindIQ Online orders: the exact check (Oct 2026)

A dealer's order captured in BlindIQ Online arrives as `BlindIQ_ExportedCO_<IQ Link ID>.pdf` ("Online Purchase Order: <ref>", "IQ Link ID"), printed in Blind IQ's own names with the options set on the order as "K=V|" lines and ZIQ codes under Sundries. Capturers re-key it (BDO669951 was not linked to its online order and has LH Dual where the order has Lh Chain). Russel agreed to an exact check, "but the rules and checks should be applied".
- `biqParseBiqOnline` / `biqNormalizeBiqOnline` (js/biq-converter.js): deterministic, columns by the centre of each header (values are centred; `biqDetectPdf` keeps text widths), item letters A–ZZ over several pages, options, notes, sundries resolved by stock code, the order message. The order is marked `exact` (with `exactOptions` = the options printed on it); `biqReadCustomerFile` returns it as printed, without the converter's rule pipeline. Also opens in the Drawings tab.
- The AI is told these are the customer's exact values (`describeConverterReading`, "THE CUSTOMER'S BLINDIQ ONLINE ORDER"); no second reading.
- `applyExactReading(result, readings)` (js/comparison-checks.js) runs after Pass 2 and before the rule checks: lines are paired by the customer's item letter when the sizes or blind type agree (Blind IQ's letters shift when it adds a Valance line), else by width, drop and blind type; each primary field's customer value becomes the order's and its result follows from comparing the exact values (empty on the order → NOT_SPECIFIED, missing in Blind IQ → OMISSION); options only where both sides have them (an option at the sheet default is not printed; the cassette Blind IQ carries on its own Valance line stays with the AI and the standards). The AI's reading stays in `aiCustomerValue` / `aiResult`; the report says where the value came from. The Element blind types renamed on 1 Aug 2026 compare equal. Then `applyDeterministicChecks` and the validations run as for any order (an empty Control 2 becomes the pin opposite the chain). Tests: `biq-biqonline-exact.test.mjs`.

### Perfect Fit: the clip size is the Gasket fix (Oct 2026)

A Perfect Fit blind sits in its own frame, clipped into the window's beading on brackets ("clips", "gaskets") sized to the bead depth. Russel: the Universal Frame "uses a 24mm clip internally but is not an option for the customer when ordering". Blind IQ's fixes: Gasket 12mm (18mm+foam), 18, 20, 22, 24, 30, 38mm (26 and 28 are not on Perfect Fit ranges), Gasket Skylight, Konnect, Universal Frame; every gasket line captured since June 2026 has Remove Universal Frame=Yes (Perfect Fit Roller stores it as "Remove Universa; Frame"). Louvolite's beading depth chart (Sales Resource, Product Installation Instructions/Perfect Fit) gives the bracket for a measured bead depth; the Universal frame leaflet (fixed in the recess or on the wall when the blind can't clip into the window, always 24 mm brackets) explains the Universal Frame. BDO643569 ("Perfect fit frame with 25mm clips") went out on a Universal Frame and was remade on Gasket 24mm; BDO635086, BDO637782 and BDO645474 were re-ordered on 18, 38 and 30 mm gaskets.
- **Comparison** (`perfectFitChecks` in js/comparison-checks.js, inside `applyDeterministicChecks`): the clip size comes from the customer's fix ("12mm White", "Gaskethe NB 18 mm", "Frame depth: 15mm"; "18mm + foam" = 12) or an option about clips, gaskets, the bead depth or the fix ("Clips=25mm clips", "Fix PF Only=18mm"; not "additional gaskets"). Same size as Blind IQ's Gasket → MATCH. A bead depth Blind IQ has no Gasket for, inside the chart's span of the Gasket on the order (Gasket N: N−2 to N+1 mm with foam and goal packing; Gasket 12mm (18mm+foam): 12–15 mm) → NOTE "confirm the bracket". A different Gasket size the AI passed, or the Universal Frame against any clip size (unless the customer wrote the Universal Frame) → MISMATCH by rule: `applyDeterministicChecks` now returns `flags` too, the field keeps the AI's result and reading (`aiResult`, `aiCustomerValue`) and carries `ruleFlag`; index.html stores `_ruleFlags` and shows "By rule: …". Reveal / Recess / Face against the Universal Frame → NOTE (the Universal frame is how a Perfect Fit goes on the reveal or face). Remove Universal Frame=Yes with a Gasket fix and the customer silent, or "No universal frame" / "do not send the Universal Frame" → MATCH (a bare "No" stays with the AI). Fix names now keep their sizes (`normFix`: "Ext Reveal" ≠ "Ext Reveal 130mm") and Blind IQ's shortened fix print matches only when it is cut inside a word ("Gasket 18m", "Universal Fra"; "Ext Face 80mm" ≠ "Ext Face 80mm (Waterfall)"). `BD_STANDARDS` tells the AI the same.
- Replayed with the deployed module over every comparison in Firestore (17,792, Aug 2025 – Oct 2026) against the previous version: only Perfect Fit lines change, plus one curtain line whose fix was Blind IQ's shortened "Stack Centre Sp". Of the 214 Perfect Fit lines, 34 fix flags became MATCH and 14 NOTE, and 26 option flags MATCH; flags on the fix and its options went from 104 to 32 (fixture `pf_history.json` in the tests). None of the cleared fixes was changed on the order afterwards (checked against BlindIQ on 11 Oct 2026). One new flag: BDO643569's Universal Frame. BDO662356 (30 mm gasket on Gasket 24mm, changed to 30 mm) stays flagged.
- **Converter** (`biqPerfectFitFix`, first in `biqApplyOptionDefaults`): a Perfect Fit line whose fix is unresolved or the Universal Frame, with a clip size in its fix wording, options or notes, gets that Gasket (a bead depth with exactly one Gasket on the chart's spans gets it with a "confirm"; 19, 21 and 23 mm fit two, 26–27 and 32+ none: noted for the capturer). A customer who writes the Universal Frame or Konnect keeps it. Every sized Gasket fix gets Remove Universal Frame=Yes once (a capturer's own change afterwards stays). Tests: `biq-perfect-fit.test.mjs`.

### Quarterly review (from January 2027)

Russel asked for a quarterly review of OrderBot and the converter. A scheduled task ("OrderBot quarterly review", Tuesdays in January, April, July and October at 12:51 SAST, on Russel's computer) reviews the quarter just ended the way the October 2026 review did: OrderBot's first checks joined with what changed on the BlindIQ order afterwards, admin errors and remakes, the customer documents of the misses, the converter's imports against the stored orders, catalogue and Sales Resource changes. It writes `Document Converter/OrderBot reviews/<year>-Q<n>.md` and the proposed changes as patches with tests in `<year>-Q<n>-changes/`; it never pushes to main or changes the live site, and a quarter whose report exists is skipped (the October 2026 review is `2026-Q3.md`). The regression tests are `orderbot-tests.zip` in that folder, not in this repository (their fixtures are business data): unzip it, `REPO=<this clone> ./setup.sh`, `bash run-all.sh`; baseline 1250 passed with the 25 known old failures (15 Oct 2026, with the wood venetian, TBD notes and double roller changes; the zip's README keeps the history). Its `analysis-tools/` keeps the October 2026 scripts and the method.

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
- **Upgrade Mechanism (Blind Guys)**: capturers kept System 40 1.5:1 on 15 of 79 such lines, the ones over 4 kg. Since 2026-10-10 it is kept above 4 kg (next section); lighter requests stay a note with an amber heads-up.
- **Dealer formats** added or repaired: Mathéo roller/designer/venetian/valance/Zip X sheets (cassette cell, wrapped controls, margin remarks, price-group product), Blind Guys aluminium venetian / vertical / outdoor / shutter sheets, Lifestyle descriptions and cassette rows, TBD's printed BlindIQ ids (type/range/colour/fix used; the Ctrl pair ignored), Curtain & Blind Workshop (header-anchored columns; Components = hardware colour, Casette / Cassette + Colour, Waterfall, a "Blind Type" fabric column; the double roller sheet; the motorised roller sheet; locations kept).
- **Not automated on purpose**: shutter tilt split, rail sizes outside the documented Urban case, capturer-specific choices (matching hardware to dark fabrics, Out of Warranty on narrow, long rollers) — they stay with the capturer. Vertical chain & cord, Urban 100 mm rails, the documented Out of Warranty cases and the 1.5:1 control drop came from Blind Designs' own documents on 2026-10-10 (next section).

Measured on the 2,380 stored items that every version could be replayed on: item fully correct 30.4% → 68.9% (fair rules; strict 30.0% → 58.3%), core fields 47.3% → 84.4%, options 48.1% → 76.2%; documents converting without an item-level problem 252 → 487 of 685. The node test files for each rule (`biq-*.test.mjs`, run against the catalogue refresh JSON) ship with the review package "OrderBot converter accuracy 2026-10-09", not in this repo.

OrderBot comparison history (`orderbot_comparisons`) against the same orders and BlindIQ's `OrderActivity` audit log: 74% of converted orders were compared, typically a few minutes after the order was first saved; on those orders about 90% of the converter's mistakes had already been corrected by then (most before the first save), the comparison prompted about 2.4% of the corrections, and only ~1.6% of its flags led to a change (over half its flags are values the customer document doesn't mention).

## Converter: rules from Blind Designs' own documents (Sales Resource, 2026-10-10)

Source: the Sales Resource `_AI-Index` (Blind / Shutter Price Lists July 2026, Roller System Selector V2.1, product pages and their owner rulings). A documented rule went in only when the stored orders follow it — each commit message carries the counts — and Russel made the four judgement calls on 10 Oct 2026. Anything assumed is noted on the line ("confirm" where the capturer should check). All of it lives in the shared refresh pipeline (mostly `biqApplyOptionDefaults`), so the UI, the replay and the server automation behave the same.

- **Out of Warranty** (`biqWarrantyReason`): a Roller System 40/55 blind more than 35 mm wider than its fabric's roll when the selector says the fabric turns only out of warranty or not at all (`BIQ_ROLL_FABRICS`; Designer fabrics are Do Not Turn, roll width from the colour's "NNNNmm"), or a blind over the price list's selling limit (`BIQ_SELL_LIMITS`: System 40 3200 × 3400, System 55 4000 × 4500, Vision 2200 × 2600, Allusion 3990 × 3000 and at least 750 wide). Decided again when the type, range, colour or size changes (`_oowSig`): an automatic tick is removed when the line comes back within the limits; otherwise a capturer's own tick or untick stays. Narrow, long rollers (System 40 / Double Roller under 600 mm wide, drop ≥ 2.9 × width) only get an amber warning (`biqNarrowLong`, Russel — capturers ticked 64 and left 41). Documented but not followed by any stored order, so not applied: the Double Roller limit and the wood venetian "thick line".
- **Vertical / Allusion Control** (required in BlindIQ since Aug 2026): a wand is Mono-command; a White or Black track (with or without fascia) gets that colour's Chain & Cord, noted "confirm"; Anodised / Anthracite tracks stay with the capturer (Russel). Decided once per line.
- **Roller hardware** (System 40/55): White when the order gives none ("White will be supplied if unspecified"); a stated cassette colour decides it when the hardware isn't stated (Silver cassette → Grey). `_hwFromOrder` marks hardware the order states, which is never replaced; TBC stays flagged. The bottom bar and the double-roller cassette follow the hardware when the sheet leaves them out (Mathéo empty / NA cells, the BD order form — `_barToHardware`).
- **System 40 1.5:1** (Blind Guys "Upgrade Mechanism"): kept only when the blind, or its intermediate partner that asks too, weighs over 4 kg — `biqRollerWeightKg` = the selector's fabric kg/m² (`BIQ_FABRIC_KG`, `BIQ_DESIGNER_KG`) × W × D + bottom bar kg/m × W. Lighter requests stay an amber heads-up; never set unasked (Russel). A 1.5:1 blind's automatic control drop is 80 % (half to even).
- **Valance returns**: a face fix without returns gets LH & RH (noted "confirm"; before the end caps are derived from the returns); reveal stays None; a "None" / "No" the order writes is kept (`cleanKeepNone`).
- **Retro venetians**: Standard slats with no valance colour on the order get "Aluminium: <slat colour>" (noted "confirm"); printed / perforated slats and Foiled trims are left alone. On the BD order form "Retro Blind" is a Retro Venetian and its Val Type cell is the valance colour.
- **Urban hinged shutters**: panels of 1201–1800 mm without a middle rail (not Tier on Tier) get Rail Size 100mm, noted with what the order said; decided again only when the drop or middle rail changes (`_railSig`). Flexi / Rigid scribe strips are not set on a new Urban shutter (spare part, ruling 23 Sep 2026): noted plus an amber warning.
- **Allusion**: an unresolved fabric takes "<name> 107mm" (90mm when the line says so); "RH / LH Cord" are Cord Right / Left.
- **System X crank** (Zip X, Channel X, Wire X): a crank line gets the sheet's only crank Control, Silver Crank 8:1; Free Hang (five crank colours) stays as ordered.
- **Curtains**: a "Quiet …" master carrier becomes the plain part when the track's sheet has no Quiet version; Butt Arm Kit ↔ Single Butt Arm follow the stack (two-way → kit, one-way → single). TBD's double-track "Runner Type and Spacing (Front / Back Track)" fill the one key (front value; a different back value is noted); a Crank Handle value the line's sheet offers is set as the option, not a sundry.
- **Cellular**: headrail and bottom bar White when not given (price list); "Standard (Cord Lock)" is Std (Cordlock). Blind Guys Romashade / cellular "Control Type" + "Control Side" become Control 1 / 2; Stack → Stack Choice; Back Bar Colour → Back Bars.
- **Control drop fallback**: a line whose range doesn't resolve uses the formula every live range of its type shares (`biqTypeFormula`; Allusion and venetians 66 %), else 75 %; outdoor types 0.

Left out: the Double Roller 2500 × 2600 limit and the wood venetian "thick line" are documented, but no stored order follows them (0 of 12 and 0 of 41 lines marked); Zip X drops over 3000 mm are marked on 7 of 10 lines, but the brochure (3000) and the price list (3800) disagree. No change needed: Chain Tidy is already No unless asked; Steel Ball Chain has no documented rule (a dealer habit); the black chain on Anthracite 1.5:1 blinds is a factory substitution BlindIQ doesn't record. Open with Russel: shutter tilt above 1800 mm (Grouped when a middle rail splits the rod? grouped max 1800 or 2100?), Mathéo Smart Rail with Grey hardware, venetians exactly 600 mm wide, one crank handle per order, vertical chain colour on Anodised / Anthracite tracks. Measured on the same 2,380 items: item fully correct 68.9% → 73.2% (strict 58.3% → 61.9%), options 76.2% → 80.8%, control drop 96.3% → 97.2%; documents without an item-level problem 487 → 509 of 685; 96 items newly fully right, none broken. Tests: `biq-warranty.test.mjs`, `biq-documented-rules.test.mjs` in the review package.

## Converter: wood and retro venetians (Oct 2026)

Venne's feedback on Doornpoort Blinds 2656/2026 (BDO672621, a handwritten Element order form read by the AI, 13 Oct 2026): "lists the wooden valance as a separate item and does not pick up Classic". The AI read the handwriting correctly; the converter's mapping was wrong. With the same reading, main reproduces that day's import XML line for line: range 8888, control drop 765 (75 %), "Val Size=No" on every blind and a separate Valance line per blind. BlindIQ stored Classic, 673 (66 %), Val Size = width + 15 and no Valance lines.

- **IDs that aren't BlindIQ records are ignored** (`biqCatalogueHasId`, using the catalogue refresh's own id tables: `rangeBlindType`, `blindTypeNames`, `fixNames`, `controlNames`, `colourNames`). The mapping manager's "BlindIQ ID" box accepted any number. On 14 Oct 2026 the live `orderbot_biq_mappings` held placeholders: ranges "wood 50" -> 8888, "bd urban shutter" -> 8888, "cotton white" -> 7777, "" -> 5555; blind type "designer - group i" -> 8888.
  - "Wood 50" -> 8888 went out on 61 wood venetian lines of 19 converted orders between 15 Aug and 13 Oct, and every one of those lines was stored as Classic.
  - `biqResolveRange` and `biqResolve` (blind types, fixes, controls) skip such an id and try the next way of reading the wording, and return it as `bogus`.
  - `biqCollectWarnings` names each bad mapping once per order, so an admin can delete it.
  - The mapping manager marks these entries "not in BlindIQ" and refuses a typed ID BlindIQ doesn't have (assign box, Add row, bulk paste).
  - Nothing is checked until the catalogue refresh is imported. A brand-new BlindIQ item therefore needs a fresh catalogue import before it can be mapped by ID.
- **Wood venetian range from the slat wording** (`biqWoodRangeWording`), for Wood Venetian types only:
  - "Wood 50", "50mm Wood", "Wood", "Wooden", "Basswood", "Timber" (with words such as venetian / 50mm / std / classic) -> Classic.
  - "Wood Alloy" -> Wood Alloy Std Classic.
  - Woodgrain, faux, PVC and aluminium wording is left for the capturer.
  - This is TBD's rule (`BIQ_TBD_WOOD_RANGES`) applied to every layout. It runs before the global name map, unless the global map holds a real range of the same type for the wording (a deliberate mapping wins).
  - A wood venetian's control drop then follows Classic's [drop]*0.66.
- **The valance stays on the blind** (`biqFoldVenetianLine`, used by `biqStageInlineValances` and `biqExpandValances`). Wood and retro venetians carry their valance as their own options: Val Size (the valance width, free text) and Val Returns.
  - In 2026 orders, 7,631 of 7,635 wood venetian lines and 2,385 of 2,386 retro lines have a Val Size. The 131 wood venetian Valance lines (58 orders) were valances ordered on their own.
  - The dealer's wording is moved onto the blind's keys:
    - "Valance Size/Width/Length=Std" (or "Standard (15mm wider…)", a tick) -> Std;
    - a number -> that number;
    - "No" -> No;
    - returns "N" -> None, "LR" -> LH & RH;
    - Mitre -> Mitre Val LH / RH;
    - "Std" type and colour are consumed;
    - anything else goes to the notes.
  - It never becomes a separate Valance line. That had happened on 36 lines of 8 converted orders between 15 Aug and 13 Oct, plus TBD and Blind Guys staging.
  - Valance-only rows keep their own line.
- **Val Size default** (`biqVenetianValSize`, in `biqApplyOptionDefaults`):
  - When the order gives no Val Size, or "Std", it is the blind width + 15 mm. The BD order form prints "Valance Size (Std=width+15mm)", and 70 % of 2026 wood venetian valances (reveal and face alike) and 61–80 % of retro ones are exactly that.
  - The note says "Val Size Std = blind width + 15 mm", or "Val Size not on the order — blind width + 15 mm (standard): confirm".
  - Before this, the generic "free-text required -> No" default put "Val Size=No" (no valance) on 260 of 440 converted wood venetian lines between 15 Aug and 13 Oct. Capturers set every one by hand. That default now skips Val Size on these blinds.
  - These values are kept as they are:
    - a stated width (digits only, "1215mm" -> 1215);
    - a stated "No" (`_valSizeStated`: BD form, AI "Val Size" / "Valance Size", Blind Guys and TBD staging);
    - a retro venetian with Remove Valance = Yes.
  - The value is decided once per line. An automatic value follows a later change of the width, and a capturer's own value stays.
  - A stated width is put in BlindIQ's 5 mm steps, like the blind's own sizes (`biqRoundSizes`: ...1/...2 down, ...3/...4 up, noted). Every Val Size on the 2,053 wood and 743 retro venetian lines ordered since August 2026 is on a 5 mm step, and capturers rounded the Blind Guys sheets' 579 / 1508 / 1458.
- `BIQ_VALUE_SYNONYMS`: "N" -> None, "LR" / "L&R" -> LH & RH (the BD form's Valance Returns column), "Std" -> Standard.
- **Replay** of 49 typed customer documents (Blind Guys EWV/WAV sheets, BD POs, Mathéo, Lifestyle, CNBW), covering 226 venetian lines converted 17 Aug – 13 Oct, against what BlindIQ stored:
  - Val Size matched on 178 lines before and 221 after; no other field changed.
  - The 5 Val Size lines still off are the sheet's own figures: a valance shared by two blinds (2440 on a 1450 + 955 window, 1040 over a 455 + 460 pair) and one 2800 the capturer changed to 915.
  - Doornpoort 2656 and 2653, from the AI reading: 0 of 143 fields differ from BlindIQ (44 differed before), and no extra lines.
- Not changed:
  - The AI's own reading. On 2653/2026, "Chateaux White" was written across two rows and read as blank + "White".
  - The comparison's `BD_STANDARDS`, which still describes valances as separate Blind IQ lines (true for rollers). Telling it that venetians carry Val Size on the blind would be a prompt change (`PROMPT_VERSION`).
- Tests: `biq-wood-venetian.test.mjs` (58 checks) in `orderbot-tests.zip`. `biq-retired` now flags another type's range with "Basswood Traditional", because "Basswood Classic" is wood-slat wording.

## Converter: TBD purchase orders — notes and hand-keyed options (Oct 2026)

Russel, after talking to the capturers and Paul (14 Oct 2026): Total Blind Designs' converted orders arrive with a lot of superfluous notes. The 109 TBD orders converted from 12 Aug to 14 Oct 2026 (all Sharon's) were compared with what BlindIQ holds now: she deleted the imported order note on all 108 that had one, 276 of 278 line notes and all 49 sundry notes, and keyed several TBD options by hand. Everything below applies to TBD's "Online Purchase Order" PDFs only (`biqParseBdPo` / `biqNormalizeBdPo`, source `bdpo`); every other source behaves exactly as before.

- **Notes are filtered when the XML is written**, never on the order: `biqExportOrderNotes`, `biqExportItemNotes` (rules in `biqBdpoNoteIsInfo`) and `biqExportSundryNotes` feed `biqGenerateXML`; the in-app BlindIQ import preview and the printed preview use the order and item notes (sundry names still show there as the description). The order keeps every note, so the editor and the comparison (`describeConverterReading`) still see the motor linkage, TBD's options and the converter's checks; the item notes box shows "BlindIQ gets: …" when the two differ (looked up via `BiqConv` at run time).
  - The key rules apply only to notes the converter wrote from TBD's options (`it._bdpoGen`, filled by `biqNormalizeBdPo`): the dealer's own note and anything typed into the notes box always go, except a chain length that is now the control drop.
  - Left out: "Captured by …" and "FINAL MEASURED"; motor / adaptor / remote / charger notes (sundry lines; a "Not BD Supply" motor is the line's Lh/Rh Motor plus its adaptor kit); Joined To; TBD's copies of what the line holds, compared by value (Cassette, Fabric Insert, Colour, Cassette Fix, Stack, Control, Fullness, Mech Colour, For Blind naming the line's own location, word for word, any "Key: Value" equal to an option on the line); the converter's checked notes ("read as", "taken from colour … — confirm", "(confirm stock)", "Size in 5mm steps" — Sharon kept the converter's value on all 21); a resolved sundry's own name.
  - Kept: the dealer's own line notes, TBD options BlindIQ has no place for (tight sizes, Float Weights, Chain Tidy on a double roller, side / bottom channels, Carriage), the Out of Warranty reason (Sharon re-typed it as "PLEASE TURN FABRIC OUT OF WARRANTY." on BDO669420 D), anything typed into the notes, and the name of a sundry that didn't resolve.
- **Options Sharon keyed by hand** (`biqNormalizeBdPo` and its helpers): double rollers (`biqBdpoDoubleRoller`: the blockout family's range 734 / 611 / 917, no item colour, Blockout Fabric "<Block-out Range> <colour 1>", View Fabric "<Screen Range> <colour 2>", Mech Colour → Cassette Colour); three TBD option names (`biqBdpoSheetKey`, an allow-list: Top Board → Top Board (for Face Fix), 1 x Custom Angle Bend → 1 X Custom Angle Bend (need template), Magnetic Hold Down → Hold Downs Magnetic; only a value the sheet offers); a valance with a top board is Face fixed (5,933 of 6,185 stored); Motor Side → Control 1 Lh/Rh Motor on a curtain track whose controls name no motor yet (677 of 756 Curtain Somfy lines); a dealer note that says nothing but a chain length → the control drop on a chain-driven line (`biqBdpoChainNote`, 300–6000 mm; "Chain must be 1m off the floor" changes nothing); Cassette Fix fills an empty Fix, and a line still without a fix on a range that takes one is a problem ("fix is empty on the order").
- **Prices never land in Fix**: a money amount right of the Fix column is the price. Five-figure outdoor prices start more than 12 pt left of the "Price" header and came out as "Reveal 24,642.00" on 14 outdoor lines.
- Replayed over the 97 PDFs: order notes 95 → 0, line notes on 133 of 446 lines → 22, sundry notes 54 → 1; 33 values now import as Sharon stored them and none that was right before changes. Tests: `new-tests/biq-bdpo-notes.test.mjs` and `new-tests/ui-bdpo-notes.test.mjs` in `orderbot-tests.zip`.

## Converter: double rollers (Oct 2026)

Russel (14 Oct 2026): the capturers say double rollers are generally a problem on the converter. None of the 86 double rollers converted from 26 Jun to 13 Oct 2026 came through right: the range was Roller System 40's or blank on 61, both fabrics were missing on 49, and 58 had a single "Lh Chain" / "Lh Motor" (4.7 fields changed per blind). Project doc `orderbot-converter-double-rollers-2026-10`, items 1–8. Item 9, an exact parser for Blind Guys' UBL XML, is still to do.

- **How BlindIQ holds one** (type 28): one blind with two fabrics, the options Blockout Fabric and View Fabric. Its three ranges carry no colours; they are the price groups of the blockout fabric:
  - 611: Blockout, Duo Block, Surface Block, Edge Block;
  - 734: Texblock, Urban Block, Linen Block;
  - 917: Moscow FR, Didsbury Block.

  Each Blockout Fabric value is on exactly one range's sheet (`variantSheetIndex` 28|611 / 28|734 / 28|917); all three take the same View Fabrics. Controls: Lh/Rh Double Chain, Double Motor, Double Chain/Motor, Double Dual, Pin.
- **Fabrics and range** (`biqApplyDoubleRollers`, at the end of `biqReSplitFabrics`, every layout):
  - Both fabrics are found wherever the order wrote them: the options; texts a layout's parser kept (`_drTexts`, e.g. Mathéo's remark); "Texblock + 5 Screen" with "Mink / Dune Grey"; range + colour; the order's original wording.
  - Matched as whole words against the sheets' lists (`biqDoubleRollerFabricsIn`): "5Screen" = 5 Screen, "Text Block" / "TEX BLOCK" = Texblock, "Bd E " and "Blind" ignored, the longest name wins.
  - The range follows the blockout fabric and the item colour goes.
  - The order's wording is read the first time the line is a double roller. Afterwards only the two options count, plus a hand-keyed line's own range + colour while it has no blockout, so a capturer's fabric is never replaced. The range follows the blockout only when it is first read or changes; a range the capturer picks stays.
  - "Sheer" alone is an amber flag, never guessed.
- **Options a double roller doesn't have** become values or notes, never a red "will NOT import":
  - Mech / H/ware / Hardware Colour → Cassette Colour (Grey → Silver); the bottom bar follows where the order gives none.
  - Roll Type Front/Back "Standard" / "Waterfall" → the only value, Top Waterfall Bottom Standard, silently. Any other roll type → a note plus an amber flag.
  - Steel Ball Chain / Chain Tidy / Chain Colour → one line note each.
  - "<colour> cassette" in the line note sets Cassette Colour, once (BDO672392: Beige).
- **Motorised double rollers** (`biqApplyDoubleRollerMotors`, in `biqInferControls`). Russel, 15 Oct 2026: "Flag orange to confirm if customer wants motor on both, but extrapolate based on how many motors are on the order."
  - Wording on the order decides first. Both: Double Motor / Dual, "motor on both fabrics", "blockout and screen motorised". One: "chain/motor", "blockout motorised", "no motor on the screen", a chain side with a motor.
  - Then a count the line states ("2 x"). Then the motors left on the order once every other motorised line has its own: two per blind → both. A motor model named on the line says which motor, not how many.
  - Both → Double Dual for One Touch Dual motors, else Double Motor. One → Double Chain/Motor plus "BLOCKOUT TO BE MOTORISED" unless the order says which fabric; the note goes if the capturer changes the control.
  - Motors are never added or removed. The side comes from the wording ("RH Motor" in Control 1 is the right side). An amber flag says why while the control is still the converter's.
  - Decided once per line; a line with two drive sides waits for the capturer. Silent until the catalogue refresh is imported.
  - Motors vs their accessories: `biqIsMotorUnit`, checked against all 158 active sundries of the seven motor types (a resolved sundry by its BlindIQ name).
  - Stored orders since Oct 2025: Double Dual only with One Touch Dual motors; Double Dual / Double Motor carried two motors per blind (16 of 21), Double Chain/Motor one (16 of 24), and the blockout was the motorised fabric on 30 of 33 noted lines.
- **Layouts**:
  - Blind Guys DRB: Extras → a note. A note the sheet runs over rows ("Please use one Cassette across" / "all 3 blinds.", BDO672784) is one note on every row of the run, only when the upper note ends on a word no sentence ends with.
  - Mathéo: the remark's fabric, "Bd" prefixes, the chain column → "Chain: Steel" (nylon is standard), Cord Tidy → a note.
  - CNBW: GREY cassette → Silver (the cassette's Colour, else the Cassette cell, else Components); "Text Block", "10% Screen Blind"; the newer template (Motorized / Components / Cassette, the fix at the end of Colour 2); "Motorized Cassette" printed as one header.
  - Galaxy's quote (TBD software): fabric N takes colour N; the motor option.
  - TBD purchase order: the Motor option on a double roller; "Cassette End Cap: Full End Cap" isn't sent.
  - BD order form: Hardware colours the cassette and the bar.
- **AI path**:
  - The extraction prompt says a double roller is one blind with two fabric options. It also says that on the BD order form, a row with no size and no blind type under a double roller is its second fabric.
  - `biqMergeDoubleRollerRows` (AI path and BD order form) merges such a row into the blind above: top down, never two different drives. The row's notes and options go with it, and a/b/c letters are renumbered.
  - A hardware colour given without the cassette or bar: they follow the hardware.
- **Replay** of 45 customer files with double rollers, against BlindIQ (SVR01, 14–15 Oct): 81 double rollers with a final line.
  - Lines fully right 27 → 56.
  - Range 52 → 81, blockout 75 → 81, view 61 → 78, cassette 75 → 81, bar 72 → 77, Control 1 68 → 72, colour cleared 69 → 81.
  - What's left:
    - capturers' choices against the sheet: the insert on 665076, 670062 and 671439; 663035's fabrics and single chains;
    - Mathéo's "Smart Rail" bars (open with Russel);
    - BDO672292, where Sharon ordered Double Dual with two motors per blind. Russel's rule gives Double Chain/Motor with an amber flag (8 motors for 8 blinds).
  - The 104 other customer files (488 lines) and the 82 other lines in these files convert exactly as before. Every file settles on the first refresh.
- Tests: `new-tests/biq-double-roller.test.mjs` in `orderbot-tests.zip` (103 checks, 3 more with `TASKFILES_DIR`).
- Not done:
  - the UBL XML parser (item 9);
  - motor sundry wordings that don't resolve ("Lithium Ion" vs "Lithium", the adapter kit "1.1nm | 2nm | 3nm");
  - Extras on Blind Guys roller sheets.

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
