# Comparison rule checks

The deterministic checks that run on the AI's comparison result: `js/comparison-checks.js` (rule matches for formatting, rule flags for known mistakes, the exact reading of BlindIQ Online orders and the second reading) and `js/outdoor-motors.js` (the Zip X motor table). Both modules are pure functions with no DOM and no Firestore, so they can be tested in node, and every rule keeps the AI's own answer next to its own.

Blinds and BlindIQ terms (control side, pin, gasket, valance, 5 mm steps) are explained in the [glossary](../glossary.md).

## Why rule checks exist

Across the 16,500 orders compared from July 2025 to October 2026, only about one flag in 90 led to a change on the order. The capturers learnt to skim the flags, and real mistakes that had been flagged were passed over. Most of the noise was formatting the AI reported as a difference: Blind IQ's 5 mm size steps, its shortened print of long names, colour codes, a quantity left blank, and the pin that comes with a stated chain side.

Replayed over the history, the v2.4 rules would have matched 29,161 of 349,295 flags (24,598 of 155,517 on critical fields). Only 0.44% of those were followed by a change on the order, against 0.7–1.8% for the flags left standing. The rules can also go the other way and flag a mistake the AI passed (the Perfect Fit rules).

## What the modules export

**`js/comparison-checks.js`** (imports only `CRITICAL_FIELDS` from `js/constants.js`)

| Export | Purpose | Called by |
|---|---|---|
| `applyDeterministicChecks(data, opts)` | Rule matches, notes and flags on a comparison result | `runComparisonPipeline` |
| `applyExactReading(data, readings, opts)` | The customer's exact values from a BlindIQ Online export | `runComparisonPipeline`, through the `Checks` namespace |
| `needsSecondReading(files, pdfjs)` | Whether a pair's customer files need the second reading | `runComparisonPipeline` |
| `customerFileLegibility(file, pdfjs)` | The verdict for one file: `{ unclear, kind, page }` | `needsSecondReading` |
| `reconcileSecondReading(data, reading, opts)` | Flags from the customer-only reading | `runComparisonPipeline` |
| `pairReadingLines(lineItems, lines)` | Pairs the second reading's lines with the comparison's lines | `reconcileSecondReading` |
| `isCleanReadingLine(line)` | Rejects garbled lines of the second reading | `reconcileSecondReading` |
| `isEmptyValue(v)` | Blank-like values: empty, "-", "N/A", "none", "nil", "blank", "not specified", "not stated", "not found", "not given", "unspecified", "?" | Throughout |
| `normName`, `normColour`, `normLocation`, `normFix` | Normalise names before comparing (see below) | The rules |
| `parseMm(v)` | Whole millimetres from "1205", "1205mm" or "1205.0"; otherwise `NaN` | Sizes |
| `roundsTo5mm(blindType)` | False for products made to the millimetre | Sizes, second reading |
| `parseControlPart(v)`, `parseCustomerControls(c1, c2)` | A control's side and kind; the customer's controls over both cells | The control rule |
| `PF_GASKETS`, `clipSizeOf`, `customerClipSize`, `gasketOf`, `chartFit` | Perfect Fit helpers | The Perfect Fit rules |

**`js/outdoor-motors.js`** (no imports)

| Export | Purpose |
|---|---|
| `TABLE_WIDTHS`, `TABLE_DROPS`, `MOTOR_TABLE` | The Zip X motor table |
| `isTableBlind(blindType)` | Free Hang, Zip X, Channel X or Wire X (not Widescreen) |
| `tubeOf(item)` | 95 mm with the 165 mm cassette, else 78 mm |
| `tableTorque(width, drop, tube)` | The table's torque for a size |
| `maestriaTorque(desc)` | The torque in a Somfy Maestria sundry's name |
| `validateOutdoorMotors(data)` | The check itself, called last by `runPostAIValidations` |

## How results are annotated

A rule never throws away the AI's answer: it records what it changed and why, and the report shows it.

