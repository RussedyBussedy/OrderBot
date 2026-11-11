# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

OrderBot is an AI-powered document comparison tool for Blind Designs (blind/shutter manufacturer). It compares customer order documents against Blind IQ documents using Google Gemini 3.8 Flash and validates extracted specifications against stored reference data.

## Documentation

Human-readable docs live in `docs/` (start at `docs/README.md`), and `CONTRIBUTING.md` describes the branch → pull request → merge workflow. When a change alters behaviour, a rule, a data shape or a deployment step, update the matching `docs/` page in the same pull request. This file stays the agent-facing summary and rule log.

## Architecture

```
Frontend (index.html + js/)             →    Backend proxy (index.js)
Hosted on GitHub Pages / SharePoint         Hosted on Google Cloud Run (africa-south1)
                                                ↓
                                        Google Gemini API (3.8 Flash)
Firebase Firestore (9 collections) ←————— Firebase SDK (client-side, anonymous auth)
```

The comparison flow and most of the UI live in `index.html`; the rule checks, prompt context, outdoor motor table and the converter live in `js/` modules. The backend is intentionally minimal — a stateless proxy that injects the Gemini API key from Secret Manager and forwards requests. It caches nothing except the API key in memory.

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

There are no tests in this repository (the regression package lives outside it, see `docs/testing.md`), and no linters or build steps. The frontend is served as static files — open `index.html` directly or push to `main` for GitHub Pages.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Single-page app — all HTML, CSS, and JS |
| `index.js` | Express proxy — forwards requests to Gemini API via Secret Manager |
| `js/config.js` | Firebase config, `PROXY_API_URL`, `PROMPT_VERSION`, `SECOND_READING`, `EXTRACTION_MODEL`, `COMPARISON_MODEL`, `isGemini3` |
| `js/constants.js` | Validation constants: blind type exclusion lists, `CRITICAL_FIELDS`, `CACHE_TTL_MS` |
| `js/comparison-context.js` | What the comparison AI is told (pure, tested in node): corrections, `BD_STANDARDS`, `READING_RULES`, `NOT_SPECIFIED_RULES`, `RESULT_VALUES`, the converter reading, the second-reading prompt |
| `js/comparison-checks.js` | Rule checks after the AI (pure, tested in node): `applyDeterministicChecks`, `applyExactReading`, `needsSecondReading`, `reconcileSecondReading` |
| `js/outdoor-motors.js` | The Zip X motor table and `validateOutdoorMotors` |
| `js/roller-selector.js` | The Roller System Selector's rules (pure, tested in node): the fabric list helpers (`fabricList`, `findFabric`; no fabric data), BlindIQ's roller motors (`MOTORS`, `rollerMotorOf`), `selectRollerSystem`, `chainCheck`, `validateRollerSystems` |
| `js/roller-selector-ui.js` | The "Roller check" view (everyone; loaded on first open) |
| `js/biq-converter.js` | Document converter core (pure, no DOM): parses Blind Guys xlsx / Mathéo PDF / BD forms / AI JSON → BlindIQ order + XML; name→ID resolution via `orderbot_biq_mappings` (Firestore); also holds `BIQ_SEED_MAPPINGS` and `BIQ_EXTRACTION_SCHEMA` |
| `js/biq-converter-ui.js` | Converter UI (the "BlindIQ XML converter" section of the Orders view, called "the Drawings tab" in older notes below; the header's Drawings pill is the bd-tools visualiser): drag-drop, preview, mappings manager |
| `js/biq-form-specs.js` | BD order-form specs: `BIQ_FORM_SPECS`, `biqDetectForm`, `biqParseSpecForm`, `biqElementGridOptions` |
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
| `orderbot_fabric_properties` | OrderBot's one fabric list: name, weight (kg/m²), roll width, canTurn, aliases — read by the comparison, the Roller check view and the converter |
| `orderbot_motor_properties` | Motor name, torque, blind type, adapter, accessories |
| `orderbot_tube_properties` | Blind type → tube diameter mapping |
| `orderbot_biq_mappings` | Converter mappings, one document per category (sharded above 700,000 characters); see `docs/converter/mappings-and-catalogue.md` |
| `orderbot_customer_formats` | Converter format profiles per customer (document `all`), written in admin mode on XML download |
| `orderbot_cost_report` | Daily Cost Report: `settings` (written by the Cost report view), `catalog` and `status` (written by the office PC) |

## Cost report console (Oct 2026)

Admin mode adds a third view, **Cost report** (`js/cost-report-console.js`), where Paul tunes the Daily Cost Report without touching the office PC. The report itself is `cost_report.py` on the office PC, not in this repo; from v1.3.0 it checks every 15 minutes (Mon–Sat 06:00–20:00) and emails the PDF once a day, at the first check after the send time on a send day (16:30 Mon–Fri unless Paul picks others); from v1.4.0 it also lists zero-charge orders, price changes against BlindIQ's list prices and, weekly, cost by product. The spec is the Claude project doc `claude/daily-cost-report/orderbot-console-spec.md`. The contract below is shared with the PC, so don't change it from this side alone.
- **`orderbot_cost_report`**: the PC writes `catalog` (order types, blind and sundry types, defaults) and `status` (its last run); the page writes only `settings` (schema 1). A missing key means the PC's default, so only non-default blind and sundry entries are stored. `updatedAt` is `serverTimestamp()`; `updatedBy` is asked once and kept in localStorage `cr_name` ("Paul" by default). Recipients must be on `catalog.defaults.allowedRecipientDomains`.
- **Send time and days** (optional keys, schema still 1): `settings.reportTime` ("HH:MM", 06:00–19:00) and `settings.reportDays` (`["mon", …]`, Mon–Sat). The Schedule panel only appears when the PC publishes `catalog.defaults.schedule` (`{earliest, latest, stepMinutes, days}`, v1.3.0+); until then the page keeps any saved values as they are. With a schedule, the status card shows "Sends at …" and warns when a send slot passed over an hour ago with no run that day; without one, when the last run is more than a working day old.
- **Report layout, price check, cost by product** (cost_report.py 1.4.0, optional keys, schema still 1). The report gained a zero-charge list (first by default), a price check against BlindIQ's own list prices, and a weekly cost-by-product page; Paul orders the sections. Contract: the Claude project doc `claude/daily-cost-report/orderbot-console-spec.md` (1.4 additions).
  - `settings.sectionOrder`: every key of `catalog.defaults.sectionOrder` (`internal, priceChanges, flagged, breakdown, trends, allOrders` by default) in Paul's order. The PC reads a partial or messy list as known keys in the order given (any case, each once), then the rest in default order; the page reads saved values the same way and always saves the full list it shows. `flagged` is always in, so it has no switch and is never a key in `settings.sections`; a key the page doesn't know shows as itself and keeps its place, with a switch only if `defaults.sections` has it.
  - `settings.sections` gains `priceChanges` and `trends` (booleans). `settings.priceTolerancePct` (0 to `defaults.priceCheck.maxTolerancePct`, 50; at most 2 decimals), `settings.priceShowIncreases` (boolean), `settings.trendsEvery` (`week` = the first report of each week, or `report`).
  - Each control appears only when the PC publishes its capability key: `defaults.sectionOrder` (the layout list replaces the three old section switches), `defaults.priceCheck` (`{tolerancePct, showIncreases, maxTolerancePct}`: the Price check panel), `defaults.trendsEvery` (the "how often" choice). Without them the page looks and saves as before, keeping any saved 1.4 values and section keys it doesn't show; the page live before keeps working with a 1.4.0 PC (it drops the 1.4 keys when it saves).
  - Status: `priceChanged` joins the summary line ("8 flagged of 120, 3 price changes, sent to Paul"); `zeroCharge`, `priceNotChecked` and `trendsIncluded` go in the details, and `priceCheckError` and `activityLogError` (BlindIQ's activity log, which names who raised a discount, couldn't be read) are warnings. Both are plain sentences the PC writes, never database messages. Counts only, never rand amounts.
  - With "Send even when nothing is flagged" off, a 1.4.0 PC still sends on days with zero-charge orders or price changes, but only when those sections are on; the help text under the switch says so when `defaults.sectionOrder` is published.
  - Tests are in `tests.zip` of the "Cost report layout 2026-10" package in `Document Converter/OrderBot reviews`.
- index.html loads the module with `import()` only in admin mode (`biq_admin`) and catches a failure, so a missing or broken module can't stop OrderBot. The module subscribes to Firestore only when the pill is clicked. The pill and the view are hidden by their own CSS rule, so capturers never see them, even without Tailwind.
- Any anonymous OrderBot client can write the collection, so the page shows Firestore data as text only (`textContent`, never `innerHTML`).
- Tests (jsdom, headless Chromium, and a round trip through `cost_report.py`'s own parsing) are in `tests.zip` of the "Cost report console 2026-10" package in `Document Converter/OrderBot reviews`, not in this repo; the send time and days tests are in the "Cost report schedule 2026-10" package there.

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
- `PROMPT_VERSION` is stored with each comparison (`promptVersion`); see v2.4 below.

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

Russel asked for a quarterly review of OrderBot and the converter. A scheduled task ("OrderBot quarterly review", Tuesdays in January, April, July and October at 12:51 SAST, on Russel's computer) reviews the quarter just ended the way the October 2026 review did: OrderBot's first checks joined with what changed on the BlindIQ order afterwards, admin errors and remakes, the customer documents of the misses, the converter's imports against the stored orders, catalogue and Sales Resource changes. It writes `Document Converter/OrderBot reviews/<year>-Q<n>.md` and the proposed changes as patches with tests in `<year>-Q<n>-changes/`; it never pushes to main or changes the live site, and a quarter whose report exists is skipped (the October 2026 review is `2026-Q3.md`). The regression tests are `orderbot-tests.zip` in that folder, not in this repository (their fixtures are business data): unzip it, `REPO=<this clone> ./setup.sh` (on Windows, directory junctions instead, as the zip's README says), `bash run-all.sh`. Baseline: 1,696 passed and 34 failed on Windows (10 Nov 2026, main 6b43526, with every change up to the sundry-part matching). The failures are the 25 known old ones plus 9 `biq-comparison-legibility` checks pdf.js can't run on Windows. The zip's README keeps the history, and the zip before the November tests is `orderbot-tests-2026-10-30.zip`. Its `analysis-tools/` keeps the October 2026 scripts and the method.

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
2. **Colour validation** — required for most blind types. Not for products BlindIQ has no colour for (checked against `Relate_Range_Colours`, 11 Nov 2026): the types in `BLIND_TYPE_EXCLUSIONS_FOR_COLOUR_CHECK` (`js/constants.js`: Double Roller Blind, Curtain Glide / Ripple / Somfy / Motion, Bamboo Roll-Up, Bamboo Roman) and ranges starting "Roman Headrail", "Roller Kit", "Vertical Headrail" or "Sliding Headrail" (tested in `runPostAIValidations`). Until Nov 2026 the list held "element double roller" and "curtain glide curtain ripple", so 529 of the 570 Colour Alerts of 11 Oct – 10 Nov 2026 were false (Curtain Ripple 199, Double Roller Blind 181, Roman Headrail 65, Bamboo Roll-Up 54, Curtain Glide 24, Bamboo Roman 6); replayed, 41 remain on 15 comparisons. Test: `biq-colour-alert.test.mjs` (28 checks, review package "Review fixes 2026-11")
3. **Control validation** — specific blind types require a drive: chain/motor/dual keywords; outdoor types (name contains "outdoor") crank/motor/spring instead (Paul and Venne, 8 Nov 2026: crank Free Hang lines were flagged "must have a 'chain', 'motor', or 'dual' control"; BlindIQ's outdoor ranges offer only Crank, Motor and Spring, plus Pin/Intermediate on Free Hang, and 1,837 of the 2,411 outdoor lines ordered Nov 2025 – Nov 2026 are crank or spring). Test: `biq-outdoor-controls.test.mjs` (57 checks, review package "Outdoor controls 2026-11")
4. **Dual control validation** — some blind types require both Control 1 and Control 2 populated (Outdoor Free Hang stays on the list: its ranges have pins and 1,765 of its 1,797 lines have both)
5. **Motor torque validation** — calculates required torque from dimensions + fabric weight + bar weight; validates against motor specs. An outdoor blind on a crank or spring gets no required torque (no motor to size; since 8 Nov 2026); motorised outdoor table blinds get the Zip X motor table instead (section 6)
6. **One Touch Dual rule** (Paul, 2026-08-05) — a System 40 roller blind taking a One Touch Dual motor (1.1/2/3Nm family; thinner motor head) must be spec'd "LH DUAL"/"RH DUAL", NOT "LH Motor"/"RH Motor" (plain-motor spec → blind made too narrow); the reverse (DUAL spec, no One Touch Dual motors ordered) is also flagged
7. **Critical-field surfacing** (Paul, 2026-08-05) — mismatches/omissions on Product Type, Range, Colour, QTY, Width, Drop, Control 1/2 (`CRITICAL_FIELDS` in `js/constants.js`) get the strongest cell highlight (`.critical-cell`), a CRITICAL FIELD CHECK summary at the top of every report, and an end-of-run popup (`#critical-modal`) listing the affected line items per order
8. **Valance validation** (rules corrected 2026-08-06 after Sharon's cassette false alarms) — runs only when the customer order instructs valances on ALL blinds. A valance ordered AS PART OF THE BLIND (cassette blind, or a valance/cassette in the line's specifications) satisfies the requirement with NO size check — the factory sizes it to the blind. Only STANDALONE valance line items (linear / half round / pelmet — valance wording AND no blind-sized drop) are width-matched: they must be **10–15mm larger** than the blind (was wrongly 20–25mm, and cassette specs were wrongly size-parsed, e.g. "Sys 40" read as 40mm)
9. **Roller System Selector** (Nov 2026, `js/roller-selector.js`) — chain (`chainValidation`) and Roller System 40/55 limits and motor tubes (`rollerValidation`); see the section below

## Roller System Selector: the Roller check view and System 40/55 flags (Nov 2026)

Russel (2 Nov 2026): check Sales Resource's `Calculation Tools/Roller Blinds/Roller system selector V2.1.xlsx`, put it in OrderBot as a tab for checking motors and chains, and make the comparison flag what's out of spec; then "one editable tidy list" of fabrics. Docs: `docs/roller-check.md`.
- **Workbook review.** The method is sound: weight = kg/m² × area + bar kg/m × width; torque = weight × 9.81 × tube radius + 20 %. The bugs, fixed in `Roller system selector V2.2.xlsx` beside V2.1 (V2.1 untouched; V2.2's "Changes V2.2" sheet lists fixes and open items; both recalculated in Excel with the same test blinds):
  - a "Too heavy …" motor showed ✓ OK;
  - the multi-line sheet's Sonesse 40 WF Zigbee 4Nm doesn't exist (3Nm);
  - RTS wire-free silently became 220V;
  - One Touch+ ignored 220V;
  - Zigbee 220V 6/9Nm and Optuo were missing;
  - System 55 chain over 11.5 kg still got the Easi-Lift chain;
  - a blank bottom bar read as over 11.5 kg, and a chain line with no fabric or bar got "Sys 55 Chain + Easi-Lift" even at 1000 × 1000;
  - the single sheet had no Smart Rail.
- **Russel's calls (2 Nov 2026).** The System 40 chain needs the 1.5:1 from 4 kg, although only 602 of 1,460 such blinds of 4–8 kg had it (Nov 2025 – Oct 2026); amber when missing. **5 Nov 2026:** red on a Roller System 40, because the capturer must spec it ("if it is in the 4-8kg limit but the order capturer has not spec'd a 1.5:1 control on a system 40 blind...it should be red"). Recounted then with the live fabric list: 624 of 1,515 lines had it (37 % at 4–5 kg, 62 % at 5–6, 22 of 23 over 6), so about 890 a year would have been red. Double rollers and Perfect Fit borrow the thresholds but have no 1.5:1 option, so they stay amber (`chainCheck`'s `can15`). The Lift Assisting Spring over 4.5 kg on System 55 is advice only, never a flag (11 of 85 had it). The motor list is BlindIQ's live roller motors, not the workbook's Motor Reference.
- **`MOTORS`.** The tubes each motor goes in follow 12 months of System 40/55 orders and BlindIQ's adaptor kits. System 55 only: Sonesse 40, Optuo, OT Dual 6Nm, Motion 40. Both: Sonesse 30 WF ("Sys 55 Adaptor Kit for Sonesse 30 Wire Free"). The rest are System 40. Torque is worked out on the tube the motor goes in.
  - `rollerMotorOf`: a known name (also behind "Motors … - "), else a wording with an Nm figure. Never kit/adaptor (any spelling), charger, remote, battery pack/tube, power supply, transformer, plate, drive, spring, or outdoor/curtain/cellular/tilt.
  - Over the 5,573 names in `data/sundry-names.json`: 53 motors (the 32 plus 21 older/component wordings), no accessories.
- **One fabric list** (Russel, 2 Nov 2026): `orderbot_fabric_properties` (the Fabric properties panel) is the only fabric data. It gains optional `aliases` (panel "Also known as", CSV 5th column split on `|`; an upload replaces every row, aliases included).
  - `getFabricProperties` returns `fabricList()` (js/roller-selector.js): a Map keyed by every name and alias (names win), adding `{ name, kg, roll, turn }`. A weight over 5 kg/m² is ignored (Firestore held "Perspective White Back 3%" at 450), and the panel refuses one.
  - `findFabric(list, range, colour)` returns the fabric with `match`:
    - `name` (name or alias, no trailing "#");
    - `print` (Blind IQ's shortened print, 12+ characters, unique prefix);
    - `design` (Designer Fab colour's design, with the colour's own "NNNNmm" roll; no lookbehind);
    - `part` (one side of " / ": weight yes, roll width no).
    It also accepts a bare Map of documents, the pre-Nov 2026 shape.
  - Used by sections 0 and 1, the Roller check view (via `window.OrderBotRollerDeps`, read again on "Try again") and the converter (`mappings.fabricList`, non-enumerable, set by `loadFabricList` in biq-converter-ui.js; `_oowSig` includes its size, so Out of Warranty is decided again when it arrives).
  - `BIQ_ROLL_FABRICS`, `BIQ_FABRIC_KG` and `BIQ_DESIGNER_KG` are gone: without the list, the converter's roll Out of Warranty and 1.5:1 weight rules are silent (`convert-cli.mjs` and the tests must pass it). The converter still reads a `part` match's roll for Out of Warranty, as its table did.
  - Firestore's values were kept over the workbook's (the workbook and converter repeated placeholder Designer weights). Louvolite's pages (roll widths only) agree with Firestore on 15 of 24 disputed widths and with the workbook on 9; Voile and Monet Sheer are 2000 mm (the converter had 3000).
- **Comparison** (`runPostAIValidations`):
  - **Section 0:** the line's bottom bar, also from packed options (`optionPairs`: "Hardware Colour = Mech Colour=White | Bottom Bar=…").
  - **Section 1:** not for verticals, panels or outdoor blinds (`notOnRollerRolls`). A `part` match has no roll, and Roller System 40/55 gets `ROLL_ALLOWANCE` (35 mm). The 19,170-comparison replay drops 187 old red alerts (132 outdoor, e.g. 119 Free Hang in Mode / Mode Zero / Dayscreen made as ordered; 34 verticals; 4 panels) and adds 30. Of 14 new ones checked, 10 were acted on (6 Out of Warranty, 4 narrowed).
  - **Section 3b:** `chainCheck`. The 1.5:1 is read from its option, packed options or a control; before, any "1.5" anywhere (even a blank "System 40 1.5:1 =") switched the warning off. Without it, 4–8 kg is red when `rollerSystemOf` names System 40 (`can15`; also "Element Roller Sys 40"), amber on the other roller types that fall back to System 40's thresholds. The red one goes in the critical issues box and the end-of-run popup, and makes the converter's row red. The spring counts as the option, a "Chain Spring" control, or a lift-assist sundry. System 55 chains over 8 kg are no longer red; the spring advice is `info` (blue, not an alert).
  - **Section 4b** (before the valances, so `validateOutdoorMotors` stays last): `validateRollerSystems` sets `rollerValidation`:
    - beyond the selling limit: amber, or blue with Out of Warranty=Yes;
    - System 55 over 11.5 kg: red;
    - motors on the wrong tube, blinds counted by quantity, only when every motorised line is Roller System 40/55: red when every roller motor is the wrong kind, else amber.
    Replay: 6 red, BDO668562 and BDO658467, both real and corrected later.
  - **`validateMotorDependencies`:** "Adpator"/"Adpater" kits count as adapter kits; 102 of 173 stored "only N adapter kits" alerts were these. The kit-name check (`normalise`, `\bad[ao]?p[a-z]*t[eo]r\b`) reads all four spellings on both sides. The merge wrote it through a Python string, so `\b` became a backspace and it matched nothing until the hotfix. Write regex escapes with the Edit tool or a raw string; a test checks that index.html holds no control characters. The controller check also searches the "other dependency" sundries, because Somfy remotes carry the model's name ("Situo 5 RTS Pure"), not "remote": since Aug 2026, 403 of 482 "No compatible controller" alerts (corrected table) had the motor's own remote on the order.
  - **No remote at all is one note** (Russel, 9 Nov 2026; the customer may already have remotes).
    - When the order has no remote, switch or hub (no Controller sundry, and no sundry carrying a remote name from any row's `controlOptions`), the lines that failed the controller check don't alert.
    - `data.remoteNote` says how many lines and which remotes they take. It's a blue banner, never in `data.motorValidation` (any object there counts as an alert), and the converter's check panel shows it as a plain line (`biqExtractCheckResults` → `note`).
    - A remote of another family still alerts on the line (BDO675414: Maestria Rts with Situo 5 IO).
    - Since Aug 2026 (621 orders): controller alerts 103 → 4, notes on 38 orders.
  - **The motor table** (`orderbot_motor_properties`), corrected on 2 Nov 2026 against BlindIQ's live sundries and 12 months of orders. 221 field edits on 144 of the 154 rows:
    - Excel fill-series slips: "Maestria Rts …/18–/21" → "/17", "Roll Up 28 Rts 1.1/29–/33" → "/28", a "Sonesse 41" kit;
    - advisory notes held as dependencies;
    - kits and remotes capturers order but the rows didn't list;
    - no remote required for wired motors.

    Plus 51 new rows marked `addedOn: "2026-11-02"`: One Touch+, Zigbee 220V 6/9 Nm, Sonesse 28 Zigbee Li-ion, Sonesse 30 on System 55, Double Roller Blind and Element Roller Sys 40. With the code fixes, motor line alerts since Aug 2026 fall from 1,094 to 201 (orders 211 → 93). Undo: `motor-properties-backup-2026-11-02.json` in the review package; the change list is beside it.
  - `info` flags aren't alerts in the report or the converter (`biqExtractCheckResults`). The critical box and modal escape what they show.
- **Deploying:** the aliases ("Linen Block", "Sheerweave 4500/4901 Fr", "Didsbury Block", "Bird Song", "Como") and a "10 Screen" row must be in Firestore first. The live code ignores aliases. Delete "Urban Block / Paris" only after the new code is live (the live code finds System 55 Urban Block by that exact name).
- **Tests** (review package "Roller check 2026-11", in `orderbot-tests.zip` since 10 Nov 2026): `new-tests/biq-roller-selector.test.mjs` (33 checks); `new-tests/_maps.mjs` attaches `fixtures/fabric_properties_2026-11-02.json` as `fabricList`; `tests/biq-converter.test.mjs` and `tests/biq-coupled-control.test.mjs` pass the module's exports into the code they lift from index.html. On main 7b22238 + this change: 1,485 passed, 34 failed (main alone 1,456 / 34); with the motor check fixes (Nov 2026), 1,488 / 34; on main 48794c8 with #31's `biq-chain-15.test.mjs` 1,516 / 34, and with the no-remote note 1,517 / 34. The 34 are the 25 known plus 9 `biq-comparison-legibility` checks that need pdf.js to open the samples; on Windows it can't.

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
- **Cassettes stay options** — roller 70mm open/closed cassette, Double Roller/Vision/RomaShade cassette colour, outdoor fascia/full cassette — via the template-aware `biqFoldCassette` (every wording since Oct 2026: see "70mm cassettes and fabric inserts" below). (Roller System 55's only cassette option is "Closed Cassette (Motor Only)".)
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
- **AI extraction prompt** lists `biqExtractionVocabulary`: live ranges per live blind type, in BlindIQ's spelling, and (Oct 2026) each type's option names and values.

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

- **Out of Warranty** (`biqWarrantyReason`): a Roller System 40/55 blind more than 35 mm wider than its fabric's roll when the fabric list says it turns only out of warranty or not at all (OrderBot's fabric list since Nov 2026, was `BIQ_ROLL_FABRICS`; Designer fabrics are Do Not Turn, roll width from the colour's "NNNNmm"), or a blind over the price list's selling limit (`BIQ_SELL_LIMITS`: System 40 3200 × 3400, System 55 4000 × 4500, Vision 2200 × 2600, Allusion 3990 × 3000 and at least 750 wide). Decided again when the type, range, colour or size changes (`_oowSig`): an automatic tick is removed when the line comes back within the limits; otherwise a capturer's own tick or untick stays. Narrow, long rollers (System 40 / Double Roller under 600 mm wide, drop ≥ 2.9 × width) only get an amber warning (`biqNarrowLong`, Russel — capturers ticked 64 and left 41). Documented but not followed by any stored order, so not applied: the Double Roller limit and the wood venetian "thick line".
- **Vertical / Allusion Control** (required in BlindIQ since Aug 2026): a wand is Mono-command; a White or Black track (with or without fascia) gets that colour's Chain & Cord, noted "confirm"; Anodised / Anthracite tracks stay with the capturer (Russel). Decided once per line.
- **Roller hardware** (System 40/55): White when the order gives none ("White will be supplied if unspecified"); a stated cassette colour decides it when the hardware isn't stated (Silver cassette → Grey). `_hwFromOrder` marks hardware the order states, which is never replaced; TBC stays flagged. The bottom bar and the double-roller cassette follow the hardware when the sheet leaves them out (Mathéo empty / NA cells, the BD order form — `_barToHardware`).
- **System 40 1.5:1** (Blind Guys "Upgrade Mechanism"): kept only when the blind, or its intermediate partner that asks too, weighs over 4 kg — `biqRollerWeightKg` = the fabric list's kg/m² (since Nov 2026; was `BIQ_FABRIC_KG`, `BIQ_DESIGNER_KG`) × W × D + bottom bar kg/m × W. Lighter requests stay an amber heads-up; never set unasked (Russel). A 1.5:1 blind's automatic control drop is 80 % (half to even).
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

Russel, after talking to the capturers and Paul (14 Oct 2026): Total Blind Designs' converted orders arrive with a lot of superfluous notes. The 109 TBD orders converted from 12 Aug to 14 Oct 2026 (all Sharon's) were compared with what BlindIQ holds now: she deleted the imported order note on all 108 that had one, 276 of 278 line notes and all 49 sundry notes, and keyed several TBD options by hand. Everything below applies to Finish Logic's "Online Purchase Order" PDFs only (`biqParseBdPo` / `biqNormalizeBdPo`, source `bdpo`: TBD's and every other dealer's — see "Finish Logic purchase orders" below); every other source behaves exactly as before (one later export rule covers every source: "notes for parts on sundry lines" below).

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

## Converter: Finish Logic purchase orders (Oct 2026)

Russel (16 Oct 2026) asked how OrderBot could handle the forms from Dean Hart's Finish Logic better. Finish Logic is Dean's quoting app (he runs Total Blind Designs); TBD's and Galaxy Blinds' "Online Purchase Order" PDFs come from it, and Dean is offering it to Blind Designs' other dealers. Project doc `orderbot-finish-logic-compatibility-2026-10`, section 1. Evidence: the 111 Finish Logic POs in task folders 431000–437200 (24 Aug – 16 Oct 2026: TBD's 102, Galaxy's 9) and what Sharon stored for them.

- **Every dealer's PO** (`biqParseBdPo`): the layout decides (the "Online Purchase Order:" banner, the Item … Price header), not the words "Total Blind Design".
  - A BlindIQ Online export prints the same banner but has an "IQ Link ID" label (a text item of its own; the words in a note don't count): it stays `biqParseBiqOnline`'s. A PO whose From is Blind Designs is never read as a dealer's, in either layout.
  - Customer: the Name in the From column, between the "From" and "To" labels (`biqBdpoDealer`; the export prints it a point above its label). A PO without one is still read, as TBD's if the page names TBD.
  - Order number: the dealer's job number at the start of the file name, by the dealer's own pattern (`BIQ_BDPO_JOB_RE`: Galaxy's L/H + 5 digits, stored as H17314[client] etc.; add a dealer's when one names its POs by job number), else the Quote Ref (TBD's file names carry none). `biqNormalizeBdPo(mappings, p, fileName)`; the source reads "Finish Logic purchase order (<dealer>)".
  - The TBD rules (the section above) apply to every dealer's PO.
- **An item row always starts a new blind**: a letter under Item and a quantity under QTY, even inside an option run with no closing "|". Finish Logic now prints its own warning straight after a line's options, and Task437134's PO (16 Oct) came through with 2 of its 4 Roman Panels. Its remarks stay on the line as "Finish Logic: …"; BlindIQ doesn't get them.
- **The Blind Total check**: the lines and SUNDRIES must add up to the PO's "Blind Total" within R1 (110 of the 111 do to the cent, one is a cent out). Otherwise it's a problem while the lines and sundries are still the ones read (`_poLine`, `_poSundry`, `_bdpoTotal`): adding, deleting or swapping a line or a sundry clears it. No check when a line has no price; a sundry row the parser can't read is caught by the sum.
- **Finish Logic's names for three ranges** (`BIQ_BDPO_RANGES`, `biqBdpoRange`; only when the printed range doesn't resolve for the blind type): Linear 65mm / 108mm → Linear Valance, Roman Panel Headrail (Price) → Roman Headrail, Ripple Glydea 60kg → Glydea 220v 60 Ripple. The line notes 'read as' for the capturer, after the dealer's own note; BlindIQ doesn't get it. An alias added later in the mapping manager simply takes over. `biqBdpoSheetKey` also takes the one sheet value that ends with the printed one (Galaxy's "Top Board=90mm" → Yes 90mm).
- **Crank Handle None** where the line's sheet requires a crank handle and the PO gives that line no crank or handle option at all (Sharon stored None on all 5 such lines). A handle the sheet doesn't offer, or one under another name ("Crank=…"), stays a problem. An amber heads-up when the PO has no handle anywhere, on a line or under SUNDRIES.
- **"Joined To=Blind N"** counts blinds, and valances are lines of their own: `_bdpoJoin` → `_joinWith`, and `biqApplyBracketPairs` pairs the partners an order names before the consecutive ones (the BDO670751 customer's E and G). An item letter with its kind ("Joined To=g (Coupled)", as asked of Dean) works too; a reference that names no line counts as none.
  - Only when both lines state sides that meet (one Rh Coupled, the other Lh Coupled): the bracket is costed and no control is touched. Anything else (a side not stated, two Rh Coupled, a capturer who has taken the coupling out, notes or not) is left to the consecutive pairing, exactly as before.
- **A motorised curtain track keeps White** on its colourless range (Curtain Somfy, Finish Logic POs only): Finish Logic prints the track colour on Movelite and Glydea lines, and Sharon kept White on all 9. Another colour (Black would import as 75, a venetian and roller colour), other curtain tracks and other sources are flagged as before.
- **Replay** of the 111 POs: TBD's 102 with nothing blocking (customer IDs, delivery and packing aside) 90 → 100; Galaxy's 9 read without AI, 8 with nothing blocking; TBD lines read 478 → 480. Still blocked, rightly: customer 7 (White Stone isn't on Sheerweave 4500 Fr), Task437134 b (2455 mm, the Roman Panel's maximum is 2440 mm), Galaxy L17233 c (120 mm drop). The 17 BlindIQ Online exports convert as before.
- Tests: `new-tests/biq-finish-logic.test.mjs` in `orderbot-tests.zip` (60 checks, 4 more with the POs staged in `TASKFILES_DIR`).
- Not done: what to ask Dean for and the BlindIQ IDs question (project doc sections 2 and 3); Russel's product question whether the 65 mm Linear valance is a Blind Designs product (BlindIQ has one Linear Valance, so the size is lost).
- Found in the review, not changed (every source): when `biqApplyCoupledPair` rewrites a pair whose sides aren't both stated, it reads the drive after overwriting the side it was on ("Lh Pin / Rh Chain" + "Lh Coupled / Rh Pin" loses the chain), and `biqDriveSide` doesn't count Dual as a drive. No real line hits it; the Finish Logic pairing never rewrites controls.

## Converter: a blind with no chain or motor is a red problem (Nov 2026)

From the 10 Nov 2026 review. BDO675515 (an e-mail read by the AI, imported by Venne on 9 Nov) was jobbed with KA / KB and NA / NB as "Lh Pin / Rh Intermediate" + "Lh Intermediate / Rh Pin": four blinds with no chain or motor, and nothing in the red list. The coupled-pair fault noted above does hit real orders (BDO675468's motor was put back by hand).
- **`biqLineHasNoDrive(mappings, items, i)`**, used by `biqCollectProblems`: a roller-type line (`biqRequiresDualControl`) whose two sides are set and are a pin, an intermediate or a coupled bracket on both. The problem reads "has no chain or motor (Lh Pin / Rh Intermediate): set the control on one side."
- **Coupled blinds** are driven by their partner, so the line passes when a blind of its coupled run has a drive (lines without controls in between, such as a valance, are skipped), when the partner a purchase order names does (`_joinWith`), or when the order has a driven coupled blind to spare (partners aren't always adjacent: BDO672429 has ten pairs interleaved). Otherwise: "…and neither has a blind it is coupled to: put the control on one of the pair."
- **Evidence.** Stored Roller System 40/55 and Vision lines, Aug – 10 Nov 2026: 9 lines on 6 orders have no drive, all XML imports, none of the 8,135 hand-captured lines. On the 521 import files of 14 Oct – 10 Nov it fires on 10 of 2,588 lines: BDO673966's six quantity-2 lines sent as "Lh Intermediate / Rh Intermediate" (Venne split each by hand) and BDO675515's two pairs.
- Nothing is blocked: the XML still downloads.
- **Not done:** the pairing itself (`biqApplyCoupledPair` reads the drive after overwriting it, `biqDriveSide` doesn't count Dual, and an intermediate pair with no stated side gets "Lh Intermediate" on both blinds).
- **Tests:** `new-tests/biq-no-drive.test.mjs` (27 checks), in the review package "Review fixes 2026-11". Suite 1,723 passed, the same 34 failures as main (1,696).

## Converter: 70mm cassettes and fabric inserts (Oct 2026)

Russel (28 Oct 2026): is the converter picking up 70mm cassettes and their fabric inserts from the customer orders? Project doc `orderbot-converter-cassettes-2026-10`. Of 740 Roller System 40 cassette blinds converted from 10 Jun to 28 Oct 2026, the layouts read exactly now give 496 of 540 right (92%); the AI path kept the cassette on 26 of 190. It lost them three ways: the AI wasn't told BlindIQ's option names, the converter dropped "Cassette=Black" / "Cassette=70mm" / "Fabric Insert=Yes (same fabric)" without a word, and it left a cassette in the notes ("Incl. White Cassette", "With Black Cassette").

- **The AI is given BlindIQ's option names** (`biqExtractionOptions` in `biqExtractionVocabulary`): per live blind type, the union of its live ranges' option sheets with their values (hidden and Discontinued ranges left out; 12 values at most per option, "No" left out; "… Percent", "Form …", "Total Length of …" and keys with a ";" left out). The prompt says to use exactly those names and values, only for what the document asks, never another product's option (Roller System 55's "Closed Cassette (Motor Only)", a double roller's "Cassette Colour" on a Roller System 40). The keys the converter's rules read keep their names on every product (Mech Colour; a valance's Valance Type / Colour / Width / Returns on a blind line; a double roller's Blockout Fabric / View Fabric); a choice that matches no option goes into the options in the document's own words, a remark into the notes. The prompt grows from 15,179 to 37,468 characters. `PROMPT_VERSION` is not bumped: it labels the comparison prompt, which is unchanged.
- **Where to look** (prompt): "Sys 40 70mm Cassette=<colour>" (Grey = Silver), "Yes" when no colour is given, never a guessed colour; the insert "Fabric Insert for 70mm Cassette=Yes"; a column holding both (Studio Blue 32's "Black with Duo Screen - Col: Charcoal fabric insert"), a priced sub-line ("› 70mm Cassette"), handwriting across the row, the order notes, the e-mail text; a general mention covers every roller blind; a shared cassette goes on each blind with the sentence in its notes; "No cassette" means none.
- **Every wording reaches the blind's own options** (`biqFoldCassette` / `biqReadCassette`, end of `biqFoldOptionSynonyms`, every layout): any non-sheet key with "cassette" (casette, cassete, "Cass Col") or one starting with "insert" / "inlay" ("Bottom Bar Fabric Insert" isn't one). A colour beats Yes; "70mm", "Open", "Sys 40 70mm Cassette", a tick or a length is Yes (the length noted); "Open 70mm White" or a value mentioning an insert is read for its colour and the insert, the words noted; words running into the insert are the insert's ("Charcoal insert": the cassette takes the hardware colour), and "Fabric insert + black cassette" is Black; "White PVC" / "PVC white" is the White PVC value, Charcoal is Anthracite; No / None / N/A / - means no cassette, and TBD's colour beside "Cassette=No" goes silently. The sheet's own usable value wins over a stray dealer colour (noted); a template default or a colour taken from the hardware (a double roller's, `_casFromHw`) gives way to the order's colour, noted. Vision / Romashade colours are "70mm <colour>" (`biqCassetteColour`, also in `biqApplyHardwareColours`). Stays red on the cassette option: two colours, "or", "not", undecided wording (`biqUnsure`: TBC, "not sure", "?"). Stays red on the line: a closed cassette Roller System 40 doesn't offer, even over an open one (noted; "not closed" / "closed not available" don't count), an open / 70mm / Sys 40 one on Roller System 55, a cassette or insert on a type without one.
- **Inserts**: any non-no wording is Yes, kept in a note ("Duo Screen Charcoal", Mathéo's "1800"); a Valance "70mm Cassette" line's Yes is "Yes (Please list fabric in note)". "No insert", "without fabric inlay", "insert: none" beside a cassette is the cassette without it; an undecided insert stays red; one declined, "separately" or "if possible" isn't set (`biqInsertAsked`). `biqCassetteInsertFromValue` sets the insert from the cassette's own cell before the value reading shortens it to the colour, once per wording (`_casInsSeen`), so a capturer's removal stays.
- **AI readings only — a cassette left in the notes** (`biqCassetteFromNotes` / `biqCassetteMention`, before `biqApplyHardwareColours`), each AI line read once (`it._casNoteChecked`): a line note's "<colour> cassette", "with / incl. / and … cassette", "70mm cassette", "one cassette for …" sets that line; an order note sets every roller line, only when the AI put a cassette on none, and only a sentence that names no blind (a location, "blinds 1 & 2", "1, 2", "#3", "A and B", a shared / one / long cassette) and no other product (double rollers, Vision, Romashades, venetians…). Skipped: negations with up to four words between ("do not include a cassette", "don't"), "cassette: none", closed / separate / existing / own cassettes, parts (end caps, brackets, spares), "Black cassette?"; "No. 3" doesn't end a sentence. An order-note cassette the capturer clears or sets to No stops the order note applying (`rejected`); a line that said no keeps it (`_casSaidNo`); double rollers keep their own rule; an insert in the same sentence is set. The line note and an amber warning say where it came from (`it._casFromNotes`).
- **A Mech Colour the AI gives is the order's** (`_hwFromOrder` in `biqAiResultToOrder`, only when the value isn't empty), White too, so "Cassette=Yes" beside it is a White cassette, not red. Without a hardware colour, "Yes" stays red: the cassette colour is never guessed (open decision for Russel, project doc item 1).
- **Amber "fabric insert but no 70mm cassette"** (`biqCollectWarnings`, the White PVC toggle counts as a cassette): TBD's BDO671259 PO item e (Sharon removed it), BDO669160 D, Galaxy's BDO673492 I–K.
- Replay of the 873 customer files of the review (599 read by exact layouts, on main after the Finish Logic change): identical XML lines, options and notes; the only change is that amber warning on BDO671259 e.
- **A/B test** (29 Oct 2026, the live proxy, `gemini-3.8-flash`): 93 AI-path customer documents (45 whose BlindIQ order has a Roller System 40 cassette, 48 without), each read twice with main's prompt and the branch's, each reading converted with main's and the branch's converter and scored against the final BlindIQ lines. Cassette right on 26 / 27 of 175 blinds today, 138 / 137 with both changes (old prompt + new converter 130 / 126, new prompt + old converter 127 / 124); the cassette on the blind at all 52 / 59 → 172 / 172; documents with every cassette right 7 / 10 → 32 / 31 of 45. Inserts 106 / 105 → 107 / 107 of 112 (4 extra in one reading: "same colour cassette with black trim", BDO668079). Bottom bar on the cassette documents 45–57% → 76–79% right. Control documents: 5 extra cassettes, all BDO670957 (handwritten BD form, "Silver" written across the Sys 40 70mm Cassette column), blind type 73–74% → 90–92% right, range 83–84% → 88–91%, other fields within run-to-run noise; red problems 18–37% fewer. About 6,600 more prompt tokens per call (5,046 → 11,614), thinking, output and time unchanged. The rest on the branch: 32 / 33 blinds "Yes" with no colour and no hardware colour (red, decision 1; BlindIQ took the capturer's hardware colour: White on 11 blinds of 5 documents, Beige 12, Silver 5, Black 4), BDO662579's swapped colours (every variant), one missed line (BDO673429). Pre-existing and seen more with the new prompt: a Valance line whose range doesn't resolve is asked for the union template's "Fabric Insert" (red).
- Tests: `new-tests/biq-cassette.test.mjs` in `orderbot-tests.zip` (123 checks, 1 more reading TBD's BDO671259 PO from `TASKFILES_DIR`). Suite 1433 passed (1434 with that PO staged), the same 25 failures as main (1310 passed).
- Not done (open with Russel): a cassette with no colour and no hardware colour (White with an amber confirm, or red as now); one cassette over three or more blinds (a Valance "70mm Cassette" line, or the cassette on each blind); a two-blind cassette on the exact layouts (Mathéo / Lifestyle print it on one line); CNBW's Valance column cassette (BDO670789); a Studio Blue 32 layout.

## Converter: notes for parts on sundry lines (Oct 2026)

Sharon (30 Oct 2026, via Russel): when a dealer puts motors and other parts on the blind's line, the converter makes them sundry lines but also leaves a note on the blind's line, which the capturer then deletes; she'd rather the note wasn't kept. Since TBD's purchase orders stopped sending theirs (16 Oct, section above), the only layout still doing this is Mathéo's order sheet: every priced accessory row under a blind became a sundry line and "Accessory: <name>" on the blind's notes. In the 1,112 converter imports saved in task folders from 15 Aug to 30 Oct 2026, no other layout repeats a sundry line in a line note; the other motor wording in line notes is the dealer's own, sometimes the only mention of the part (the AI reading of Task433572, Blind Guys Kempton Park: "Incl. One Touch Dual Motor 1.1nm & Adapter Kit", with sundry lines for the charger and remote only). On the 14 Mathéo orders imported 25 Aug – 28 Oct the XML carried 52 accessory notes; none is on the stored orders (SVR01, 30 Oct).

- `biqNormalizeMatheo` records the note of each accessory that became a sundry line in `it._partNotes`; `biqExportItemNotes` leaves those fragments out for every source (word for word, ignoring case), so the XML, the BlindIQ import preview, the printed preview and the "BlindIQ gets: …" hint agree. The order keeps the note: the editor, `biqApplyOneTouchDual` (it reads "Accessory: OT Dual …") and `describeConverterReading` still see which blind each part is for. `biqMergeDoubleRollerRows` carries a merged row's `_partNotes` to the blind above (no layout that it merges sets them yet).
- Unchanged: the part is still its sundry line (flagged with the dealer's wording until a part is picked, and since Nov 2026 kept out of the XML and listed in the order notes until then, next section; after that BlindIQ shows the part's name and the dealer's wording stays in the editor, as on Finish Logic orders); wire side guides keep their note on every sheet (Roller System 40's option only holds Yes, so "Floor fix" would be lost, and a sheet without the option leaves them a sundry line without a part); a note typed into the notes box goes unless it repeats the converter's accessory note word for word; notes for parts that aren't sundry lines (Blind Guys "Extras" / "Motor type", CNBW "Motor" / "Motorized", the AI's notes) and every other source go exactly as before.
- Replay of 75 customer files (30 Mathéo sheets, Blind Guys, Finish Logic, CNBW, Lifestyle, TBD, BD forms, BlindIQ Online): 15 Mathéo files lose 56 accessory notes from the XML; the rest of their XML, sundry lines, problems and heads-ups are identical, and the other 60 files are identical.
- Tests: `new-tests/biq-part-notes.test.mjs` (25 checks, 2 more with the 14 Mathéo sheets in `TASKFILES_DIR`) and `new-tests/ui-part-notes.test.mjs` (7, the Mathéo samples through the real Drawings tab) in `orderbot-tests.zip`. Suite 1465 passed (1467 with the sheets staged), the same 25 failures as main (1433).
- Not done, noticed: 27 of the 32 accessory sundry lines on the 14 sheets don't resolve to a BlindIQ part with the test package's mappings ("Sys 40 adaptor kit - Sonesse 30/28 WF", "System 55 Adaptor Kit 220v (max 4m)", "OT Smart Hub", Zigbee parts…), so the capturer still picks those parts; the other converter notes on Mathéo lines ("… read as …", the price group "Element - Group B") were deleted too (181 and 112 on the same 14 orders); and accessory rows under a Mathéo valance sheet row are dropped without a word (`biqMatheoValance` returns first, before Oct 2026 too).

## Converter: sundry lines without a part stay out of the XML (Nov 2026)

Paul (9 Nov 2026, "FW: error on roman headrail blind IQ"): BDO675469 (Mathéo PO112612689, converted by Venne on 7 Nov) wouldn't print. BlindIQ said "Unhandled exception … Conversion from type 'DBNull' to type 'String' is not valid"; Paul: "Errant sundry lines caused IQ error". He asked Gift for two Blinds All Of Them orders with the same print problem.
- **Cause.** A sundry line the converter can't match to a BlindIQ part went into the XML with empty `COS_SundryType_Link` / `COS_Sundry_Link`. BlindIQ's importer stores both as -1, and an order holding a sundry line whose part is -1 doesn't print. Deleting the line or picking a part fixes it: BDO674677 printed with type -1 once the capturer picked part 3566. BlindIQ's own screens never save such a line; in 2026 the only ones in the database are converter imports and copies of them.
- **The three orders** (SVR01, 9 Nov):
  - BDO675469: "Headrail Kit 1000" x3, "Steel Ball Chain" x5, "Headrail Kit 1600" x2. Venne deleted them and it printed.
  - Gift's BDO673422 (DOMMY24839, "Chain Tidys" x3) and BDO673682 (Bonita24768A, "Pelmet Joiner" x1): cancelled. Their copies BDO673522 / BDO673741 carried the line and were cancelled too; captured by hand as BDO673538 / BDO673747. The PDFs are `TaskFiles\0437\Task437369\Scan11424.pdf` and `Task437660\Scan11437.pdf` (AI path).
  - Still open with such a line: BDO673685 (Blinds By Bennett 861PHVCSecond, "Rollers" x100, a quote; re-imported as BDO674167).
- **Since when.** c3e277b (29 Aug 2026, "XML always downloads") removed the `biqImportSafetyScan` block on empty links. From then, 43 imports in the task folders carried 67 such lines; the capturers deleted 59, picked a part on 6 and cancelled the 2 orders above. None before 29 Aug.
- **The change.**
  - `biqSundryHasPart` / `biqExportedSundries`: a sundry line goes into the XML only with a BlindIQ part (a positive ID); an empty type still goes.
  - `biqSundriesLeftOutNote` / `biqExportOrderNotes`: the rest are listed after the order's notes in `CO_Notes`: "Sundries not imported (no BlindIQ part found) — add in BlindIQ: 3 x Headrail Kit 1000; 5 x Steel Ball Chain". Quantity plus the line's notes, else `_src`; a line with neither is just left out.
  - The order keeps the line. `biqCollectProblems`'s two "…_Link must be a number" become one problem that says what happens and what to do; a part without a type still gets "SundryType_Link must be a number".
  - Editor: a red "Not imported: no BlindIQ part …" under the sundry row (`sundryHasPart`, read through `BiqConv` so a cached core module still works) and "BlindIQ gets: …" under the order notes (`renderOrderNotesSent`). Both previews mark the line "not imported" and show the notes BlindIQ gets.
  - The XML still always downloads; nothing is blocked.
- **Replay** of the 1,497 customer files (PDF / xlsx) in the task folders of every import since June, 1,040 read by a layout, main against the change (test package mappings): 56 files change, all for this reason only. 98 lines without a part left the XML and are listed in the order notes (Mathéo 24 files, Blind Guys 23, Finish Logic 4, TBD 4, CNBW 1); items, warnings and every other problem are identical. With the Roman sheet change (next section) it is 54 files and 93 lines, as two Roman sheets' lines become the line and its option.
- **Tests:** `new-tests/biq-sundry-no-part.test.mjs` (23 checks, 1 of them reading PO112612689 from `TASKFILES_DIR`). Updated for the new behaviour: `biq-part-notes`, `ui-part-notes` (+3 editor checks), `biq-motor-sundries`, `biq-pdf-preview`. The task folders are `Z:\BlindIQ_DocumentRepository\TaskFiles`: run with `TASKFILES_DIR=Z:/BlindIQ_DocumentRepository/TaskFiles`.

## Converter: Mathéo's Roman sheet (Nov 2026)

The sheet behind BDO675469: Mathéo's "BD Roman Blind (Price Check)". Its 16 sheets (Mar–Nov 2026, `TaskFiles` 0416–0439) arrived with no blind type, because the title wasn't one `biqParseMatheoItems` knew. The lines got no type or range (with a roller's options), the side came out as the roller pair Lh Chain / Rh Pin, and the accessory rows "Headrail Kit 1000" / "Steel Ball Chain" became sundry lines with no part. What BlindIQ holds for them: 14 sheets are headrail-only (Material and Colour NA) and every line is stored as Roman Panel / Roman Headrail (type 2, range 268), no colour, Mech Colour=White, Steel Ball Chain=Yes, No Drums by width, Control 1 Left / Right, Control 2 Chain. Two early sheets carry a fabric and are Roman Panel on that range (BDO653676 Edge Block Pumice, BDO657318 Filter Biscuit).
- **BlindIQ's Roman lists.** Roman Headrail's sheet (120): Mech Colour (White / Black, required, no default), Steel Ball Chain (default No), No Drums (free text, required); no colours; fixes Face / Reveal; Control 1 Left / Right, Control 2 Chain only. Fabric ranges add Eye Cordlock and Motor. Six live fabric ranges have no sheet of their own (Soltis 86, Designer Fab D, Soltis 99, Banbury, 10 Screen, Windsor) and fall back to Roman Panel's union template, which lists No Drums too.
- **Reader** (`biqParseMatheoItems`, `biqNormalizeMatheo`):
  - The title "BD Roman Blind" → Roman Panel. Material NA → range Roman Headrail, colour cleared (`_romanHeadrail`); a fabric → its range.
  - Controls: Left / Right from LH / RH; Chain, or Eye Cordlock / Motor when written; a headrail always gets Chain. "NA" leaves Control 1 empty, asked for by a problem (`_askSide`, "control side is empty on the order").
  - Fix "NA" is empty and asked for (`_askFix`, the Finish Logic "fix is empty on the order" problem; 13 of the 39 lines; capturers keyed Reveal on 11, Face on 1). The Stack Choice column is the option.
- **Accessory rows** (every Mathéo sheet): a part named like one of the line's own Yes/No options ("Steel Ball Chain", "Chain Tidy"; not bracket options) sets that option. On a Roman Headrail row "Headrail Kit NNNN" is the line itself. Mathéo's "TBD " prefix is ignored. Both keep their "Accessory: …" note on the order, not in the XML (`_partNotes`). Everything else becomes a sundry line as before. On the replay no non-Roman sheet changed.
- **Roman Headrail defaults** (`biqRomanHeadrailDefaults` in `biqApplyOptionDefaults`, any source, only when the range's own sheet has No Drums):
  - Mech Colour empty → White, noted (1,175 of the 1,285 Roman Headrails stored with a colour since July 2025). Decided once.
  - No Drums empty → `biqRomanDrums(width)`: 2 up to 800 mm, then one more per 400 mm (3 to 1,200, 4 to 1,600, 5 to 2,000, 6 to 2,600), noted "… confirm". It matches all 35 converted Mathéo headrail lines and 81 % of the 1,595 stored up to 2,000 mm; capturers split at the boundaries, and above 2,000 mm they vary.
  - Wider headrails stay empty: red, as the option is required. The generic "required free text → No" default no longer writes "No Drums=No" there.
  - A count from the order or the capturer stays; one set here follows a later width change (`_drumsAuto`).
- **Replay.** The 16 sheets: no sundry lines. On the 10 with a stored order, range, side, chain, drums and control drop match BlindIQ on all 31 lines. The 4 converted ones go from 9 / 9 / 9 / 21 problems to 0 / 0 / 2 / 0; PO112612667's two are its NA fix and side. Of the 1,040 replayed customer files only those 4 change.
- **Tests:** `new-tests/biq-matheo-roman.test.mjs` (36 checks, 2 of them reading the real sheets from `TASKFILES_DIR`).
- **Not done:** a drop written only in a remark ("Blind Drop is 2000mm", Q062625166) stays a red "drop missing"; three sheets left the Height empty. Mathéo's price group on a fabric Roman ("Element - Cat C") still goes to the line notes, as on its other sheets.

## Converter: sundry lines matched to BlindIQ's parts (Nov 2026)

Russel (9 Nov 2026), on the lines without a part: "can we not line them up and make it understand what the customer attempted to order?"; then "the one touch dual needs a question of whether battery or 220v. otherwise build it". The 67 such lines on the 43 imports since 29 Aug were lined up with what the capturers stored (SVR01): they gave 51 a part. The converter had missed them on dealer shorthand, extra words, adaptor kits and bare remotes and chargers. Docs: `docs/converter/rules.md`, "Sundry lines the first reading didn't match".
- **`biqResolveOpenSundries`** (end of `biqCanonicalize`, every source and the AI path): each line still without a part is read again once per wording (`_openTried`), with the blinds' hardware and controls final. A line with a part is never touched. `biqMotorCatalogue` reads the active parts of the seven motor types once per pass (about 25 ms for an order with such lines; reading the whole catalogue per lookup took 10 s).
  - **Wording** (`biqSundryWording`, `biqMatchWording`): WF / ZB / OT (`biqTbdExpand` on every source), Mathéo's leading "TBD ", brackets, "/20rpm", an area ("- 25m2"), "Sys 40 & Sys 55", a lead-in. Then without "Somfy", "Motor(s)" or "Remote control", then without "Li-ion". BlindIQ's "Tellis" is Telis.
  - **Matching** (`biqMatchMotorPart`): a figure is a figure of its own ("2nm" isn't in "1.2nm"; "3" is in "3nm/30", not in "40/30/28"). "One Touch Motor 2.0" is 2.0nm, not "… 220V". "One Touch +" isn't One Touch Dual.
  - **Ties:** variants the wording doesn't name drop out (Matter, Thread, Short, No Battery, Variation); the order's one family decides; the plainest name wins. Parts BlindIQ names alike in several families (Tahoma Switch Pro, the outdoor kits) are all candidates, and a question's options then say their family (`biqAskParts`).
  - **Battery or 220V** (`biqPowerQuestion`): a motor whose wording says neither, where BlindIQ sells both (One Touch Dual 2nm: 5309 / 5312), asks.
  - **Roller adaptor kits** (`biqPickKit`, `BIQ_KIT_NAMES`): BlindIQ's own kit name is that kit, unless the order's motors are of another family (Blind Guys writes "Motor Adaptor Kit", BlindIQ's word for its Zigbee kits, for RTS ones too).
    - Family: the one the wording names, else the order's motors' (two families: asked), else one a motor line without a part names, else Somfy RTS (Mathéo's kits without "ZB" were RTS).
    - System 40 or 55 from the wording, else the motorised blinds.
    - Colour: from the wording, else the motorised blinds' hardware. 2026 orders whose Roller System 40 blinds have one hardware colour took that colour's kit on 796 of 844. A double roller's hardware is its cassette (23 of 28). Grey and Silver are Light Grey, Charcoal is Anthracite, "TBC" is no colour. Two colours: asked. No such kit: White, noted "confirm".
    - RTS System 55: the Sonesse 40 or Sonesse 30 Wire Free kit, by the wording or the motors, else asked. One Touch + kits go by torque.
    - A kit chosen by colour follows a later hardware change while it is still the converter's (`_kitAuto`).
  - **Outdoor kits** (`biqPickOutdoorKit`): "Outdoor Motor Adaptor Kit Free Hang" or "… System X", by the motorised outdoor blinds. Family: the order's motors' (2026: RTS 62 of 63, io 81 of 83, ShawSmart 35 of 35), else a motor line's wording, else RTS noted "confirm" (51 of 56 orders without a motor). Kits for Roman, venetian, cellular, RomaShade or mixed orders are left (`biqKitProduct`).
  - **"<motor> + adaptor kit"** (`BIQ_PLUS_KIT_RE`) becomes two lines. A bare **"Remote" / "Charger"** is the family's usual part (`BIQ_FAMILY_PARTS`, 80 %+ of its 2026 orders), noted "the usual … confirm", else asked. There is none with no family on the order, and no charger when the RTS motors are all on mains.
  - **Questions** (`s._ask`): the line stays out of the XML ("sundry lines without a part" above). `biqCollectProblems` says `Sundry N: "<wording>": battery or 220V — A or B? Pick it with 🔍. Until then it is left out of the import and listed in the order notes.` The editor's red line says "Not imported until you pick: …" (`biqSundryAskOptions`, read through `BiqConv`).
- **The 67 lines:**
  - 32 the stored part; 3 a question offering it; 2 "motor + kit" lines (the kit right, the motor asked).
  - 2 kits in another colour: BDO670854 (read White, the capturer made the blinds Beige) and BDO675122 (a White kit on Black blinds).
  - 12 left: a remote or charger with no family on the order, plugs, bracket covers, valance end caps and brackets, chain by the metre, an inactive power supply.
  - The other 16: 3 already done, 6 on cancelled orders, 2 line options, 5 Roman headrail lines (previous section).
  - Every orderable motor part typed as BlindIQ names it gives itself (149), a question offering it (5) or its namesake in another family (4), never a part of another name.
- **Replay** of the 1,497 customer files (test package mappings) against the two sections above: 52 files change, only on lines that had no part. 85 lines now go to BlindIQ with a part and 2 ask; items, warnings and other problems are identical. Lines left out for want of a part: 93 in 54 files → 8 in 6.
- **Against SVR01** (the 85 lines):
  - 69 the part stored on the task's orders; 2 on tasks with no stored order.
  - 8 follow the order where the capturer went another way: 5 kits in the blinds' hardware colour where White was stored, an io kit on an io order where the RTS one was, and 2 kits in the colour read where the capturer changed the blinds afterwards (BDO663682 Grey → Anthracite, BDO670854 White → Beige; the kit follows such a change in the editor).
  - 3 parts the capturer left off: the Telis 16 remote on two Finish Logic POs, where it is a line option and not under SUNDRIES, and a motor on PO092612112.
  - 1 quote whose order changed (Q062625184); 1 "Matter & Thread" motor the capturer stored as the plain one (BDO667677); 1 orderable One Touch Dual Smart Hub where the capturer took its type-13 twin.
- **Not done:**
  - The first reading (`biqAddMotorSundry`) is final for a line it matched. Its White default makes a bare "Adaptor kit" the White RTS roller kit on any order, outdoor ones too.
  - On L17084 (BDO664579) the first reading took Zigbee's "Sonesse 30/28 Magnetic Adpater Motor USB-C" on an RTS order, so "Sonesse 30/28 Mag Charger" asks.
  - Finish Logic remotes given as line options become sundry lines (Sharon left both off BDO666742).
- **Tests:** `new-tests/biq-sundry-matching.test.mjs` (60 checks, 1 more with `TASKFILES_DIR`: 22 lines of 9 live imports). Updated: `biq-part-notes` ("OT Smart Hub" now resolves; a chain stopper is the part without one), `biq-sundry-no-part` (the same), `ui-part-notes` (+1).

## Converter: the bottom bar and hardware on AI-read orders (Nov 2026)

From the 10 Nov 2026 review. The import files of 14 Oct – 10 Nov carried 220 Roller System 40 lines on 41 orders with Black or Grey hardware and a White Aluminium bar; capturers changed 200 by hand, and 12 blinds on 4 orders are stored that way (BDO673609, BDO673598 FA, BDO675306 E, BDO675515 KB and M). Keyed by hand, Black hardware has a Black Aluminium bar on 313 of 313 lines and Grey a Silver one on 383 of 385.
- **Cause.** The AI path and the Blind Guys roller reader start from the sheet's template (Mech Colour White, Bottom Bar White Aluminium), and `biqApplyHardwareColours` only fills an empty bar. Mathéo and the BD order form already cleared the template's bar.
- **AI path** (`biqAiResultToOrder`): when the document gives the hardware colour (or a cassette colour) and no bottom bar, the template's bar is cleared and `_barToHardware` is set. A bar the document states is kept. Double rollers keep their own rule.
- **Dealer names on the AI path.** An option the AI writes under a dealer's name (Hardware Colour, Mechanism Colour, Bottom Bar Colour, Roll: the rename rules of `BIQ_OPTION_REMAPS`) now beats the template default. `biqFoldOptionSynonyms` only moves such a name onto an empty row, so "Hardware Colour=Black" used to be dropped for the template's White.
- **Blind Guys roller sheet** (`biqBgRoller`): an empty Bottom Bar Colour cell beside a stated Mechanism Colour follows the hardware (Task439495 row 0005, Task437519 row 0006).
- The note "Bottom Bar not on the order — … to match the hardware" is written only when the hardware isn't the sheet's default, so an order in White gets no new note.
- **Not done:** a bar the converter set does not follow a later change of Mech Colour in the editor; a White bar the sheet states beside dark hardware is not queried.
- **Tests:** `new-tests/biq-bar-follows-hardware.test.mjs` (34 checks; 14 fail on main), in the review package "Review fixes 2026-11". `biq-cassette`'s "Cassette=No" case now expects the bar note. Suite 1,730 passed, the same 34 failures as main (1,696).

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
