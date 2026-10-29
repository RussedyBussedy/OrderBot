# Converter rules

The business rules the converter applies after a document is parsed, grouped by subject. Each rule gives the function that implements it, what it does in a line or two, and the ruling or evidence behind it. Most live in the shared rule pipeline, so every layout and the comparison's converter reading get them; a few belong to one dealer's normaliser and say so.

## How to read this page

- **Where rules live.** Shared rules run in the 14-step pipeline (`refresh()` and `biqRunRulePipeline`, see [Converter overview](overview.md#stage-3-the-shared-rule-pipeline)). `biqApplyOptionDefaults` holds most of the documented standards. Layout-specific rules are in the `biqNormalize…` functions ([Dealer formats](dealer-formats.md)).
- **Evidence.** A rule went in only when BlindIQ's stored orders back it. The counts below come from the code comments and `CLAUDE.md`. The October 2026 replays (every document converted since June 2026, compared item by item with what BlindIQ stored) took the share of items fully correct from 30.4% to 73.2% across the two October 2026 rule sets. Rulings by Russel (product owner) and Paul are dated.
- **Conventions.** An assumption is written into the line's notes, ending "— confirm" where the capturer should check. A doubtful decision is an amber warning (`biqCollectWarnings`), never a red problem. A value is decided once per line, so the capturer's own choice survives the next refresh ([Decided once per line](overview.md#decided-once-per-line-the-capturers-value-wins)).
- **Data dependence.** Many rules read the catalogue refresh (option sheets, range links, retired flags). Until it is imported they stay silent. See [Mappings and catalogue](mappings-and-catalogue.md).

Terms such as range, fix, control drop and valance are in the [Glossary](../glossary.md).

## Sizes and 5 mm steps

| Rule | Where | Ruling or evidence |
|---|---|---|
| Widths and drops read off an order are rounded once to BlindIQ's 5 mm steps (…1 and …2 down, …3 and …4 up), and the change is noted ("Size in 5mm steps (…)"). This applies to the products in `BIQ_FIVE_MM_TYPES`, matched on BlindIQ's type name: roller, double roller, Vision, wood, retro, 35mm Aluminium, valance, 90mm vertical, Roman, RomaShade, Allusion, bamboo, Curtain Ripple and Glide. Shutters, Perfect Fit, outdoor and skylight products are made to the millimetre and left alone. | `biqRoundSizes`, called by `biqRecomputeControlDrops` | 99%+ of 2026 manual sizes on these products are on a step (Roller System 40 widths: 25,748 of 25,778). Capturers rounded 287 of 512 off-step converted sizes by hand. Only the first pass rounds (`_sizeRounded`). |
| A stated venetian valance width (Val Size) is rounded the same way, and noted. | `biqVenetianValSize` | Every Val Size on 2,053 wood and 743 retro lines ordered since August 2026 is on a step. |
| A shutter measured at three points ("T: 526\|M: 526\|B: 526") takes the smallest figure, with the measurements in the notes and an amber "confirm". | `biqTripleSize` (Blind Guys shutter sheet) | Reveal fit. |
| BlindIQ's own size limits: a message saying the blind "cannot be made", or "cannot accommodate a motor" on a motorised line, is a problem; any other limit is an amber heads-up. | `biqSizeWarnings`, read by `biqCollectProblems` and `biqCollectWarnings` | BlindIQ's width and drop thresholds and `SizeWarnings` messages (the `sizeWarnings` category). |
| A valance line's width is the order's numeric width, else the blind width + 15 mm with "width auto-sized: blind +15mm — confirm". Dropdown text such as "Standard (15mm wider than blind width)" counts as no width. | `biqExpandValances` | Russel, 7 Aug 2026. Digit-stripping that dropdown once produced a 15 mm valance. |

## Control drops and formulas

| Rule | Where | Ruling or evidence |
|---|---|---|
| A length the order states wins: "Custom: 3640", "4480mm", "Custom 2.5" (metres). "Standard" or a percentage means the formula. | `biqStatedControlLength` in `biqComputeControlDropV2` | BlindIQ stored the dealer's figure on 9 of the 10 such lines checked since June. |
| Otherwise the range's own BlindIQ formula from `rangeFormulas`: "[drop]*0.75", "[drop]*0.66", "[drop]-N", a fixed length, or "0" (no control drop). | `biqComputeControlDropV2` | BlindIQ's own formulas. |
| Results are rounded half to even, like .NET's `Math.Round`. | `biqRoundHalfEven` | On 2026 manual Roller System 40 orders an x.5 result is stored even 3,353 times of 3,524. Truncating left a 1 mm difference on about 1 line in 4. |
| An unknown range uses the formula every live range of the blind type shares, else 75%. | `biqTypeFormula` | Allusion and the venetians all use 66%; the old 75% fallback put 9 such lines 9 points out. |
| A System 40 1.5:1 blind's automatic control drop is 80%. | `biqRecomputeControlDrops`, `biqApplyOptionDefaults` | All 47 stored lines at exactly 0.80 of the drop are 1.5:1 blinds. |
| An automatic control drop follows later changes; a typed one stays (`_cdAuto`). | `biqRecomputeControlDrops`, the editor | — |
| A Finish Logic purchase-order note that is only a chain length ("Chains must be 1100mm long") becomes the control drop on a chain-driven line, from 300 to 6000 mm. | `biqBdpoChainNote` | The TBD capturer keyed the length as the control drop each time. |

The exported `biqComputeControlDrop` (75%, floored) is legacy: nothing calls it.

## Controls and drives

BlindIQ has two control fields, and how they are used depends on the product:

- **Side in the column** (rollers, Vision, double rollers, Perfect Fit): the side picks the column, "Lh Chain" in Control 1 and "Rh Pin" in Control 2.
- **Side as a value** (venetians, bamboo, Roman panel, RomaShade): Control 1 is "Left" or "Right"; Control 2 is a mechanism only when stated.
- **Single column** (outdoor, cellular, curtain motors): both sides' options live in Control 1, and Control 2 is another axis (Free Hang, Tensioned, stacking).

| Rule | Where | Ruling or evidence |
|---|---|---|
| A roller-type blind that states one drive side gets a pin on the other, unless it has an intermediate or coupled bracket. | `biqInferControls` (with `biqRequiresDualControl`) | A missing side on these products is a problem. |
| Controls are re-encoded to the convention of the line's type and range. Only values that don't fit the range's control lists are rewritten; bracket pairs and Dual are left alone. | `biqNormalizeControlSides` | The wood venetian column report of 12 Aug 2026. |
| Where BlindIQ allows only one value on a side, an illegal value is replaced with it (Cellular Control 2 must be Free Hang). An illegal manual drive is swapped to the only manual family the side allows ("LHC" on a cellular is Lh Cordlock). | `biqApplyControlMatrix` | BlindIQ's per-range control lists (`controlsScoped`; seed for Cellular Free Hang in `BIQ_CONTROLS_SCOPED_SEED`). |
| Twin control records (Stack Left 29 / 45, Stack Right 30 / 46, Wand 28 / 57, Lh Spring 186 / 187) export the ID the line's own range lists. | `biqResolveControlScoped`, `biqControlAllowed` | The export sent 45 on all 44 converted vertical lines since June; verticals store 29. |
| **One Touch Dual:** "LH Motor" / "RH Motor" become "LH Dual" / "RH Dual" when the line names a One Touch Dual motor or, with no motor named on the line, when the order's only motors are One Touch Dual. Decided once per line. | `biqApplyOneTouchDual` (`BIQ_OT_DUAL`, `BIQ_OTHER_MOTOR`) | Paul's One Touch Dual rule (5 Aug 2026): a plain Motor spec makes the blind too narrow. Capturers changed 75 converted motor sides to Dual by hand. |
| **Venetian operation:** wood and retro venetians under 600 mm are Split and 600 mm or wider Grouped; 35mm Aluminium is always Grouped. A stated Grouped on a narrow wood or retro blind becomes Split, noted "confirm". Decided once. | `biqApplyVenetianOperation` (`BIQ_VENETIAN_SPLIT_BELOW`) | 2026 orders: wood 1,603 of 1,649 Split under 600 and 6,716 of 6,788 Grouped from 600; retro 432 of 453 and 2,170 of 2,205; aluminium 2,518 of 2,518 Grouped. |
| **Intermediate and coupled brackets:** a bracket option is moved onto the blind type's own key (Roller System 40 / 55 "Intermediate Bracket" and "Coupled Bracket"; the retired System 40's `Intermediate/Coupled  Bracket`, with two spaces; Vision's "Intermediate"). A No or blank phantom is dropped. | `biqApplyBracketPairs`, `biqBracketOptionKey` | Russel, 7 Aug 2026: the literal key was flagged "not a valid option" and never imported. |
| Pairs: "couple with next line" (`_bracketWith`, from TBD's Joined To or the editor) wins, then consecutive lines flagged by notes ("centre / middle / intermediate bracket", "coupled") or a Yes on any bracket key are paired two by two. An intermediate pair keeps each blind's drive and makes its non-drive side "Lh / Rh Intermediate"; a coupled pair has one drive on an outer end, "Coupled" inner sides and a pin on the partner. Sides the document already states are never reshuffled. | `biqApplyIntermediatePair`, `biqApplyCoupledPair` | July 2026 test: an explicit pin overwritten into a double intermediate reached production. |
| When an order has more Rh than Lh Intermediates, the next line becomes the partner if it is the same blind type, its location starts with the same word and its left side is a pin or empty. It is set to Lh Intermediate, noted, with an amber "confirm". | `biqPairIntermediatePartners` | Right in 37 of 45 Mathéo cases. |
| A lone line that names its own intermediate side is complete; any other unpaired flag is a problem (`_bracketOdd`). | `biqApplyBracketPairs` | Blind Guys stacker doors: 7 of 8 such pairs stored with the neighbour's own drive. |
| Intermediate costing follows the controls: every blind with an intermediate right side carries Intermediate Bracket = Yes, a left-only blind carries No, and surplus left-only blinds keep Yes so each bracket is costed once. | `biqReconcileIntermediateCosting` | Costed on the right-side blind in 26 of 27 imported Mathéo pairs; 10 of those had been fixed by hand. |
| Hinged shutters carry the hinge layout ("H L", "H L R T L R") as Control 1, from "2P - LR" style wording, when the range offers it. | `biqShutterHingeControl` (Blind Guys and Mathéo) | 59 converted shutter lines since June arrived without one. |
| Allusion: Monocommand is "Wand Lh And Rh", "RH / LH Cord" is "Cord Right / Left", and stacking goes to Control 2. | `biqNormalizeMatheo` (Mathéo sheets only) | Russel, 31 Aug 2026; as stored on every Allusion cord line. |
| A vertical's or Allusion's required Control option, when the order gives none: a wand is Mono-command, a White or Black track gets that colour's Chain & Cord, noted "confirm". Anodised and Anthracite tracks stay with the capturer. Decided once. | `biqApplyOptionDefaults` | Russel, 10 Oct 2026. 54 of 67 stored verticals with a White or Black track carry that chain & cord; 9 of 9 Allusion Monocommand blinds are Mono-command. |
| Double roller drives: see [Double rollers](#double-rollers). System X cranks: see [Outdoor and System X](#outdoor-and-system-x). | | |

## Fixes

| Rule | Where | Ruling or evidence |
|---|---|---|
| Dealer fix wordings are aliases: F/F, FF, Face Fix, F/Fix → Face; I/R, Inside Reveal, Recess, Rev L / R, R/Fix, Special - Reveal → Reveal; T Fix, Top Fix → Top; Side Fix → Side. | `BIQ_ALIASES.fixes` in `biqResolve` | F/Fix: 116 of 117 converted Mathéo lines stored Face. |
| A Top fix on a range whose list has Reveal but not Top becomes Reveal, noted. | `biqRepairTopFix` | No live range offers Top. Capturers turned all 15 converted Roller System 40 "Top" lines into Reveal. |
| Curtain ranges take no item fix: Top / Face / Face Double move into the Top Fix / Face Fix / Double Face Fix options, anything else into "Other Fix?", and the item fix is cleared. | `biqApplyOptionDefaults` | 2,821 of 2,837 manually captured 2026 curtain lines leave the item fix empty. |
| A fix the range doesn't offer, or any fix on a range that takes none, is a problem. | `biqCollectProblems` with `biqRangeFixIds` | Since June 0.48% of imported blinds were stored with such a fix, against 0.07% of manual ones. |
| Perfect Fit gaskets: see [Perfect Fit](#perfect-fit). Finish Logic purchase orders: Cassette Fix fills an empty fix, and a valance with a top board is Face fixed (`biqNormalizeBdPo`). | | 5,933 of 6,185 stored valance lines with a top board are Face fixed. |

## Options and defaults

| Rule | Where | Ruling or evidence |
|---|---|---|
| Each line's options come from BlindIQ's option sheet for its type and range, falling back to the type's union template. | `biqVariantSpec`, `biqTemplateFor2` | Options are per type and range in BlindIQ; a Linear valance must not be asked for Finials. |
| Dealer option names fold onto BlindIQ's keys: Hardware / Mechanism Colour, Comp Col → Mech Colour; Bott Bar Col → Bottom Bar; Roll → Roll Type; Int Bracket → Intermediate Bracket; Chain Type or Steel Chain (steel / yes) → Steel Ball Chain = Yes. An explicit value on the real key wins. | `biqFoldOptionSynonyms` (`BIQ_OPTION_REMAPS`) | — |
| Values are put in BlindIQ's spelling. Silent: case only, or spacing and punctuation only. Noted as "read as": bracketed qualifiers ("Beige (S40)"), "4x" → "4 x", US spellings and -ible / -able ("Collapsible" → "Collapsable"), broken words ("Anthracit e"), "Light Grey" where BlindIQ has one grey, a value followed by a remark ("100mm >1200 height"), sized returns ("15mm LH & RH" → "LH & RH"), "Standard (Cord Lock)" → "Std (Cordlock)". | `biqFoldOptionSynonyms` | 17 Mathéo "Anthracit e" lines, 13 hold-down lines, 8 Light Grey mechanisms, 9 shutter rail lines, 7 Linear valances: all stored as the BlindIQ value. |
| Comma-joined lists in BlindIQ's data ("50mm,100mm") are split into their values. | `biqSplitSpecValues` | Orders store "100mm", never the joined text; 63 lines were wrongly flagged. |
| Value synonyms: LHS / Left → LH, RHS / Right → RH, Both / LR / L&R → LH & RH, N / No / Nil → None, Std → Standard, used only when the value isn't already on the list. | `BIQ_VALUE_SYNONYMS` in `biqApplyOptionDefaults` | The BD order form's Valance Returns column offers None / LH / LR. |
| A required option with one legal value takes it when the order's wording is part of it, noted. | `biqApplyOptionDefaults` | Double roller "Standard" → "Top Waterfall Bottom Standard": all 34 converted double rollers stored that way. |
| Template leftovers: once the range's own sheet is known, a key that sheet doesn't have and that still holds the template default is removed. | `biqApplyOptionDefaults` | 106 Blind Guys wood venetian lines flagged "Val Type = Standard". |
| Defaults for options the order didn't give: a required option with one value gets it; one with a BlindIQ default gets that; a required Yes / No or free-text option gets No; an optional Yes / No toggle gets No ("absence = No" in BlindIQ). A colour option is never defaulted unless BlindIQ offers just one value. | `biqApplyOptionDefaults` | System Choice "Sys 55 Large Bracket" was set by hand 28 times. |
| A required choice whose other values are all "for Motor Only" takes the remaining value on a blind with known, non-motor controls. | `biqApplyOptionDefaults` | Roller System 55 System Choice. |
| An option value not on BlindIQ's list, or a key not on the sheet, is never silently dropped: it is a problem ("will NOT import") until corrected. | `biqDroppedVariants` in `biqCollectProblems` | July 2026: cassettes, inserts, a valance and a smart plug were silently lost on one order. |

## Hardware, bottom bar and cassette colours

| Rule | Where | Ruling or evidence |
|---|---|---|
| Roller System 40 / 55 hardware is White when the order gives none, noted. "TBC" stays flagged. Decided once. | `biqApplyOptionDefaults` | "White will be supplied if unspecified" (Blind Price List July 2026); every replayed line outside Lifestyle that arrived without one was stored White. |
| A stated cassette colour decides the hardware when the hardware isn't stated (Silver cassette → Grey hardware), noted. | `biqApplyHardwareColours` | 867 of 875 stored System 40 lines that state a cassette colour carry the matching hardware. |
| The bottom bar and a colour-valued cassette follow the stated hardware: Grey → Silver (bar and cassette), Beige → White aluminium bar (a Beige cassette exists). Generic wording ("Covered Aluminium", "Std", "Matching", "Yes") is read in the hardware colour. A valid explicit value is never overridden. | `biqApplyHardwareColours`, `biqHardwareMatch` (`BIQ_HW_SUBST`, `BIQ_BAR_GENERIC`, `BIQ_CASSETTE_GENERIC`) | About 40,000 System 40 blinds 2024–2026: bars and cassettes 95–99% the hardware colour; Grey hardware gets Silver 95–96%, Beige a White bar 85%. |
| A bare "Cassette = Yes" with no hardware colour on the order stays flagged: the cassette colour is never guessed (unless BlindIQ offers one value). A Mech Colour the AI read off the document is stated, White too. | `biqApplyHardwareColours`, `biqAiResultToOrder` | — |
| Hardware colours match letter for letter ("Anthracit e (S40)" is Anthracite). | `biqHardwareMatch` | 17 bars had fallen back to White. |
| A layout that gives hardware but no bar clears the template's White bar, so it follows the hardware. Mathéo and the BD order form mark this with `_barToHardware`, which adds a note; CNBW clears the bar without the note. | Mathéo, BD order form and CNBW normalisers, then `biqApplyHardwareColours` | 96% of stored System 40 / 55 lines. |
| `_hwFromOrder` marks a hardware colour read off the order, even White, so no default replaces it. | parsers | — |

## Valances and cassettes

| Rule | Where | Ruling or evidence |
|---|---|---|
| A valance ordered on a blind line stays an option when the product's option sheet carries the key (wood venetian Val Size / Val Returns / Mitre, Retro valance and bottom type). Otherwise it is staged in `_valance` and ordered as its own Valance line. Unknown blind types are left for flagging. | `biqStageInlineValances`, `biqExpandValances` | Russel, 7 Aug 2026: customers order valances on the blind line, BlindIQ separately. |
| The valance line's product follows the parent ("Element …" → Element Valance, else Valance), switching to the sibling product when the requested range exists only there. Range comes from the Linear / Half Round wording; drop from the profile size ("Linear 150mm" → 150), else 0; width as in [Sizes](#sizes-and-5-mm-steps). The parent's note points at the new line ("Valance for this blind is line N (do not add it here)"). | `biqExpandValances` | BDO665443: a capturer typed the valance options onto the roller while the real valance line went out blank. |
| "Type of Blind" on the valance sheet comes from the parent's blind type ID; "Return: Black" in a line note fills End Cap Colour; LH / RH Side follow Val Returns (Return End Cap on the side with a return), noted "confirm". Explicit dealer values are never overridden. The sibling's option template is borrowed when the chosen valance type has none. | `biqExpandValances` (`BIQ_TYPE_OF_BLIND_BY_ID`) | Russel, 7 Aug 2026; the dominant pattern in stored orders. |
| A valance-only row (no blind type, fabric or drop) is rebuilt in place as the valance; its own width wins, and a different valance-width cell is noted "confirm". | `biqExpandValances` (`_valanceOnlyRow`) | A Blind Guys "valance only" row once produced a phantom roller plus a valance of the wrong width. |
| Valance returns not on the order: None on a reveal fix, LH & RH on a face fix (noted "confirm"). A written None / No is kept. | `biqApplyOptionDefaults`, `biqExpandValances` | Blind Price List grids; 90% of face-fix lines that arrived without returns are LH & RH. |
| Cassettes stay options. Every cassette and insert wording folds onto the type's own colour-valued cassette option (`biqCassetteOption`) and insert toggle (`biqInsertOption`): "Cassette = Yes" with "Cassette Colour", "Cassette = Black", "Cassette = Grey" (Silver), "Cassette = 70mm / Open / ✓ / a length" (Yes), "System 40 70mm Cassette", "70mm Cassette", "Sys 40 70mm Open Cassette", "Cassette with Fabric Inlay", "Fabric insert on cassette"; "Open 70mm White" or "Black with Duo Screen … fabric insert" is read for its colour, and the insert, with the words in a note. "No" (None, N/A, -) means no cassette, and the colour beside it goes too. The sheet's own usable value wins over a stray dealer colour, which is noted; a template default (a double roller's White) gives way to the order's colour. Vision and Romashade colours are "70mm <colour>". | `biqFoldCassette`, `biqReadCassette` | 190 AI-read cassette blinds, 10 Jun – 28 Oct 2026: 26 kept the cassette; "Cassette=Black", "Cassette=70mm" and "Fabric Insert=Yes (same fabric)" were dropped without a word. |
| What can't be read is never dropped. Two colours, "White or Black", "Not black" and wording still undecided ("TBC", "not sure", "Black?") stay red on the cassette option. A closed cassette a Roller System 40 doesn't offer stays red even over an open one, which is noted (BDO669483); "not closed" and "closed not available" aren't closed. An open, 70 mm or Sys 40 cassette on a Roller System 55, and a cassette or insert on a type without one, stay red on the line. | `biqFoldCassette`, `biqReadCassette`, `biqDroppedVariants` | — |
| Words that run into the insert describe it: "Charcoal insert" is the insert's colour, so the cassette takes the hardware colour; "Fabric insert + black cassette" is a Black cassette with the insert. "White PVC" / "PVC white" is BlindIQ's White PVC value, never plain White. A double roller's Cassette Colour taken from the hardware gives way to the colour the order states, noted. | `biqReadCassette`, `biqFoldCassette` | — |
| An insert: any wording that isn't a no ("Yes (same fabric)", "Duo Screen Charcoal", Mathéo's "1800") is Yes, the words kept in a note; a Valance "70mm Cassette" line's Yes is "Yes (Please list fabric in note)". "No insert", "without fabric inlay" or "insert: none" beside a cassette is the cassette without the insert. An undecided insert ("TBC", "not sure") stays red, and one declined or to be quoted separately isn't set. A cassette value that orders the insert ("Black with … fabric insert") sets it once per wording, so a capturer's removal stays. | `biqFoldCassette`, `biqInsertAsked`, `biqCassetteInsertFromValue` | — |
| AI readings only: a cassette left in the notes. A line note's "<colour> cassette", "with / incl. / and … cassette", "70mm cassette" or "one cassette for …" sets that line. An order note sets every roller line, but only when the AI put a cassette on none of them, and only a sentence that names no blind (a location, "blinds 1 & 2", "#3", "A and B", a shared or long cassette) and no other product (double rollers, Vision, Romashades…). Skipped: "no / without / don't … cassette", "cassette: none", closed, separate, existing or own cassettes, parts (end caps, brackets, spares) and "Black cassette?". The colour is the note's, else Yes (the hardware colour, or red); an insert in the same sentence is set. Each line is read once, so a capturer's later choice stays, and an order-note cassette the capturer clears stops the order note applying. A line note and an amber warning say where it came from. | `biqCassetteFromNotes`, `biqCassetteMention` | "Incl. White Cassette" (Blind Guys Kempton Park), "With Black Cassette" (Décor Accessories), "6x Roller Blinds … And 70mm Cassette" (Sew Sandton): 64 AI-read cassette blinds came through with nothing about the cassette. |
| A fabric insert on a blind with no 70 mm cassette is an amber warning. | `biqCollectWarnings` | TBD's BDO671259 PO (item e; Sharon removed it), BDO669160 D, Galaxy's BDO673492 I–K. |
| A cassette that is on gets Cassette End Cap = Full End Cap when empty. | `biqApplyHardwareColours` | 97% of orders using the option; 465 of 551 manual System 40 cassette blinds since 11 Aug 2026. |
| A cassette replaces the bracket covers: a sheet's Remove Bracket Covers = Yes is dropped once, noted. | `biqApplyHardwareColours` (`_rbcChecked`) | Only 13 of 4,122 manual 2026 cassette blinds keep it. |

## Wood and retro venetians

| Rule | Where | Ruling or evidence |
|---|---|---|
| Wood slat wording is the range: "Wood 50", "50mm Wood", "Wood", "Basswood", "Timber" → Classic; "Wood Alloy" → Wood Alloy Std Classic. Woodgrain, faux, PVC and aluminium wording is left alone. A deliberate global mapping to a real range of the type wins. | `biqWoodRangeWording` in `biqResolveRange` (TBD's `BIQ_TBD_WOOD_RANGES` rule, for every layout) | All 61 converted "Wood 50" lines (15 Aug – 13 Oct 2026) were stored as Classic; Classic's formula then gives the 66% control drop. |
| The valance stays on the blind: dealer keys become Val Size ("Std" or a tick → Std, a number, "No"), Val Returns ("N" → None, "LR" → LH & RH), Mitre Val LH / RH, and a Standard Val Type; a "Std" or matching colour is consumed; anything else goes to the notes. It never becomes a separate Valance line. | `biqFoldVenetianLine`, `biqFoldVenetianValance` | 7,631 of 7,635 wood and 2,385 of 2,386 retro lines in 2026 carry Val Size; 36 phantom valance lines on 8 converted orders. |
| Val Size when the order gives none or "Std": blind width + 15 mm, noted ("Val Size Std = blind width + 15 mm" or "… not on the order … confirm"). A stated width (rounded to 5 mm) and a stated "No" stay; a Retro with Remove Valance = Yes is left alone. Decided once; an automatic value follows later width changes (`_valSizeAuto`). | `biqVenetianValSize` | The BD form prints "Std = width+15mm"; 70% of 2026 wood and 61–80% of retro valances are exactly that. The old generic default put "Val Size = No" on 260 of 440 lines. |
| Retro venetians with Standard slats and no valance colour get "Aluminium: <slat colour>" and type Aluminium, noted "confirm". Printed or perforated slats and Foiled trims are left alone. | `biqApplyOptionDefaults` | Retro product page; all 27 stored lines of orders that didn't state one. |
| Venetian operation (Split / Grouped): see [Controls and drives](#controls-and-drives). | | |

## Double rollers

BlindIQ's double roller (type 28) is one blind with two fabric options, Blockout Fabric and View Fabric. Its three ranges (611, 734, 917) carry no colours; they are the price groups of the blockout fabric. Controls are Lh / Rh Double Chain, Double Motor, Double Chain/Motor, Double Dual and Pin. Before October 2026 none of the 86 converted double rollers came through right.

| Rule | Where | Ruling or evidence |
|---|---|---|
| Both fabrics are found wherever the order wrote them: the options, texts a layout kept (`_drTexts`), "Texblock + 5 Screen" with "Mink / Dune Grey", range plus colour, the original wording. Names match as whole words against the option sheets ("5Screen" = 5 Screen, "Text Block" = Texblock, "Bd E" and "Blind" ignored, the longest name wins, a tie gives nothing). | `biqApplyDoubleRollers` (end of `biqReSplitFabrics`), `biqDoubleRollerFabricsIn` | Russel, 14 Oct 2026. Replay: lines fully right 27 → 56 of 81. |
| The range follows the blockout fabric when it is first read or changes (`_drRangeFor`); a range the capturer picks stays. The item colour is cleared. | `biqApplyDoubleRollers` | The range was Roller System 40's or blank on 61 of 86. |
| The order's wording is read only the first time (`_drRead`); afterwards only the two options count, so a capturer's fabric is never replaced. "Sheer" alone is an amber flag, never a guess. | `biqApplyDoubleRollers` | — |
| Options a double roller lacks become values or notes: Mech / Hardware Colour → Cassette Colour (Grey → Silver) with the bar following; Roll Type "Standard" / "Waterfall" → the only value, silently, and any other roll type a note plus an amber flag; Steel Ball Chain, Chain Tidy, Chain Colour → one note each; "<colour> cassette" in the line note sets Cassette Colour once. | `biqApplyDoubleRollers` | Mathéo: chain options were red on 16 of 19 lines. |
| A second fabric written on the next, size-less row (BD order form, AI reading) is merged into the blind above, top down, never across two different drives; letters are renumbered. | `biqMergeDoubleRollerRows` | A hand-filled BD form read by the AI became two blinds. |
| **Motors:** the order's wording decides first ("motor on both fabrics", "Double Motor" → both; "chain/motor", "blockout motorised", "no motor on the screen" → one); then a count on the line ("2 x"); then the motors left on the order once every other motorised line has its own (two per blind → both). Both → Double Dual for One Touch Dual motors, else Double Motor; one → Double Chain/Motor plus "BLOCKOUT TO BE MOTORISED" unless the order names the fabric. Motors are never added or removed; an amber flag explains the decision while the control is still the converter's. | `biqApplyDoubleRollerMotors` (in `biqInferControls`) | Russel, 15 Oct 2026: "Flag orange to confirm if customer wants motor on both, but extrapolate based on how many motors are on the order." Stored: two motors per Double Dual / Double Motor blind 16 of 21, one per Double Chain/Motor 16 of 24, blockout motorised 30 of 33. |

## Perfect Fit

A Perfect Fit blind sits in its own frame, clipped into the window's beading on brackets ("clips", "gaskets") sized to the bead depth. BlindIQ's fix is the Gasket of that size.

| Rule | Where | Ruling or evidence |
|---|---|---|
| A line whose fix is unresolved or the Universal Frame, with a clip size in its fix, options or notes ("25mm clips", "Clip in, 18mm", "Frame depth: 15mm"; "18mm + foam" is 12), gets that Gasket. | `biqPerfectFitFix` (first in `biqApplyOptionDefaults`), `biqPfClipSize` | Russel: the Universal Frame "uses a 24mm clip internally but is not an option for the customer". BDO643569 went out on a Universal Frame and was remade on Gasket 24mm. |
| A bead depth with no Gasket of that size takes the one Gasket Louvolite's chart fits (Gasket N covers N−2 to N+1 mm; Gasket 12mm (18mm+foam) covers 12–15 mm), noted "confirm". 19, 21 and 23 mm fit two and 26–27 or 32+ mm none: noted "choose the fix". | `biqPfGasketsFor` (`BIQ_PF_GASKETS`) | Louvolite's beading depth chart. |
| A customer who writes the Universal Frame, Konnect or a magnetic fix keeps it. | `biqPerfectFitFix` | — |
| Every sized Gasket fix gets Remove Universal Frame = Yes once per fix (`_pfUfSig`); a capturer's change afterwards stays. Perfect Fit Roller's "Remove Universa; Frame" spelling is preferred. | `biqPerfectFitFix` | All 84 gasket lines captured since June 2026 have it. |

## Out of Warranty and size limits

| Rule | Where | Ruling or evidence |
|---|---|---|
| Out of Warranty is ticked, with the reason noted, when a blind is beyond the price list's selling limit: System 40 3200 × 3400, System 55 4000 × 4500, Vision 2200 × 2600, Allusion 3990 × 3000 (and at least 750 wide). | `biqWarrantyReason` (`BIQ_SELL_LIMITS`) | Rulings 4.1–4.4, Russel 10 Oct 2026. 13 of 13 stored System 40 / 55 / Vision lines over these limits are marked; Allusion 8 of 8 since 30 Aug. |
| …or when a Roller System 40 / 55 blind is more than 35 mm wider than its fabric's roll and the fabric turns only out of warranty or not at all. Designer fabrics are Do Not Turn, with the roll width taken from the colour ("Argent Gold 2050mm @"). | `biqWarrantyReason` (`BIQ_ROLL_FABRICS`) | Roller System Selector V2.1 and Blind Price List July 2026. Capturers marked 42 of the 43 stored lines this catches. |
| Decided again whenever type, range, colour, width or drop change (`_oowSig`). An automatic tick is removed when the blind comes back within the limits (`_oowAuto`); otherwise a capturer's tick or untick stays. | `biqApplyOptionDefaults` | — |
| Narrow, long rollers (System 40 or double roller under 600 mm wide with a drop of at least 2.9 × the width) only get an amber heads-up. | `biqNarrowLong`, `biqCollectWarnings` | Russel: the dealer and customer decide. Capturers ticked 64 and left 41. |
| **System 40 1.5:1** ("Upgrade Mechanism" on Blind Guys sheets) is set only when the sheet asks, the blind isn't motorised, and the blind or its intermediate partner that also asks weighs over 4 kg. Weight = fabric kg/m² × width × drop + bottom bar kg/m × width (0.28 aluminium, 0.36 SmartRail, 0.20 plastic). Lighter requests stay a note plus an amber heads-up. | `biqApplyOptionDefaults`, `biqRollerWeightKg` (`BIQ_FABRIC_KG`, `BIQ_DESIGNER_KG`) | Russel, 10 Oct 2026: never set unasked. Capturers kept 15 of 79 requests, the heavy ones; the selector's 1.5:1 range is 4–8 kg. |

## Curtains

| Rule | Where | Ruling or evidence |
|---|---|---|
| The fix moves into the curtain options (see [Fixes](#fixes)). | `biqApplyOptionDefaults` | — |
| A line colour that is one of the sheet's Colour values moves into that option and the item colour is cleared. | `biqApplyOptionDefaults` | Russel, 11 Aug 2026: a BlindIQ capture picks the track colour on the sheet. |
| Master Carrier: TBD's "Butt Arm Kit" becomes "Quiet Butt Arm Kit" where only the quiet part exists, and a "Quiet …" part becomes the plain one where the track has no quiet version (noted). | `biqFoldOptionSynonyms` | Russel, 11 Aug 2026; capturers stored the plain part on all 8 such lines. |
| A Butt Arm Kit on a one-way stack becomes a Single Butt Arm, and the reverse on a centre split or float stack, noted. | `biqApplyOptionDefaults` | All 334 stored curtain lines follow the stack. |
| Finish Logic purchase orders: "Motor Side" is Control 1 Lh / Rh Motor on a curtain track; the double track's "Runner Type and Spacing (Front / Back Track)" fill the one key (front value, back noted); a Crank Handle the sheet offers is the option. | `biqNormalizeBdPo` | 677 of 756 Curtain Somfy lines carry Lh / Rh Motor. |
| Curtain tracks and valances have no drop: an empty drop exports as 0 and isn't a problem. | `biqGenerateXML`, `biqCollectProblems` | Russel, 7 Aug 2026; TBD prints curtain drops as 0. |
| Finish Logic purchase orders: a motorised curtain track (Curtain Somfy: Movelite, Glydea) keeps White on its colourless range; any other colour is still flagged, because it would import as BlindIQ's colour of that name. | `biqCollectProblems` | The capturer kept White on all 9 such lines (Finish Logic review, 16 Oct 2026). |

## Cellular

| Rule | Where | Ruling or evidence |
|---|---|---|
| Headrail and bottom bar (or rail) colour are White when not given. Decided once. | `biqApplyOptionDefaults` | Cellular order grid: "white if not specified". |
| "Standard (Cord Lock)" is BlindIQ's "Std (Cordlock)". | `biqFoldOptionSynonyms` | — |
| Blind Guys Romashade and cellular sheets: "Control Type" plus "Control Side" become Control 1 and 2 (Lh / Rh Cordlock, Skylight Handle or Pole, Lh / Rh Motor; Free Hang, or Tensioned on skylights); "Stack" → Stack Choice; "Back Bar Colour" → Back Bars. | `biqBgRoller` | All 13 converted lines arrived without controls. |
| Cellular Free Hang controls are checked against a seeded matrix (Control 1 Lh / Rh Cordlock or Motor, Control 2 Free Hang) until imported data replaces it. | `BIQ_CONTROLS_SCOPED_SEED`, `biqApplyControlMatrix` | Confirmed against BlindIQ's dropdowns, 27 Jul 2026. |

## Outdoor and System X

| Rule | Where | Ruling or evidence |
|---|---|---|
| A crank-driven blind whose sheet offers exactly one crank Control gets it (System X: Zip X, Channel X, Wire X → Silver Crank 8:1). Free Hang has five crank colours, so its crank stays as ordered. | `biqApplyOptionDefaults` | Outdoor product page, rulings 30 Sep and 1 Oct 2026; 27 of 27 stored System X crank lines. |
| A motorised outdoor blind gets Crank Handle = None, and a crank the sheet still printed is noted as dropped. | `biqApplyOptionDefaults` | All 130 manually captured motorised outdoor blinds in 2026. |
| Finish Logic purchase orders: a line whose sheet requires a crank handle gets Crank Handle = None when the PO gives that line no crank or handle option (Finish Logic prints the handle on the one blind it comes with). A handle the sheet doesn't offer stays a problem; an amber heads-up appears when no blind on the PO has one. | `biqNormalizeBdPo` | The capturer stored None on all 5 such Free Hang lines (Finish Logic review, 16 Oct 2026). |
| Mathéo outdoor sheets: "Brackets: Black" is the Bracket Colour, columns named like sheet options go there, and the sheet's Control option mirrors the Controls column. | `biqNormalizeMatheo` | Russel, 7 Aug 2026. |
| Outdoor sizes are made to the millimetre and never rounded. | `biqRoundSizes` | — |

The Somfy motor size for Zip X and the other System X blinds is a comparison check, not a converter rule: see [Validations](../comparison/validations.md).

## Shutters

| Rule | Where | Ruling or evidence |
|---|---|---|
| The range is the panel count ("4 Panel Hinged", " Tier on Tier" when stated), from the panel column, the Mathéo price group ("(6P)") or a configuration string ("LTLTRTR"); the layout detail goes to the notes. | Blind Guys / Mathéo / CNBW normalisers, `biqApplyShutterConfig`, `biqDecodeShutterConfig` | Russel, 7 Aug 2026. |
| Hinge layout as Control 1: see [Controls and drives](#controls-and-drives). | `biqShutterHingeControl` | |
| Urban hinged shutter panels of 1201–1800 mm without a middle rail (and not Tier on Tier) get Rail Size 100mm, noted with what the order said. Decided again only when the drop or middle rail changes (`_railSig`). | `biqApplyOptionDefaults` | Shutter Price List July 2026; 44 of 48 stored lines, 15 of them over a dealer's 50mm. |
| Flexi and rigid scribe strips are not set on a new Urban shutter: noted, plus an amber warning. | `biqApplyOptionDefaults` | Ruling 23 Sep 2026: a spare or trade part; no stored Urban line carries one. |
| Rear Frame Cover is None on any frame but Multi L. | `biqBgShutter` | — |
| Shutter sizes are never rounded; three-point sizes take the smallest. | `biqRoundSizes`, `biqTripleSize` | — |

## Sundries and motors

| Rule | Where | Ruling or evidence |
|---|---|---|
| Motors, remotes, chargers, adaptors and other motorisation parts resolve only within BlindIQ's seven motor sundry types (Somfy RTS, Motion, One Touch +, One Touch Dual, Somfy Zigbee, Somfy io, ShawSmart), active items only. | `biqMotorSundryView` (`BIQ_MOTOR_ORDER_TYPES`), `biqAddMotorSundry(…, true)`, `BIQ_MOTORISH_RE` | Russel, 7 Aug 2026: the capturer picks the sundry type first. |
| Every other lookup uses active, orderable sundries only, never type 13 "Components Motor" factory records. An inactive or type-13 sundry on a line is a problem. | `biqOrderableSundryView`, `biqCollectProblems` | The Blind Guys motor bug: ambiguity with type-13 twins left every motorised line blank. |
| Matching: exact name or stock code; the name plus " #"; every word of the text in the catalogue name (single digits and letters matched as whole tokens); several keys naming one item are aliases; the plainest of several matches wins (not between colour variants); a second pass canonicalises "li-ion" / "lithium ion", "2.0nm", "15Nm/17" ↔ "15/17" and adaptor spellings. | `biqFuzzySundry` | Swept against all 502 items of the motor types: 502 resolve, 0 wrong (Russel, 7 Aug 2026). |
| The dealer's wording is tried bare, without brackets, without marketing tails ("Available in …"), without a leading "Somfy" or (motor parts) "Motors", and with "16ch" → "16 channel". Zigbee parts may drop the Sonesse size as a last resort. | `biqAddMotorSundry` | TBD prints "Sonesse 30/28 ZB Solar Panel"; the catalogue's Zigbee parts are size-less. |
| A colour-variant part with no colour on the order defaults to White, noted "— WHITE assumed (no colour on order)". An explicit colour is never overridden. | `biqAddMotorSundry` | Russel, 7 Aug 2026. |
| Resolved sundries carry BlindIQ's own name in the notes; the dealer's wording stays in `_src`. Duplicate parts are summed. | `biqAddMotorSundry`, `biqCanonicalize` | — |
| TBD shorthand: 1TD → One Touch Dual, ZB → Zigbee, M&T → Matter, WF → Wire Free. "Not BD Supply" hardware is a note only, never a line. | `biqTbdExpand`, `biqNormalizeBdPo` | — |
| A motor itself is told apart from its accessories by name. | `biqIsMotorUnit` (`BIQ_MOTOR_UNIT_RE`, `BIQ_MOTOR_PART_RE`) | Checked against all 158 active sundries of the motor types. |

## Customers, delivery and packing

| Rule | Where | Ruling or evidence |
|---|---|---|
| A known customer is rewritten to its canonical BlindIQ account name, and its default delivery method and packing type fill empty header fields. | `biqApplyCustomerDefaults` | — |
| Courier delivery means Boxed packing, replacing an empty packing type or one taken from the customer's defaults, never one the order or capturer set (`_ptAuto`). | `biqApplyCustomerDefaults` | 9,292 of 9,311 courier orders in 2026 so far (Triton, Other and First Freight). |
| The customer account is never guessed: an unmatched name stays a problem, and `biqSuggestCustomer` only offers a unique match after stripping legal suffixes and plurals. | `biqResolveCustomer`, `biqSuggestCustomer` | The account decides who is billed. |
| Order numbers are exported without spaces or dashes. | `biqOrderNumberForBiq` | See [XML export](xml-export.md#order-number). |

## Colours, ranges and retired items

| Rule | Where | Ruling or evidence |
|---|---|---|
| A combined fabric ("5 Screen Charcoal Grey") splits into range and colour on the longest range name of the blind type; "5% SCREEN" and "DUOSCREEN" read as 5 Screen and Duo Screen; a saved split wins. | `biqSplitFabric`, `biqReSplitFabrics` | — |
| A fabric that names no range but is a colour exactly one live range of the type sells is read as that colour. | `biqReSplitFabrics` | 24 Blind Guys designer-fabric lines since June. |
| A missing or unknown range is taken from the colour when exactly one live range of the type carries it (or one starts with the order's wording), noted "— confirm". | `biqInferRangeFromColour` | 84% of Roller System 40 colour names belong to one range; capturers made the "Solar" → Moscow Fr fix 12 times on 30 Sep. |
| A colour written without BlindIQ's roll-width suffix resolves within its range; a live colour wins over a retired twin. | `biqResolveColour`, `biqRangesWithColour` | — |
| Ranges with no colours (double roller families, bamboo, headrails): an item colour already carried by an option is cleared, or moved into the one empty option value that ends with it, noted. | `biqApplyOptionDefaults` | — |
| A retired range, or a colour its live range no longer carries, moves to the type's live "Discontinued" range as "<range> <colour>" when exactly one such twin exists, noted "(confirm stock)" plus an amber heads-up. | `biqRemapRetiredRanges` | 13 TBD lines were moved there by hand. |
| A retired blind type, range or colour, a range of another blind type, or a colour the range doesn't offer is a problem (the message lists the range's colours and where the colour is offered). | `biqCollectProblems` | "129 White" went in on all 48 blockout blinds of one order on 25 Jul 2026. |

## Not automated on purpose

These stay with the capturer, by ruling or because the evidence is split:

- **Shutters:** the tilt split, and rail sizes outside the documented Urban case.
- **Capturer-specific choices:** matching hardware to dark fabrics; Out of Warranty on narrow, long rollers (only a heads-up).
- **System 40 1.5:1:** never set unasked, nor on a light blind.
- **Documented limits no stored order follows:** the Double Roller 2500 × 2600 limit (0 of 12 lines marked) and the wood venetian "thick line" (0 of 41).
- **Zip X drops over 3000 mm:** the brochure (3000) and the price list (3800) disagree.
- **Steel Ball Chain:** no documented rule; it is a dealer habit. The black chain on Anthracite 1.5:1 blinds is a factory substitution BlindIQ doesn't record.
- **Vertical chain colour on Anodised or Anthracite tracks.**
- **Guesses the converter never makes:** a double roller's "Sheer" fabric, adding or removing motors, a cassette colour without stated hardware, a colour option, the customer account.
- **Open with Russel:** shutter tilt above 1800 mm, Mathéo Smart Rail bars with Grey hardware, venetians exactly 600 mm wide (the code makes them Grouped), one crank handle per order.
- **Prices and the required date:** BlindIQ and the capturer set them.

## Related pages

- [Converter overview](overview.md)
- [Dealer formats](dealer-formats.md)
- [Mappings and catalogue](mappings-and-catalogue.md)
- [XML export](xml-export.md)
- [Rule checks](../comparison/rule-checks.md)
- [Validations](../comparison/validations.md)
- [History](../history.md)
- [Decisions](../decisions/README.md)
- [Glossary](../glossary.md)