A field counts as **flagged** when its result is MISMATCH or OMISSION, or NOT_SPECIFIED on a critical field (because `applyConfidenceThresholds` turns that into an OMISSION later). For options (`specifications`) only MISMATCH and OMISSION count.

| Annotation | On | Set by | Meaning |
|---|---|---|---|
| `aiResult` | Field | `autoMatch`/`autoNote`, `ruleFlag`, the second reading, `applyExactReading`, the quote rule | The AI's result before a rule changed it |
| `aiCustomerValue` | Field | `ruleFlag` (when it puts the customer's own wording in place), `applyExactReading` | The AI's reading of the customer value before a rule replaced it |
| `autoMatched` | Field | `autoMatch`, `autoNote` | The reason for a rule MATCH or NOTE; shown as "By rule: …" |
| `ruleFlag` | Field | `ruleFlag` | The reason for a rule MISMATCH; shown as "By rule: …" |
| `secondReading` | Field | `reconcileSecondReading` | `{ value, confidence, firstReading, why }`; shown as "2nd reading" |
| `exact` | Field | `applyExactReading` | "the BlindIQ Online order": the customer value is the export's |
| `pass2` | Field | `reExtractLowConfidence` in `index.html` | Pass 2's reading, kept beside a critical flag it wasn't allowed to clear |
| `quoteAccepted` | Order | The quote rule | The quote number, for example "BDO669711" |
| `exactReading` | Order | `applyExactReading` | `{ source, lines, paired }` |
| `_exactChanges`, `_autoMatched`, `_ruleFlags` | Order | `runComparisonPipeline` | Counts of exact-reading changes, rule matches and rule flags (numbers, not lists) |
| `_secondReading` | Order | `runComparisonPipeline` | `{ lines, flags, why }`: lines read, fields flagged, why the file was unclear |

What the functions return (all of them also change `data` in place):

| Function | Returns | Each entry |
|---|---|---|
| `applyDeterministicChecks` | `{ data, changes, flags }` | `{ item, field, from, reason }`; `field` is `spec:<option name>` for options |
| `reconcileSecondReading` | `{ data, changes }`, plus `skipped` when the reading was garbled | `{ item, field, from, firstReading, secondReading, why }` |
| `applyExactReading` | `{ data, changes, paired }` | `{ item, field, from, to, customerValue, aiCustomerValue }` |

## applyDeterministicChecks: the rules in order

`applyDeterministicChecks(data, { catalogue })` runs the quote rule on the whole order, then the rules below on each line item in turn. Three internal helpers do the changing:

- `autoMatch(field, reason, …)` sets MATCH, keeps `aiResult` and writes the reason to `autoMatched`;
- `autoNote` does the same with NOTE, for things a rule can explain but not call identical;
- `ruleFlag(field, customerText, reason, …)` sets MISMATCH, keeps `aiResult` (and `aiCustomerValue` if it puts the customer's own wording into `customerValue`) and writes the reason to `ruleFlag`.

MATCH and NOTE rules only touch fields the AI flagged. A rule flag can overturn a field the AI passed.

### 1. Orders that only accept their own quote

Some customer documents only say "go ahead as per quote BDO669711" and list no blinds, so every Blind IQ field came back as an OMISSION (14 critical flags on a two-blind order). `acceptsOwnQuote` applies when:

- one customer text (the special instructions or any customer value on a line) contains the word "quote" or "quotation" and also the digits of this order's own BDO number as a separate number, and
- no line has a customer width or drop.

Then every flagged or NOT_SPECIFIED line field and option becomes a NOTE with the reason "the customer accepted quote BDO… without listing the blinds", `data.quoteAccepted` is set, and **no other rule runs** on that order. A quote for another order, or any size on the customer's lines, leaves the comparison alone.

### 2. The same value, or Blind IQ's shortened print

For `location`, `colour`, `range`, `blindType` and `fix`, when the field is flagged and neither side is blank-like:

| Field | Normaliser | What it ignores |
|---|---|---|
| `range`, `blindType` | `normName` | Case, dots and apostrophes ("M.B.R" = "MBR"), punctuation, Blind IQ's roll-width suffix ("2050mm"), "@", "#", "^", "*", a trailing "Fr", "/ Aventus 5%" |
| `colour` | `normColour` | As `normName`, plus a colour code before or after the name ("129 White") |
| `location` | `normLocation` | As `normName`, plus the customer's own numbering ("1. Window 1") |
| `fix` | `normFix` | Case and punctuation, but keeps sizes: "Ext Reveal" isn't "Ext Reveal 130mm", and "Gasket 18 mm" is "Gasket 18mm" |

- Equal after normalising → MATCH, "same value" (or "same colour (colour code)" when only the code differed). Two blank-like values are never matched: that's a value missing on both sides.
- Otherwise, when one is a long prefix of the other → MATCH, "Blind IQ prints the name shortened". The shorter value must be at least 8 characters for a location, 12 for a colour or range and 9 for a fix, and a fix must be cut inside a word ("Gasket 18m", "Universal Fra"), so "Ext Face 80mm" never matches "Ext Face 80mm (Waterfall)". Blind types have no shortened-print rule.

### 3. A range the colour decides

The customer often names only a colour, and the colour decides the range. This rule needs the converter's catalogue: `BiqUI.biqComparisonCatalogue()` (from `biqCatalogueLookups` in `js/biq-converter.js`) passed in as `opts.catalogue`, with `liveRanges(blindType)` and `rangesForColour(blindType, colour)`. When the range is flagged, the customer gave none and Blind IQ has one:

- the blind type has exactly one live range, and it's Blind IQ's → MATCH, "the only range of this blind type";
- or the customer gave a colour (which the AI matched, or which is the same once normalised), exactly one live range of the type sells it, and it's Blind IQ's → MATCH, "the only range with this colour".

This is the same data the converter uses to infer a range from a colour. Until the converter's mappings, including the catalogue refresh, have loaded from Firestore, the lookups find no live ranges and the rule stays silent.

### 4. Quantity

- Blank on the customer's line and 1 in Blind IQ → MATCH, "one blind per line (QTY not given)".
- The same number written differently → MATCH, "same value".

### 5. Width and drop

- A valance, pelmet, track, extrusion or cassette line with a drop of 0 in Blind IQ and none on the customer's line → MATCH, "valances and tracks have no drop".
- The same number (`parseMm` accepts "1205", "1205mm", "1205.0") → MATCH, "same value".
- **Blind IQ's 5 mm step** → MATCH, "Blind IQ's 5 mm size step", when the difference is at most 2 mm, Blind IQ's value is on a 5 mm step and equals the customer's value rounded to the nearest 5 (1203 → 1205, 1201 → 1200), and:
  - Blind IQ's value is at least 300 mm (below that, a 1–2 mm gap can be a dropped digit, such as 259 for 2590);
  - the product isn't made to the millimetre (`roundsTo5mm`: shutters, Perfect Fit, outdoor and System X products, Free Hang, Widescreen, skylights and Velux blinds are excluded).

### 6. Controls

The rule runs when the line has both control fields and at least one is flagged. `parseCustomerControls` reads the customer's two cells together, split on "+", ",", ";", "&", "and" and "/". `parseControlPart` gives each part:

- a **side**: L from "lh", "left", "l", "lc"; R from "rh", "right", "r", "rc";
- a **kind**: double chain, dual (the One Touch Dual motor, deliberately different from "motor"), chain (also "steel ball", "ball chain"), motor (also "motorised", "Somfy", "One Touch", "battery"), crank, spring, wand or cord as drives; intermediate, coupled or pin as the idle side.

Parts naming two different drive sides give no reading, and nothing is matched.

**Roller-type blinds.** Any blind type that isn't a venetian, retro, wood, aluminium, vertical, shutter, double roller, curtain or track. When the customer gave a side, Blind IQ's pair matches when **all** of these hold:

- exactly one of Blind IQ's two controls is a drive, and it has a side;
- the columns follow Blind IQ's layout: Control 1 isn't a right-hand control and Control 2 isn't a left-hand one (a reversed pair is left to the AI, because such orders were corrected later);
- the other side is a pin, or the intermediate or coupled bracket the customer named (a blank or "None" there is a missing control, and a bracket the customer didn't mention is left to the AI);
- the drive is the customer's kind, or a chain when the customer named no kind (a motor, crank or spring is only matched when the customer says so; a bare "R" against a Blind IQ motor was later changed to a chain on a real order);
- the drive is on the customer's side.

Both flagged control fields then become MATCH: "same control side (the pin comes with the chain side)", or "same control side" for a bracket.

**Venetians.** When Blind IQ's Control 1 is "Left" or "Right" and Control 2 is "Grouped" or "Split":

- Control 1 matches when the customer gave the same side and either no kind or a cord or wand → "same control side".
- Control 2 matches when the customer wrote the same word → "same value"; or, when the customer didn't mention Grouped or Split, when Blind IQ has the Blind Designs standard → "Blind Designs standard (Grouped from 600 mm wide, Split under)". The standard is Grouped for 35 mm blind types; otherwise Split under 600 mm wide and Grouped from 600 mm, by Blind IQ's width.

### 7. Perfect Fit

A Perfect Fit blind sits in its own frame, clipped into the window's beading on brackets ("clips" or "gaskets") sized to the bead depth. Blind IQ's fix is the Gasket of that size, from `PF_GASKETS` (12, 18, 20, 22, 24, 30 and 38 mm; 12 mm is "Gasket 12mm (18mm+foam)"), with the option Remove Universal Frame=Yes. Russel's ruling: the Universal Frame "uses a 24mm clip internally but is not an option for the customer when ordering".

`perfectFitChecks` runs for blind types containing "Perfect Fit". It takes the customer's clip size from `customerClipSize`: the customer's fix, otherwise an option whose name or value is about clips, gaskets, brackets, the bead, the depth or the fix (not one about "additional", "extra" or "spare" gaskets). `clipSizeOf` reads "18mm + foam" as 12, otherwise the first two-digit number from 10 to 45.

| Customer's clip size against Blind IQ's fix | Result |
|---|---|
| The same size as the Gasket | MATCH, "the same gasket size (Perfect Fit)", if the AI flagged it |
| A bead depth Blind IQ has no Gasket for, within the span Louvolite's beading depth chart gives the Gasket on the order (N − 2 to N + 1 mm; 12 to 15 mm for Gasket 12mm; none for 38 mm) | NOTE, "a … mm bead takes … on Louvolite's beading depth chart: confirm the bracket" (`chartFit`) |
| A different Gasket size, which the AI didn't already call a MISMATCH | Rule MISMATCH: "the customer's N mm gasket is Blind IQ's Gasket …" |
| The Universal Frame against any clip size (unless the customer wrote "universal"), which the AI didn't already call a MISMATCH | Rule MISMATCH: the clip size is the Gasket fix; the Universal Frame isn't a customer option |
| No clip size, the Universal Frame, and the customer wrote reveal, recess or face | NOTE: a Perfect Fit blind on the reveal or face goes on the Universal Frame |

And for the options on a Perfect Fit line:

- Remove Universal Frame = Yes with a Gasket fix and the customer silent → MATCH, "goes with the Gasket fix (Perfect Fit: no Universal Frame)".
- Remove Universal Frame = Yes and the customer wrote "no universal frame", "do not send the Universal Frame" or similar → MATCH, "same meaning (no Universal Frame)". A bare "No" is left to the AI.
- An option holding a Gasket value with the same clip size → MATCH.

Replayed with this module over every comparison in Firestore (17,792, August 2025 to October 2026), only Perfect Fit lines changed (and one curtain line with a shortened fix). On the 214 Perfect Fit lines, flags on the fix and its options went from 104 to 32, and none of the cleared fixes was changed on the order afterwards. There was one new flag: a Universal Frame against "25mm clips" (BDO643569), which really had been remade on Gasket 24mm.

### 8. Options

A flagged option whose customer and Blind IQ values are equal after `normName` → MATCH, "same value".

## applyExactReading: BlindIQ Online exports

A dealer's order captured in BlindIQ Online arrives as `BlindIQ_ExportedCO_<IQ Link ID>.pdf`, printed in Blind IQ's own names. The converter parses it without AI, and capturers still re-key it, so mistakes happen (one such order was captured with "LH Dual" where the online order had "Lh Chain"). Russel agreed to an exact check, "but the rules and checks should be applied".

`applyExactReading(data, readings)` uses the readings marked `exact` by `BiqUI.biqReadCustomerFile`:

1. **Pairing.** Each comparison line is paired with an unused export line: first by the customer's item letter (as the AI read it) when the width or drop is within 5 mm or the blind type agrees; otherwise by width and drop both within 5 mm and the same blind type. Blind IQ's own letters can shift when it adds a Valance line, which is why the customer's letter is used.
2. **Primary fields.** For `qty`, `location`, `width`, `drop`, `blindType`, `range`, `colour`, `fix`, `control1` and `control2`, the customer value becomes the export's and the result follows from the two exact values:

   | Export value | Blind IQ value | Result |
   |---|---|---|
   | Equal, or both blank | | MATCH |
   | Blank (left open on the order) | Filled in | NOT_SPECIFIED |
   | Filled in | Blank | OMISSION |
   | Different | | MISMATCH |

   Numbers compare as numbers, names after `normName`, and blind types through `BT_RENAMED`, so the Element names Blind IQ retired on 1 August 2026 (for example "Element Roller Sys 40" and "Roller System 40") compare equal. Confidence becomes 1, and the field gets `exact`.
3. **Options.** Only where both sides have the option with a value. An option left at the sheet's default isn't printed on the export, and the cassette Blind IQ carries on its own Valance line stays with the AI and the standards.
4. `data.exactReading` records `{ source, lines, paired }`.

The rule checks and validations then run as for any order: for example, an empty Control 2 on the export becomes NOT_SPECIFIED, and the control rule matches it as the pin opposite the chain.

## The second reading

### When to read twice: needsSecondReading

The second reading costs about a third of a comparison, so Russel limited it to handwritten or unclear orders. That's decided from the files, before any AI call, and only for pairs where the converter read none of the customer files. `needsSecondReading(files, pdfjs)` asks `customerFileLegibility` about each file and stops at the first unclear one, returning `{ needed, file, kind }`; `index.html` keeps `kind` as `_secondReading.why`.

| Test, in order | Verdict (`kind`) |
|---|---|
| An image file, by extension or MIME type | Unclear: `photo` |
| Not a PDF | Clear: `other` |
| pdf.js isn't available | Unclear: `pdf not checked` |
| A page (of the first 20) with a picture and under 60 characters of typed text; form-field values and free-text annotations count as text | Unclear: `scan` |
| A page with a picture where at least half the text is drawn invisibly (an OCR layer over a scan) | Unclear: `scan with OCR text` |
| A page with 4,000 or more curve segments (pen strokes flattened by a tablet app; typed order forms have at most about 800) | Unclear: `pen strokes` |
| 10 or more ink-annotation strokes in the document (a signature has fewer) | Unclear: `handwriting on the PDF` |
| Under 60 characters of typed text in the whole document | Unclear: `no typed text` |
| pdf.js can't open the file (damaged or password-protected) | Unclear: `pdf not readable` |
| Otherwise | Clear: `typed` |

The thresholds are the constants `MIN_PAGE_TEXT`, `MIN_INK_STROKES`, `MIN_PEN_CURVES` and `MAX_PAGES`. On the A/B test's files, all 10 handwritten orders were photos or scans without text, and all 11 typed orders, "as per quote" orders included, had at least 300 characters of text.

### reconcileSecondReading

`reconcileSecondReading(data, reading, { minConfidence = 0.8 })` compares the customer-only reading with Pass 1, and only acts where Pass 1 reported the customer value as exactly Blind IQ's (a MATCH or NOTE whose customer value equals Blind IQ's, the "read as Blind IQ" pattern behind most missed mistakes).

1. **Garbled answers.** A line whose text fields run over 80 characters or contain line breaks is dropped (`isCleanReadingLine`). If fewer than 70% of the lines are clean, the whole reading is ignored (`skipped: 'garbled reading'`).
2. **Pairing.** `pairReadingLines` scores each pair of reading line and comparison line: +3 for a matching width and +3 for a matching drop (within 5 mm of Blind IQ's value or of the AI's customer value), +4 for a width and drop swap, up to +2 for the same location words, and minus up to 4 for sitting at different places in the two lists. Valance lines only pair with valance, pelmet, cassette, track or fascia readings (or readings without a drop), and their drop always counts as matching. Pairs scoring over 0.5 are taken best first, one to one. Only comparison lines with an item letter and a numeric Blind IQ width, and reading lines with a numeric width or drop, take part.
3. **Width and drop.** Flagged when the second reading is at least 300 mm, differs from Blind IQ's by more than 2 mm, has a confidence of at least 0.8, and the pairing is confirmed by the other dimension, by a width and drop swap, or by a location similarity of 0.6 or more. A valance line's drop is never flagged.
4. **Quantity.** Flagged when the second reading is a different positive number with a confidence of at least 0.8.
5. **Colour.** Flagged when the second reading has a confidence of at least 0.85, isn't "as above", "same" or a ditto mark, and shares no word of three letters or more with Blind IQ's colour.

A flagged field becomes a MISMATCH whose customer value is the second reading. Its confidence drops to the lower of the two, and `secondReading` keeps `{ value, confidence, firstReading, why }`, where `why` is `size`, `width and drop swapped`, `quantity` or `colour`. The report marks it "2nd reading" and shows both readings.

## The Zip X motor table: js/outdoor-motors.js

Russel (October 2026): "zip x blinds should follow the specific zipx table to determine which Somfy motor to use". The table is in the Outdoor Price List of July 2026 (page 14, "Maestria Motor for Zip X Blinds"): two width × drop grids of the Somfy Maestria io torque, every motor 17 rpm. Ruling 3 (Russel, 23 September 2026) applies the same grids to Free Hang, Channel X and Wire X, as the conservative choice, because a blind without side zips drags less than a Zip X of the same size.

**The data.** `TABLE_WIDTHS` (800 to 7000 mm) are the columns, `TABLE_DROPS` (800 to 5000 mm) the rows, and `MOTOR_TABLE[78]` and `MOTOR_TABLE[95]` hold the torque in Nm for the 78 mm tube (135 mm cassette, or none) and the 95 mm tube of the 165 mm cassette. A 0 means "NA": no motor at that size.

**The helpers.**

- `tubeOf(item)` is 95 when one of Blind IQ's options for the line names the 165 mm cassette or a 95 mm tube and is switched on (for example "Full Cassette 165mm=Yes"), else 78.
- `tableTorque(width, drop, tube)` reads a size between two lines of the table at the **next width and drop up**: `{ torque, readAt, tube }`, or `{ beyond: true }` past 7000 × 5000 mm. For example, 5740 × 3690 on the 165 mm cassette is read at 6000 × 4000: 25 Nm. That blind (BDO652491) had been made with 15 Nm, and the 25 Nm motor was sent free of charge afterwards.
- `maestriaTorque(desc)` takes the torque from a sundry name such as "Maestria IO 25nm/17rpm".

**validateOutdoorMotors(data).** Called last by `runPostAIValidations`:

1. Takes the lines where `isTableBlind` matches Blind IQ's blind type (Widescreen runs on a 105 mm tube and isn't on the table) and Blind IQ's controls mention a motor.
2. Lists the Somfy Maestria motors among the sundries, one entry per unit.
3. Pairs the most demanding blind (highest table torque, then largest area; sizes with no motor last) with the strongest motor, and so on down. That's the pairing most in the order's favour, so an error means no way of fitting those motors to those blinds follows the table.
4. For each line, removes the weight-based `requiredTorque`, `requiredTorqueSafety` and `torqueValidation` (that estimate gave the blind above 6.6 Nm), sets `motorTable` = `{ torque, tube, readAt, ordered }`, and sets `motorTableValidation`:

| Situation | `type` | Shown |
|---|---|---|
| The paired motor is smaller than the table's | `error` | Red; counted in the critical summary |
| The table has no motor at that size, or the size is beyond the table | `warning` when a Somfy Maestria motor is on the order, else `info` | Yellow or blue |
| No Maestria motor left for this line (ShawSmart, or the customer's own motor) | `info` | Blue |
| A bigger motor than the table's | `info` | Blue |
| The table's motor | `info` | Blue |

It returns `{ checked, errors, warnings }`, which `index.html` doesn't use. Replayed over every motorised outdoor line on io orders since the io launch (19 May 2025), 225 lines: 130 had the table's motor, 78 a bigger one and 16 a smaller one.

## Adding a new rule safely

1. **Pick the right kind.** A rule MATCH (`autoMatch`) when the difference is only formatting; a rule NOTE (`autoNote`) when the rule can explain a difference but the capturer should still look; a rule MISMATCH (`ruleFlag`) when the rule knows Blind IQ's value is wrong. These helpers keep `aiResult` and `aiCustomerValue` and record the change; never overwrite a result without them.
2. **Keep it pure.** Write it in `js/comparison-checks.js` (or a new module): no DOM, no Firestore, no `fetch`. Anything it needs from outside, like the catalogue, comes in through `opts`.
3. **Place it deliberately.** Rules run after the exact reading and the second reading, and before the validations and `applyConfidenceThresholds`, so a rule MATCH on a field the AI scored under 0.75 still ends up as a NOTE.
4. **Mind deploy timing.** If `index.html` needs to call a new export, reach it through the `Checks` namespace and test for it before calling it (`if (Checks.<newRule>) …`), as `runComparisonPipeline` does for `applyExactReading`, and ship the module before the `index.html` that calls it. See [User interface](../app/user-interface.md#module-imports).
5. **Test it in node.** Add a test file to the private regression package (`orderbot-tests.zip`), with real cases that must match and real cases that must not, and run the whole suite against your clone. See [Testing](../testing.md).
6. **Replay it against the history where you can.** Run the old and the new module over saved `orderbot_comparisons` and count which flags change. Then check whether those fields were changed on the order afterwards, which says whether the rule hides real mistakes. The October 2026 replays (for example the 17,792 comparisons for Perfect Fit) did exactly this; their scripts are in `analysis-tools/` of the regression package.
7. **Tell the AI the same.** If the rule encodes a Blind Designs standard, keep `BD_STANDARDS` in step and bump `PROMPT_VERSION` (see [Comparison AI context](ai-context.md#prompt_version)).
8. **Record the ruling and the evidence** (who decided, which orders, the counts) in the commit message and `CLAUDE.md`, and update this page.

## Known weak spots

- The range rule depends on the converter's catalogue having loaded; a comparison started straight after opening the page may run without it.
- Normalising can't see dealer synonyms ("Roller" for "Roller System 40"): those stay with the AI and `BD_STANDARDS`.
- The control rule assumes Blind IQ's left-in-Control-1 convention and only covers roller-type blinds and venetians.
- `BT_RENAMED` is a fixed list of five renamed blind types. A later rename in BlindIQ needs adding by hand.
- The Zip X table is copied by hand from the July 2026 price list. A new price list means updating `MOTOR_TABLE`.
- The second reading's line pairing is a scoring heuristic. A colour is only flagged when it shares no word with Blind IQ's, so a near miss such as a different shade in the same family isn't caught.

## Related pages

- [Comparison pipeline](pipeline.md)
- [Comparison AI context](ai-context.md)
- [Comparison validations](validations.md)
- [Converter rules](../converter/rules.md)
- [Mappings and catalogue](../converter/mappings-and-catalogue.md)
- [Testing](../testing.md)
- [Glossary](../glossary.md)
