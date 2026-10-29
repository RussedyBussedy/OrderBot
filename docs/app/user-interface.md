# User interface

OrderBot is a single web page, `index.html`, with three views behind the pills in its header. This page describes what users see in each view and where the code for it lives, how admin mode changes the page, what the page keeps in browser storage, and how to edit `index.html` without breaking it.

## The page at a glance

| View | Header pill | Element | Who sees it | Built by |
|---|---|---|---|---|
| Orders (default) | `#nav-orders` | `<main>` | Everyone | `index.html` (most of the app), plus `js/biq-converter-ui.js` for the converter section |
| Drawings | `#nav-drawings` | `#drawings-view` | Everyone | An `<iframe>` showing the Bend & Blind Visualiser from the separate `bd-tools` repository |
| Cost report | `#nav-cost-report` | `#cost-report-view` | Admin mode only | `js/cost-report-console.js`, see [Cost report console](../cost-report-console.md) |

The header also holds the Blind Designs logo (`bd-logo-white.png`) and the "OrderBot" title with "AI order checking" under it.

## Switching views

View switching is done by a small plain `<script>` at the very end of `index.html`, separate from the app module. Its `show(view)` function:

- toggles the `hidden` class on `<main>`, `#drawings-view` and `#cost-report-view`;
- sets `view-pill-active` and `aria-pressed` on the three pills;
- scrolls back to the top.

Because it is a plain script and not part of the module, the pills work even when Firebase sign-in or a module import fails. Two CSS rules in the first `<style>` block (`#drawings-view.hidden` and `#cost-report-view.hidden, #nav-cost-report.hidden`) keep the hidden views hidden even before Tailwind has loaded, so capturers never glimpse the admin view.

The current view isn't kept in the URL or in storage: a reload always returns to Orders.

## Drawings: the embedded visualiser

The Drawings view shows the Bend & Blind Visualiser (curtain track bends, sloped verticals, shaped cellular blinds) in `#drawings-frame`. Its code lives in the `bd-tools` repository, not here. The iframe is only loaded the first time someone opens the view, and the **OPEN FULL SCREEN** link (`#drawings-fullscreen`) opens the same address in a new tab, which the page suggests for printing.

The visualiser is published encrypted. At a high level:

1. The staff SharePoint page that embeds OrderBot adds the decryption key and a version number to the URL **fragment** of OrderBot's address (the part after `#`).
2. `visualiserSrc` in the plain script reads them and builds the iframe address: the key goes into the visualiser's own fragment, and the version number becomes a cache-busting query parameter.
3. Fragments are never sent to a web server, and the key is never committed to this repository. Opened without the key (for example from the bare GitHub Pages address), the visualiser shows its own passphrase screen instead.

Rotating the key or bumping the version is done in the SharePoint embed (and in `bd-tools`), not in this repository. See [Security](../security.md) and the [runbooks](../operations/runbooks.md).

## Cost report (admin only)

In admin mode the module loads `js/cost-report-console.js` with a dynamic `import()` and calls `initCostReportConsole`, which removes `hidden` from the Cost report pill and builds the view. The view reads Firestore only once the pill is clicked. A failed import is caught and logged, so this optional page can't stop OrderBot from loading. Everything else about it is in [Cost report console](../cost-report-console.md).

## The Orders view

The Orders view is grouped under three overlines: "Check an order", "Look things up" and "Reference data & rules".

