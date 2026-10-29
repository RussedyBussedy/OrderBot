# History, feedback and reference data

The parts of the Orders view that keep knowledge and reuse it: the comparison history, the corrections capturers send from a report, the AI guidelines, and the fabric, motor and tube tables the validations use. For each one, this page covers what users do, what the code writes to Firestore and how the data is used later.

All of this lives in `index.html`. Terms such as BDO number, range and roll width are in the [glossary](../glossary.md); the Firestore collections are described in full in [Data model](../data-model.md).

## Comparison history

**What users do.** Type an order number into the "Comparison history" card (`#history-search-input`) and press **Find history** or Enter. **Clear** empties the results and the search box.

**How the search works** (`findHistory`):

- It runs three equality queries on `orderbot_comparisons` at once: `bdoOrderNumberLower` equal to the term in lower case, `customerOrderNumberLower` equal to the term in lower case, and, for records saved before the lower-case fields existed, `bdoOrderNumber` equal to the term in upper case.
- So the search is exact and ignores case: "bdo672621" finds BDO672621, but "672621" or a partial number finds nothing. A customer order number must be typed as it was saved, spaces and dashes included.
- Results from the three queries are merged by document ID. A comparison saved without a BDO number was stored as `UNKNOWN-<customer order number>` (see [the pipeline](pipeline.md#what-is-saved-persistcomparison)), so it can be found by the customer's number.
- When nothing is found, the card says the order has not been processed by OrderBot. A Firestore `failed-precondition` error (a missing index) gets a hint to follow the link in the browser console; other errors are shown as they are.

**What's shown.** Each match appears under a "Comparison from:" heading with the date and time of the save, followed by the full report from `renderReportTable`: the CRITICAL FIELD CHECK box, the order-level alerts, every line with its validations, tooltips and reasoning log, and the sundries. `setupReportInteraction` is attached too, so a capturer can send a correction from an old comparison.

**Re-opening results.** Nothing is re-run. A stored comparison is shown exactly as it was saved, with the flags, rule annotations and validations of that day; older records simply lack the fields later versions added. The run summary's header (status and model badge), the "AI flagged:" strip and the end-of-run modal belong to fresh runs and aren't shown. The history can't delete a comparison.

**Paging and order.**

- There's no paging: one search returns every match. A **Load more** button (`#history-load-more-btn`) is wired to `findHistory(true)`, but its container is never shown and `findHistory` ignores the argument. `lastHistoryDoc` and the imported `orderBy`, `limit` and `startAfter` are left over from a paged version. Paging and a date filter are on the improvement list in `CLAUDE.md`.
- The results are meant to be sorted newest first, but the sort subtracts the `timestamp` strings (ISO dates), which gives `NaN`, so in practice they stay in query order: BDO number matches first, then customer number matches, then the older records.

## Corrections (feedback)

### What the capturer does

1. In any report, fresh or from the history, click the field cell or the option that's wrong. The "Report an error" modal (`#feedback-modal`) opens, titled "Correcting error for:" and the field's name, with the field's stored data (customer value, Blind IQ value, result, confidence and any annotations).
2. Explain the correct reading in the text box. Optionally paste an image (for example a snippet of the customer document) into it; a preview appears with a remove button. The last pasted image wins.
3. Press **Submit feedback**.

### What the code does

The submit handler:

1. Requires an explanation.
2. Builds `fieldFingerprint`: the field name and Blind IQ's item letter, lower case (for example `width_a`).
3. Asks the AI to rewrite the explanation as a rule. The call uses `EXTRACTION_MODEL`, a short prompt ("You are an expert prompt engineer… Rewrite their text into a clear, precise, and unambiguous rule…") and the pasted image, sent as `image/png`, if there is one. There's no response schema: the answer's text becomes `enhancedExplanation`.
4. Looks for an existing correction with the same `fieldFingerprint` **and** the same `userId` (this browser's anonymous ID). If there is one, it updates its `timestamp`, `enhancedExplanation`, `userExplanation` and (when given) `imageSnippet`; otherwise it adds a new document.
5. If any step fails, shows a warning toast and adds a new document with `enhancedExplanation` set to "RAW: " plus the capturer's words.
6. Clears the cached corrections (so the next comparison reloads them) and closes the modal.

### The correction document

`orderbot_feedback`:

| Field | Content |
|---|---|
| `userId` | The anonymous Firebase user ID of the browser that sent it |
| `timestamp` | ISO date and time |
| `incorrectItem` | `{ lineItemIdentifier: { item, location }, fieldName, fieldData }`: Blind IQ's item letter and location, the field name (or the option's name) and the field object as it was shown |
| `userExplanation` | The capturer's own words |
| `enhancedExplanation` | The AI rewrite, or "RAW: …" when the rewrite failed |
| `fieldFingerprint` | `<field>_<item letter>` |
| `imageSnippet` | Optional: the pasted image as a data URL |

### How corrections reach the AI

On each comparison, `selectRelevantFeedback` picks the ten corrections that share the most words with the pair's file names (newest first on ties) and `formatCorrectionExamples` adds them to the Pass 1 prompt with the capturer's words and the cleaned rewrite. Only the text is sent; the images never reach the comparison. Details in [Comparison AI context](ai-context.md#corrections-orderbot_feedback).

### Weak spots

- **The fingerprint doesn't include the order.** A later correction of the same field and item letter from the same browser, on any order, overwrites the earlier correction's words but keeps the earlier `incorrectItem`, so the stored example can pair one order's field with another order's explanation.
- **Images are stored inside the document**, as data URLs. A large screenshot can take the document past Firestore's 1 MiB limit, and then the save fails (the fallback save includes the image too). A pasted snippet of a customer document can also hold an end customer's personal details; see [Security](../security.md).
- **The rewrite can over-generalise.** It's asked for a "rule" from one example, and some rewrites start with chat. That's why the prompt also shows the capturer's own words (since v2.3).
- **There's no screen to list, edit or delete corrections.** That's only possible in the Firestore console.

## AI guidelines

### What users do

Open the "AI guidelines" card. It lists every guideline with a × button to delete it (after a confirmation). **Add / unify guideline/s** opens `#guideline-modal`, where you describe one or more new rules and press **Integrate guideline/s**. The card isn't restricted to admin mode.

### What the code does

The save handler:

1. Reads every current guideline from `orderbot_guidelines`.
2. Asks the AI (`EXTRACTION_MODEL`, temperature 0.1 on a 2.x model, response schema `{ guidelines: [string] }`) to integrate the new rules into the existing ones, resolve contradictions (the new rule wins), merge redundant rules and return one unified master list.
3. Deletes every existing guideline document in one batch, then writes one new document per returned guideline in a second batch: `{ userId, timestamp, originalUserInput, enhancedGuideline }`. `originalUserInput` is the text just typed, the same on every document.
4. Clears the cached guidelines, closes the modal and reloads the list (`loadAndDisplayGuidelines`).

Deleting one guideline removes its document and reloads the list; it doesn't clear the cache, so the deleted rule can stay in the prompts of this browser for up to five minutes.

### How guidelines reach the AI

All of them, in every Pass 1 prompt, as a bulleted list under "# GUIDELINES (USER-DEFINED)" ("You must follow these rules without exception"). The prompt tells the AI a guideline wins over its general extraction principles. See [Comparison AI context](ai-context.md#guidelines-orderbot_guidelines).

### Weak spots

- **Every addition rewrites the whole list.** The AI can merge, reword or drop existing rules without anyone noticing, and there's no history or undo: `originalUserInput` only keeps the latest input. Export the collection from the Firestore console before a big change.
- **The two batches aren't one transaction.** If the second write fails after the first, every guideline is gone.
- **A cache bug can stop comparisons** (next section).
- When you change how the list is drawn, put each guideline on the page as text, not HTML ([Security](../security.md)).

## The feedback and guideline cache

`processSingleComparison` keeps the corrections and guidelines in `_feedbackGuidelineCache = { feedback, guidelines, timestamp }`. It reloads both collections when `feedback` is empty or the cache is older than `CACHE_TTL_MS` (five minutes, `js/constants.js`). The cache lives in the open page only; each browser tab has its own.

| Event | What it does to the cache | Effect |
|---|---|---|
| A correction is submitted | `feedback = null` | The next comparison reloads both collections |
| Guidelines are added | `guidelines = null` | **Bug:** the reload test only looks at `feedback` and the age, so a comparison started within five minutes of the last reload reads `null.length` and fails with "Cannot read properties of null". The pair is retried once and fails again. It works again once the five minutes are up, after a correction is submitted, or after a page reload |
| A guideline is deleted | Nothing | The deleted rule can be sent for up to five minutes |

The obvious fix is to reload when either entry is empty.

## Fabric, motor and tube properties

Three reference tables, one card each. They're visible to and editable by everyone who opens the page, and a change applies to every capturer's next comparison.

### Working with the tables

- **The list** shows one editable row per document, sorted by name (motors by name, then blind type).
- **Edit** a row's fields and press **Save** (`updateDoc`); **×** deletes it after a confirmation.
- **Add new fabric / motor / tube** adds an empty row with **Add** and **Cancel**.
- **Upload CSV to replace all**: click the box or drop a `.csv` file onto it, and confirm. The file is parsed, **every** document in the collection is deleted (one batch), the parsed rows are written (a second batch) and the list reloads.

The CSV rules, for all three tables:

- The first row is a header and is skipped. It only decides the delimiter: a semicolon if the header contains one, otherwise a comma.
- Columns are read **by position**, not by header name.
- Blank lines are ignored. Rows with too few columns or invalid values are skipped with a console warning.
- A decimal comma is accepted for the fabric weight and the motor torque.
- The fabric and tube parsers split on the delimiter without understanding quotes. The motor parser understands quoted fields, which you need when a list field contains commas in a comma-separated file. Using semicolons avoids the problem.

### Fabric properties (orderbot_fabric_properties)

| Column | Field | Meaning |
|---|---|---|
| 1 | `fabricName` | The fabric, spelt exactly as Blind IQ prints the **range** (case doesn't matter): the validations look fabrics up by Blind IQ's range |
| 2 | `fabricWeight` | Weight per square metre in kg (the weight formula multiplies it by the blind's area in m²) |
| 3 | `fabricWidth` | The roll width in mm |
| 4 | `canTurn` | `Yes`, `No` or `Out` (can be turned only out of warranty); any other value switches the fabric check off |

An illustrative row (not real data): `Example Blockout;0.450;2500;Out`.

### Motor properties (orderbot_motor_properties)

One row per motor **and** blind type.

| Column | Field | Meaning |
|---|---|---|
| 1 | `motorName` | Must appear inside Blind IQ's sundry description for the motor to be recognised |
| 2 | `torque` | Nm |
| 3 | `blindType` | Blind IQ's blind type name this row applies to (exact, any case) |
| 4 | `adapterKit` | Comma-separated: an ordered adapter kit must contain one of these |
| 5 | `accessories` | Comma-separated: the compatible accessories |
| 6 | `otherDependencies` | Comma-separated: an ordered sundry must contain one of these |
| 7 | `blindControl` | Comma-separated: the control values this motor accepts (compared with each of the blind's controls, lower case) |
| 8 | `controlOptions` | Comma-separated: an ordered remote, switch or hub must contain one of these |
| 9 (optional) | `minWidth` | The narrowest blind in mm this motor fits; leave it out or blank to skip that check |

The row editor has the same fields, with `minWidth` shown as "Min W".

### Tube properties (orderbot_tube_properties)

| Column | Field | Meaning |
|---|---|---|
| 1 | `blindType` | The blind type, as a whole name or a part of Blind IQ's name ("Element Roller" covers "Element Roller Sys 40") |
| 2 | `tubeDiameter` | The tube diameter in mm, used for the required torque |

### Which validations use which table

| Validation | Fabric | Motor | Tube |
|---|---|---|---|
| Weight and required torque | Yes (by range) | | Yes (diameter) |
| Fabric width, turning, Out of Warranty | Yes | | |
| Chain ratio | Through the weight | | |
| Motors and their accessories (`validateMotorDependencies`) | Through the required torque | Yes | Through the required torque |
| The converter's torque and spec checks | Yes | Yes | Yes |

The checks themselves are described in [Comparison validations](validations.md). The comparison loads all three tables once at the start of each run (`getFabricProperties`, `getMotorProperties`, `getTubeProperties`), and the converter is given the same three functions.

### Weak spots

- **Replace all isn't atomic.** The delete batch commits before the add batch; if the second fails, the table is empty.
- **CSV errors aren't shown.** The parsing runs inside the file reader's callback, outside the `try`/`catch`, so a bad file leaves the list on "Processing CSV…" and the error only appears in the browser console.
- **Names must match Blind IQ's.** A renamed range or blind type quietly switches off the checks for it. See [Comparison validations](validations.md#the-names-must-match-blind-iqs).
- **Editing isn't limited to admin mode.** Any OrderBot user can change these tables, so keep a copy of the CSV before a big change. Sign-in with roles is planned ([Security](../security.md)).

## Related pages

- [Comparison pipeline](pipeline.md)
- [Comparison AI context](ai-context.md)
- [Comparison validations](validations.md)
- [User interface](../app/user-interface.md)
- [Data model](../data-model.md)
- [Security](../security.md)
- [Known issues and roadmap](../known-issues-and-roadmap.md)
- [Glossary](../glossary.md)
