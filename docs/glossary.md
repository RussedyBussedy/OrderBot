# Glossary

The blind-trade, BlindIQ, OrderBot and platform terms used in this wiki and in the code, in alphabetical order. Where a term is also a name in the code, the code name is given.

## Blinds, BlindIQ and OrderBot

| Term | Meaning |
|---|---|
| 1.5:1 (System 40 1.5:1) | A geared chain mechanism for heavy Roller System 40 blinds. The converter keeps a dealer's request for it only when the blind weighs over about 4 kg, and then sets an 80% control drop. |
| 5 mm steps | BlindIQ holds most products' sizes in 5 mm steps. The converter rounds widths and drops read off an order to the step (…1 and …2 down, …3 and …4 up). Products made to the millimetre (shutters, Perfect Fit, outdoor and skylight products) are left alone. |
| Admin mode | A switch in the converter that shows the mapping tools and the Cost report view. It's meant for Paul and Russel and is stored in the browser as `biq_admin`. It's a convenience to keep capturers out of the mapping tools, not a security control. The AI guidelines and the fabric, motor and tube tables aren't behind it. |
| Allusion | A blind with fabric vanes hung on a vertical-style track. Its fabrics come in 107 mm (or 90 mm) widths. |
| BD order form | Blind Designs' own fillable PDF order forms. The converter reads them with `js/biq-form-specs.js`. |
| `BD_STANDARDS` | The text in `js/comparison-context.js` that tells the AI what Blind Designs supplies when the customer doesn't say (White hardware, 5 mm steps, control-drop formulas and so on). |
| BDO number | BlindIQ's order number for a Blind Designs order, e.g. `BDO672621`. Comparisons are saved and searched by it. |
| Blind IQ document (order confirmation) | The BlindIQ printout of the captured order. The capturer uploads it next to the customer's document for a comparison. |
| Blind type | BlindIQ's product type, such as Roller System 40, Wood Venetian or Vision Blind. Each has a BlindIQ ID. |
| BlindIQ | Blind Designs' order, production and pricing system, on SQL Server (database `BlindIQ_BlindDesigns`). Capturers key orders into it, and the converter's XML is imported into it. |
| BlindIQ Online | BlindIQ's web ordering for dealers. These orders arrive as `BlindIQ_ExportedCO_<IQ Link ID>.pdf`, printed in BlindIQ's own names, and OrderBot reads them exactly. |
| Blockout and view fabric | The two fabrics of a double roller: one that blocks light and one you can see through (a screen or sheer). |
| Bottom bar | The weighted bar at the foot of a roller blind. Its colour normally follows the hardware colour. |
| Capturer (order capturer) | A member of staff who keys customer orders into BlindIQ. Capturers are OrderBot's main users. |
| Cassette | A housing that covers the roller at the top. In BlindIQ it's usually an option on the blind (for example a 70 mm open or closed cassette). For some products, BlindIQ carries it on a separate Valance line. |
| Catalogue refresh | A read-only SQL extract of BlindIQ's catalogue (types, ranges, colours, fixes, controls, sundries, option sheets, the links between them, and which items are retired), imported into the converter's mappings. The October 2026 refresh is `biq-catalogue-refresh-2026-10-09.json`. |
| Chain, pin, spring, crank, motor | How a blind is operated. Chain: a bead-chain loop on one side. Pin: the idle end opposite the drive. Spring: spring-assisted. Crank: a handle, mainly on outdoor blinds. Motor: electric. |
| Colour | A fabric or material colour within a range. In BlindIQ, each range has its own list of colours. |
| Comparison | One run of "Check an order" for one pair of documents (the customer's and BlindIQ's). Saved in the `orderbot_comparisons` collection. |
| Control 1 and Control 2 | BlindIQ's two control fields. On roller-type blinds, Control 1 is the left side and Control 2 the right side, for example "Lh Chain" and "Rh Pin". |
| Control drop | The length of the chain, cord or wand. It's usually a formula of the blind's drop that depends on the range (for example 75% or 66%), unless the order states a length. |
| Converter | The BlindIQ XML converter: it turns a customer's order document into a BlindIQ order and an import-ready XML file. See [converter/overview.md](converter/overview.md). |
| Converter reading | The converter's own rule-based reading of a customer file in a known layout. The comparison gives it to the AI as extra context (`describeConverterReading`). |
| Critical fields | Product type, range, colour, quantity, width, drop, Control 1 and Control 2 (`CRITICAL_FIELDS` in `js/constants.js`). Paul set these in August 2026. Mismatches or omissions in them get the strongest highlighting and a summary. |
| Daily Cost Report | A PDF report that a Python script (`cost_report.py`) on an office PC emails each working day. Its settings are edited in OrderBot's admin-only Cost report view. See [cost-report-console.md](cost-report-console.md). |
| Dealer | A business that buys from Blind Designs and sends orders, such as Blind Guys, Mathéo, Total Blind Designs (TBD), Galaxy Blinds, Curtain & Blind Workshop (CNBW) or Lifestyle. The converter reads several dealers' own layouts exactly. |
| Discontinued range | The live range of a blind type that holds retired stock. The converter moves a retired range and colour onto it, with an amber "confirm stock". |
| Double roller | Two roller blinds on one set of brackets, usually a blockout and a screen. BlindIQ holds one as a single blind with two fabric options (Blockout Fabric and View Fabric). |
| Drop | The height of a blind. |
| Dual (LH Dual / RH Dual) | The control for a roller blind driven by a One Touch Dual motor. Specifying "Motor" instead makes the blind too narrow, because the motor head is thinner. |
| Exact reading | For BlindIQ Online exports, the customer's values are taken exactly as printed rather than from the AI (`applyExactReading` in `js/comparison-checks.js`). |
| Finish Logic | A quoting app for blind dealers, built by the owner of Total Blind Designs (TBD). It produces purchase orders for Blind Designs in BlindIQ's wording; TBD and Galaxy Blinds send them. See [converter/dealer-formats.md](converter/dealer-formats.md). |
| Fix | How and where a blind is mounted: Reveal (inside the recess), Face, Top, and for Perfect Fit the Gasket sizes. In BlindIQ, each range has its own list of fixes. |
| Gasket (clip) | The brackets a Perfect Fit blind clips into, sized to the window's bead depth (Gasket 12 to 38 mm). The clip size on an order is the Gasket fix. |
| Grouped and Split | BlindIQ's two settings for how a venetian's controls are arranged. When the order doesn't say, the converter makes wood and retro venetians under 600 mm wide Split and wider ones Grouped, and 35 mm aluminium always Grouped. |
| Guidelines (AI guidelines) | Business rules for the AI, added in the AI guidelines panel, stored in `orderbot_guidelines` and included in the comparison prompt. Any OrderBot user can edit them today; admin mode doesn't restrict them. |
| Hardware colour | The colour of the brackets and mechanism. The bottom bar and cassette normally follow it, and it's White when the order doesn't say. |
| Intermediate and coupled bracket | A shared middle bracket where two blinds sit side by side. Intermediate means each blind has its own drive. Coupled means one drive turns both. |
| IQ Link ID | The reference of a BlindIQ Online order. It appears in the export's file name. |
| Item letter | The letter (A, B, C …) that identifies a line on a BlindIQ order. BlindIQ's letters shift when it adds a separate Valance line, which the comparison allows for. |
| Linear Valance | The roller valance style Blind Designs supplies when an order asks for a valance without naming the style. |
| Mappings | The converter's dictionary from dealer wording to BlindIQ IDs, stored in `orderbot_biq_mappings`. See [converter/mappings-and-catalogue.md](converter/mappings-and-catalogue.md). |
| MATCH, MISMATCH, OMISSION, NOTE, NOT_SPECIFIED | The result of each compared field (`RESULT_VALUES` in `js/comparison-context.js`). MATCH: the same. MISMATCH: different. OMISSION: missing on one side. NOTE: information only. NOT_SPECIFIED: the customer's document doesn't mention the field at all, shown grey as "not on order". NOT_SPECIFIED is never allowed for a critical field. |
| Matrix sheet (variant sheet, option sheet) | BlindIQ's option sheet for a blind type and range, listing the options and the values allowed. The converter models them as `variantSheetIndex` and `variantTemplateSheets`. |
| One Touch Dual | A motor family (1.1, 2 and 3 Nm) with a thinner motor head. A System 40 roller with one must be specified LH or RH Dual. |
| Out of Warranty | A flag on a blind made outside the fabric's or product's limits, for example wider than the fabric can be turned, or beyond the price list's selling limits. The converter sets it automatically where the rules say so. |
| Pair | One customer document (or set of files) and one Blind IQ document, checked together in a comparison run. |
| Pass 1 and Pass 2 | The comparison's two main AI calls. Pass 1 reads both documents and compares them. Pass 2 takes a second look at low-confidence fields (`reExtractLowConfidence` in `index.html`). |
| Perfect Fit | A blind in its own frame that clips into the window's beading, so no drilling is needed. See Gasket. |
| `PROMPT_VERSION` | The version label of the comparison prompt, in `js/config.js`. Each saved comparison records it as `promptVersion`. |
| Range | A collection within a blind type, often a fabric family such as "5 Screen" or "Classic". In BlindIQ the range decides the colours, fixes and option sheet. |
| Retired ("Z ") items | BlindIQ items withdrawn in the December 2025 to January 2026 catalogue clean-up. They were renamed with a "Z " prefix and hidden, and the converter treats them as problems. |
| Roll width (turning fabric) | The width of a fabric roll. A blind wider than the roll needs the fabric turned on its side, which some fabrics can't take, or can only take out of warranty. |
| Roller System 40 and 55 | Blind Designs' two main roller-blind mechanisms. |
| Second reading | An extra AI reading of a handwritten or unclear customer document on its own, without the BlindIQ document in view. It's compared with Pass 1 to catch values misread as BlindIQ's (`SECOND_READING` in `js/config.js`). |
| Somfy RTS, io and Maestria | Somfy motor families. RTS is one-way radio. io is two-way radio. Maestria io is the outdoor motor whose torque comes from the Zip X table (`js/outdoor-motors.js`). |
| Steel Ball Chain | A metal chain option instead of the standard plastic chain on roller blinds. Many dealers order it as a standing choice, so the comparison doesn't treat silence about it as a mistake. |
| Sundry | A part ordered on its own line on a BlindIQ order: motors, remotes, chargers, adaptors, accessories. BlindIQ sundries have types, and motors resolve only within the seven motor sundry types. |
| System X (Zip X, Channel X, Wire X, Free Hang) | Outdoor blind systems whose sides are held by a zip, a channel or a wire, or hang free. |
| Torque (Nm) | A motor's turning force. OrderBot estimates the torque a roller blind needs from its size, fabric weight and bottom bar, and checks the motor against it. |
| Tube | The roller tube a blind winds onto. Its diameter, set per blind type in the Tube properties table, feeds the torque check. |
| Universal Frame | A Perfect Fit frame for when the blind can't clip into the window's beading. It always uses 24 mm clips and isn't something the customer orders as a clip size. |
| Urban shutters | A shutter range. Panels from 1201 to 1800 mm without a middle rail get a 100 mm rail. |
| Valance | A decorative strip across the top of a blind. For rollers, BlindIQ orders it as its own Valance line. Wood and retro venetians carry it as options on the blind (Val Size, Val Returns). |
| Venetian (wood, retro, aluminium) | A blind with horizontal slats: wood (the "Classic" range and others), retro, and 35 mm aluminium. |
| Vertical | A blind of vertical vanes on a track. |
| Vision | A dual-layer roller blind with alternating sheer and solid stripes (BlindIQ's Vision Blind). |
| ZIQ code | A BlindIQ sundry stock code. BlindIQ Online exports print them under Sundries, and the converter resolves those sundries by code. |

## Platform and development

| Term | Meaning |
|---|---|
| Branch | A separate line of work in Git. It doesn't affect `main` until it's merged. |
| CI (continuous integration) | Checks, mainly the tests, that run automatically on every pull request. Planned, see [testing.md](testing.md). |
| Clone | A full copy of a repository on your own computer, history included (for example `C:\dev\blind-designs\OrderBot`). Changes there stay on your computer until you push them. |
| Cloud Run | Google Cloud's service for running containers. It runs the proxy (`index.js`) as the service `gemini-secure-proxy` in `africa-south1`. |
| Commit | A saved snapshot of changes in Git, with a message saying what changed and why. |
| CORS | The browser rule that lets a server say which websites may call it. The proxy lists the origins it accepts. CORS limits browsers only; it isn't authentication. |
| Firebase anonymous auth | Every browser signs in to Firebase automatically, without credentials. It gets a user ID but no identity. |
| Firestore | Firebase's document database, which holds OrderBot's data. See [data-model.md](data-model.md). |
| Gemini | Google's family of AI models. OrderBot calls Gemini 3.8 Flash through the proxy. See [ai-models.md](ai-models.md). |
| GitHub Pages | GitHub's static web hosting. It serves this repository's `main` branch as the live app today. |
| `main` | The production branch. What's on `main` is what capturers use. |
| Merge | Bringing a branch's commits into another branch. Merging a pull request into `main` puts the change live. |
| Preview channel | A temporary Firebase Hosting address for one pull request, so a change can be tried before it's merged. Planned, see [environments.md](environments.md). |
| Pull request (PR) | A request on GitHub to merge a branch into `main`. It's where a change is described, reviewed, tested and approved. |
| Push and pull | Push uploads your commits to GitHub; pull downloads other people's commits into your clone. |
| Repository (repo) | A project's files plus their full history, hosted on GitHub. |
| Revert | A new commit that undoes an earlier one. Reverting a merged pull request is how a bad change is rolled back. |
| Secret Manager | The Google Cloud service that holds the Gemini API key. Only the proxy reads it. |

## Related pages

- [Overview](overview.md)
- [Architecture](architecture.md)
- [Converter overview](converter/overview.md)
- [Comparison pipeline](comparison/pipeline.md)
- [Data model](data-model.md)