| Section | Element | What it's for | Main code | Details |
|---|---|---|---|---|
| Check an order | `#upload-section` | Upload pairs of documents (customer's order + Blind IQ's order) and run the comparisons | `addNewPair`, `setupDropZone`, `handleFiles`, `runAllComparisons` | [Comparison pipeline](../comparison/pipeline.md) |
| Comparison summary | `#report-section` | The results of the current run, one collapsible entry per pair | `renderSummaryReport`, `renderReportTable` | [Comparison pipeline](../comparison/pipeline.md#rendering) |
| Comparison history | `#history-section` | Find earlier comparisons by order number | `findHistory` | [History, feedback and reference data](../comparison/history-feedback-and-reference-data.md) |
| BlindIQ XML converter | `#biq-converter-section` | Turn a customer document into a BlindIQ import file | `initBiqConverter` in `js/biq-converter-ui.js` | [Converter user interface](../converter/user-interface.md) |
| AI guidelines | `#guidelines-header`, `#guidelines-content` | Business rules added to the comparison prompt | `loadAndDisplayGuidelines` and the save handler | [History, feedback and reference data](../comparison/history-feedback-and-reference-data.md) |
| Fabric, Motor and Tube properties | `#fabric-properties-section`, `#motor-properties-section`, `#tube-properties-section` | Reference tables the validations use | `loadAndDisplay…Properties`, `render…Row` | [History, feedback and reference data](../comparison/history-feedback-and-reference-data.md) |

Points worth knowing:

- **Pairs.** Each pair is cloned from `<template id="upload-pair-template">`: a "Customer order(s)" drop zone and a "Blind IQ order(s)" drop zone. **+ Add another order** adds pairs up to 10. **Run comparisons** (`#compare-btn`) is enabled only when every pair has at least one file on each side (`checkCompareButtonState`).
- **File choice.** The drop zones accept PDF, JPEG and PNG only; other files are dropped silently by `handleFiles`. Choosing or dropping files again **replaces** that side's list rather than adding to it. Each listed file has a remove button.
- **During a run** the upload card is hidden, the summary shows skeleton loaders and a status line, and `#top-progress-bar` runs across the top of the window. **Start new comparison** (`resetUI`) clears the run, the history results and the pairs.
- **Collapsible cards.** The converter, AI guidelines and the three property cards open and close on their header (`setupCollapsible`), which remembers the state in `localStorage` (see [Browser storage](#browser-storage)).
- **Not admin-only.** The AI guidelines and the property tables are visible to, and editable by, everyone who opens the page. Admin mode doesn't affect them.

## Modals and toasts

| Modal | Opened by | Purpose |
|---|---|---|
| `#feedback-modal` "Report an error" | Clicking a field cell or an option in any report (`setupReportInteraction`) | A capturer's correction, optionally with a pasted image |
| `#guideline-modal` "Add & consolidate guideline/s" | **Add / unify guideline/s** | New rules for the AI, merged into the master list by the AI |
| `#critical-modal` "Critical field errors found" | The end of a fresh run with critical issues (`showCriticalModal`) | Lists the affected lines per order before the capturer moves on |
| `#confirm-modal` "Are you sure?" | `showConfirmModal(message, onConfirm)` | Confirms deletes and the CSV "replace all" uploads |

The converter has its own dialogs, described in [Converter user interface](../converter/user-interface.md).

How they work:

- `openModal(modalEl)` shows a modal by setting its inline `display` to `flex`, focuses the first input or textarea (else the first focusable element) and keeps the Tab key inside the modal. Closing sets `display` to `none`.
- One document-level `keydown` handler closes an open modal on Escape, checking them in this order: guideline, feedback, confirm, critical.
- `showToast(message, type)` shows a toast in `#toast-container` (an `aria-live="polite"` region) for four seconds. The types are `success`, `error`, `warning` and `info`. The message is set with `textContent`, so it's never interpreted as HTML.

## Admin mode

**What turns it on.** The converter's **Admin** switch (`biq-adminlock`, handled by `biqTryUnlock` in `js/biq-converter-ui.js`). It asks for a confirmation (there has been no PIN since 10 October 2026), stores `biq_admin` = `1` in `localStorage` and reloads the page. Clicking the switch again, which then reads "admin" with an open padlock, offers to leave admin mode: it removes the key and reloads.

**What it shows.**

- The converter's mapping tools, starting with the **BlindIQ ID mappings** button (`biq-openmaps`). See [Converter user interface](../converter/user-interface.md).
- The Cost report pill and view: the module's `costReportAdmin()` reads `biq_admin`, and only then imports `js/cost-report-console.js`.

**What it doesn't change.** Checking orders, the history, corrections, AI guidelines and the property tables behave the same for everyone.

Admin mode is per browser and is a convenience that keeps capturers out of the mapping tools. It isn't access control. See [Security](../security.md).

## Browser storage

`index.html` uses `localStorage` only; it sets no cookies and uses neither `sessionStorage` nor IndexedDB.

| Key | Written by | Values | Meaning |
|---|---|---|---|
| `ob_guidelines_open` | `setupCollapsible` in `index.html` | `open` / `closed` | AI guidelines card open |
| `ob_fabric_open` | `setupCollapsible` | `open` / `closed` | Fabric properties card open |
| `ob_motor_open` | `setupCollapsible` | `open` / `closed` | Motor properties card open |
| `ob_tube_open` | `setupCollapsible` | `open` / `closed` | Tube properties card open |
| `ob_biq_open` | `setupCollapsible` | `open` / `closed` | Converter section open |
| `biq_admin` | `biqTryUnlock` in `js/biq-converter-ui.js` (set and removed); read by `costReportAdmin` in `index.html` and `biqIsAdmin` in the converter | `1`, or absent | Admin mode |

`js/cost-report-console.js` also keeps `cr_name` (who saves the cost report settings). The full list is in [Data model](../data-model.md).

## How index.html is organised

`index.html` is about 3,600 lines (230 KB): markup, two style blocks, one inline ES module with most of the comparison logic, and the plain view-switching script. There's no build step: the file in the repository is the file browsers load.

### Load order

1. **`<head>`**: the external scripts and fonts (table below), then two `<style>` blocks. The first defines the Blind Designs design tokens (`--bd-paper`, `--bd-ink`, `--bd-olive` and so on) and components (`.bd-card`, `.bd-btn-primary`, `.drop-zone`, the toast and status-badge styles). The second, `<style id="bd-ci-theme">`, recolours Tailwind's default utility colours (slate, indigo, blue, green, red, amber, orange) to the company palette with `!important`, so markup built in JavaScript didn't need changing.
2. **`<body>`**: the progress bar, the header, `<main>` (Orders), `#drawings-view`, `#cost-report-view`, the toast container, the four modals and the pair template.
3. **The app module** (`<script type="module">`). Module scripts run after the page has been parsed.
4. **The plain script** for Drawings and view switching. It wires the pills on `DOMContentLoaded`.

| Library | Version | Loaded from | Used by |
|---|---|---|---|
| Tailwind CSS (Play CDN) | Not pinned | `cdn.tailwindcss.com` | All markup; compiles utility classes in the browser |
| SheetJS (`xlsx.full.min.js`) | 0.18.5 | cdnjs | The converter (spreadsheets) |
| pdf.js (`pdf.min.js`, worker `pdf.worker.min.js`) | 3.11.174 | cdnjs | The converter, and the second-reading test `needsSecondReading` |
| Firebase JS SDK (app, auth, firestore) | 11.6.1 | `www.gstatic.com` | The app module's imports |
| PT Sans and PT Serif | n/a | Google Fonts | Typography |

The pdf.js worker address is set near the end of the module (`pdfjsLib.GlobalWorkerOptions.workerSrc`) and must stay on the same version as `pdf.min.js`.

### Firebase start-up

The module starts with `initializeApp(firebaseConfig)` (the values are in `js/config.js`), `getFirestore`, `getAuth` and a top-level `await signInAnonymously(auth)`, then keeps the anonymous user's ID in `userId`. If any of that throws, the error is logged and a "Could not connect to the database." toast is shown; functions that need Firestore check `db` first.

Because of the top-level `await`, **nothing below it runs until sign-in has finished**: the Orders view's buttons have no handlers until then. The plain view-switching script is not affected.

### Module imports

| Source | Imported as | Names |
|---|---|---|
| Firebase SDK | Named | `initializeApp`; `getAuth`, `signInAnonymously`; `getFirestore`, `collection`, `addDoc`, `getDocs`, `query`, `where`, `orderBy`, `limit`, `startAfter`, `deleteDoc`, `doc`, `writeBatch`, `getDoc`, `setDoc`, `updateDoc`, `onSnapshot`, `serverTimestamp` |
| `./js/config.js` | Named | `firebaseConfig`, `PROXY_API_URL`, `PROMPT_VERSION`, `EXTRACTION_MODEL`, `COMPARISON_MODEL`, `isGemini3`, `SECOND_READING` |
| `./js/constants.js` | Named | `BLIND_TYPE_EXCLUSIONS_FOR_COLOUR_CHECK`, `BLIND_TYPES_REQUIRING_CONTROL_VALIDATION`, `BLIND_TYPES_REQUIRING_DUAL_CONTROL`, `CRITICAL_FIELDS`, `CACHE_TTL_MS` |
| `./js/biq-converter-ui.js` | Namespace `BiqUI` | `initBiqConverter`, `biqReadCustomerFile`, `biqComparisonCatalogue` |
| `./js/comparison-context.js` | Named | `selectRelevantFeedback`, `formatCorrectionExamples`, `BD_STANDARDS`, `NOT_SPECIFIED_RULES`, `READING_RULES`, `RESULT_VALUES`, `describeConverterReading`, `SECOND_READING_PROMPT`, `secondReadingSchema` |
| `./js/comparison-checks.js` | Named, and namespace `Checks` | `applyDeterministicChecks`, `reconcileSecondReading`, `needsSecondReading`; `Checks.applyExactReading` |
| `./js/outdoor-motors.js` | Named | `validateOutdoorMotors` |
| `./js/cost-report-console.js` | Dynamic `import()`, admin mode only | `initCostReportConsole` |

`orderBy`, `limit` and `startAfter` are imported but not used (they're left over from a paged history search). `getDoc` and `serverTimestamp` are only passed on to the cost report console.

**Why the namespace imports.** According to the comment beside them, GitHub Pages lets browsers cache each file for up to ten minutes, so for a few minutes after a deploy a browser can run the new `index.html` with an old copy of a module. A named import of an export that the old copy doesn't have is a load error that stops the whole module, and with it the page. A namespace import just gives `undefined` for the missing export, and the code checks before calling it (`if (Checks.applyExactReading)`, `BiqUI.biqReadCustomerFile ? … : null`, `BiqUI.biqComparisonCatalogue ? … : null`). The same idea is behind the "(1/2: js)" then "(2/2)" commit pairs: the modules ship first, the `index.html` that uses them second.

### Top-level state

| Variable | Holds |
|---|---|
| `app`, `db`, `auth`, `userId` | Firebase handles and the anonymous user's ID |
| `comparisonPairs` | The pairs on screen: `{ customerFiles, blindIQFiles }` (arrays of `File`) |
| `summaryResultsCache` | The current run's results by pair index: `{ status: 'success', data }` or `{ status: 'failed', error, orderNumber }` |
| `itemToCorrect`, `pastedImageB64` | The field being corrected and the pasted image, while the feedback modal is open |
| `_feedbackGuidelineCache` | Corrections and guidelines for the prompt, with the time they were loaded |
| `historyDataCache`, `lastHistoryDoc` | History search leftovers: the first is filled but never read, the second is never set to a document |
| `confirmCallback` | What the confirm modal runs on **Confirm** |
| `CRITICAL_FIELD_LABELS`, `VALANCE_KEYWORDS` | Constants for the critical sweep and the valance check |

`allDomElements` is one object of element references, looked up by ID once at start-up. Add new static elements there. A few elements are still fetched directly with `document.getElementById` (the critical modal, the progress bar, the toast container).

### Function groups, in file order

| Group | Functions |
|---|---|
| Utilities | `showToast`, `openModal`, the Escape handler |
| Upload pairs | `fileToB64`, `setupDropZone`, `handleFiles`, `updateFileList`, `checkCompareButtonState`, `addNewPair`, `resetUI` |
| History | `findHistory` |
| Comparison run | `runAllComparisons`, `reExtractLowConfidence`, `customerReadingsOf`, `converterReadingOf`, `secondReadingOf`, `runComparisonPipeline`, `processSingleComparison`, `persistComparison` |
| Report rendering | `renderSummaryReport`, `setupReportInteraction`, `collectCriticalIssues`, `collectSundryFails`, `criticalSummaryHtml`, `showCriticalModal`, `renderReportTable` |
| Feedback modal | Anonymous listeners on the submit and cancel buttons, the paste handler and the image remove button |
| Confirm modal | `showConfirmModal` |
| AI guidelines | The save listener, `loadAndDisplayGuidelines`, the delete listener |
| Collapsibles | `setupCollapsible` |
| Fabric properties | `setupFabricDropZone`, `processFabricFile`, `parseCsvAndExtractFabricData`, `uploadFabricProperties`, `loadAndDisplayFabricProperties`, `renderFabricRow`, `getFabricProperties` |
| Post-AI checks | `applyConfidenceThresholds`, `analyzeReasoningPatterns`, `runPostAIValidations`, `validateValances`, `validateMotorDependencies` |
| Motor properties | `setupMotorDropZone`, `processMotorFile`, `parseCsvAndExtractMotorData`, `uploadMotorProperties`, `loadAndDisplayMotorProperties`, `renderMotorRow`, `getMotorProperties` |
| Tube properties | `setupTubeDropZone`, `processTubeFile`, `parseCsvAndExtractTubeData`, `uploadTubeProperties`, `loadAndDisplayTubeProperties`, `renderTubeRow`, `getTubeProperties` |
| Initial load | The sequence below |
| Plain script | `visualiserSrc`, `init`, `show` |

Event listeners are attached where each group's code runs, top to bottom, so the order of the file matters for anything that runs at start-up.

### The initial-load sequence

At the bottom of the module, in this order:

1. `addNewPair()`: the first, empty pair.
2. `loadAndDisplayGuidelines()`, `loadAndDisplayFabricProperties()`, `loadAndDisplayMotorProperties()`, `loadAndDisplayTubeProperties()`. These are `async` and not awaited: the lists fill in as Firestore answers.
3. `setupCollapsible` for the guidelines, fabric, motor and tube cards (`ob_guidelines_open`, `ob_fabric_open`, `ob_motor_open`, `ob_tube_open`).
4. The pdf.js worker address.
5. `setupCollapsible` for the converter section (`ob_biq_open`), then `BiqUI.initBiqConverter(deps)`. The converter receives what it needs from the page instead of importing it: `db` and the Firestore functions `collection`, `doc`, `getDocs`, `setDoc` and `onSnapshot`; `PROXY_API_URL`, `EXTRACTION_MODEL` and `COMPARISON_MODEL`; `getFabricProperties`, `getMotorProperties` and `getTubeProperties`; `runPostAIValidations`; `showToast` and `showConfirmModal`.
6. In admin mode only: `import('./js/cost-report-console.js')`, then `initCostReportConsole` with `db`, `doc`, `getDoc`, `setDoc`, `deleteDoc`, `onSnapshot`, `serverTimestamp`, `showToast`, `showConfirmModal` and `isAdmin`. Errors are caught and logged.
7. `setupFabricDropZone()`, `setupMotorDropZone()`, `setupTubeDropZone()`: drag and drop for the CSV uploads.

## Editing index.html safely

- **Mind the size.** Search for the function or ID you need rather than scrolling, and keep each change small. With no build step, a syntax error anywhere in the module stops the whole Orders view from working.
- **Put new code beside its feature group**, and keep the initial-load sequence at the bottom. New static elements go into `allDomElements`.
- **Move pure logic into `js/` modules** rather than growing the inline script. `CLAUDE.md` sets the pattern: browser-native ES modules, named exports only (`export const`, `export function`), no default exports, no CommonJS, no bundler. Move working functions as they are; don't redesign them on the way ("extract, don't rewrite"). Functions with no DOM access are the safest to move first, for example `applyConfidenceThresholds`, `analyzeReasoningPatterns`, `validateValances`, `collectCriticalIssues` and the three CSV parsers.
- **Reach new exports through a namespace import** and test for them before calling, as `Checks.applyExactReading` does, and ship the module before the `index.html` that uses it.
- **Keep the Pass 1 prompt inline with the documents.** The comment in `processSingleComparison` records that moving it into `systemInstruction` made extraction worse. See [Comparison AI context](../comparison/ai-context.md).
- **Save only in `persistComparison`**, after every check, so the history shows the same flags as the live report. The comment in `processSingleComparison` says not to add a save there.
- **Escape what you didn't write.** AI output and Firestore data should go in with `textContent`, or through the `escapeHtml` helper inside `renderReportTable`. Some older rendering builds HTML template strings; don't add more, and convert them when you touch that code. See [Security](../security.md).
- **`runPostAIValidations` is shared with the converter**, which runs it on its own orders for the torque and spec checks. A change there changes both.
- **Styling.** The Tailwind Play CDN compiles any utility class at run time, and the `#bd-ci-theme` layer recolours the default palette. Prefer the existing `bd-*` classes and the colours already in use, so new markup matches.
- **One concern per change**, and the manual end-to-end check from `CLAUDE.md` before the next change: upload → compare → view results → history search. See [Development workflow](../development-workflow.md) and [Testing](../testing.md).

## Known weak spots

- `setupCollapsible` reads and writes `localStorage` without a `try`/`catch` (the admin-mode check has one). In a browser that blocks site storage, the first call throws and the rest of the initial load (the converter, the cost report, the CSV drop zones) doesn't run.
- Until anonymous sign-in completes, the Orders view's buttons do nothing (see [Firebase start-up](#firebase-start-up)).
- The Tailwind Play CDN isn't version-pinned, and Tailwind describes it as a development tool, so a Tailwind release can change the page without a commit here.
- The view isn't in the URL, so a view can't be linked to directly.
- Leftovers of a paged history search (`orderBy`, `limit`, `startAfter`, `lastHistoryDoc`, the hidden **Load more** button) suggest a feature that doesn't exist. See [History, feedback and reference data](../comparison/history-feedback-and-reference-data.md).

## Related pages

- [Overview](../overview.md)
- [Architecture](../architecture.md)
- [Glossary](../glossary.md)
- [Comparison pipeline](../comparison/pipeline.md)
- [History, feedback and reference data](../comparison/history-feedback-and-reference-data.md)
- [Converter user interface](../converter/user-interface.md)
- [Cost report console](../cost-report-console.md)
- [Data model](../data-model.md)
- [Security](../security.md)
- [Development workflow](../development-workflow.md)
- [Deployment](../deployment.md)
