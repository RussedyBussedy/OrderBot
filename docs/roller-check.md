# Roller check: the Roller System Selector

The **Roller check** view works out a Roller System 40 or 55 blind the way Blind Designs' Roller System Selector does: its weight, the tube it needs, the chain, and the motors that can lift it. The same rules flag OrderBot's comparisons. The rules are in `js/roller-selector.js` (pure, tested in node), and the view is `js/roller-selector-ui.js`.

The spreadsheet it comes from is `Sales Resource / Calculation Tools / Roller Blinds / Roller system selector V2.1.xlsx`. It was reviewed on 2 Nov 2026, and the fixes went into **V2.2** in the same folder; V2.1 is unchanged. V2.2's "Changes V2.2" sheet lists the fixes and the open questions. Both versions were recalculated in Excel with the same test blinds to confirm the fixes.

## The rules

| | Rule | Source |
|---|---|---|
| Weight | fabric kg/m² × width × drop + bottom bar kg/m × width (aluminium / oval 0.28, SmartRail 0.36, plastic 0.20) | Selector |
| Torque | weight × 9.81 × tube radius (System 40 0.020 m, System 55 0.0275 m), + 20 %; a motor fits when its torque is at least that | Selector |
| Sizes | System 40 to 3200 × 3400 mm; System 55 to 4000 × 4500 mm and 11.5 kg. Beyond them: Out of Warranty, ask the factory | Selector, price list (also `BIQ_SELL_LIMITS` in the converter) |
| Fabric width | wider than the roll + 35 mm: turned if the fabric may be turned and the drop fits the roll; turning "out" fabrics is Out of Warranty | Selector's Fabric Data; the 35 mm is review queue #26, as in the converter |
| Chain, System 40 | 1:1 to 4 kg; 1.5:1 from 4 to 8 kg; over 8 kg System 55 | Selector; amber, not red (Russel, 2 Nov 2026) |
| Chain, System 55 | Lift Assisting Spring recommended over 4.5 kg | Selector; advice only (Russel, 2 Nov 2026) |
| Motors | BlindIQ's live roller motors, each with the tubes it goes in | BlindIQ, Nov 2026 (see below) |

**Motors.** The selector's Motor Reference sheet was out of date, so the motor list (`MOTORS`) is BlindIQ's (Russel, 2 Nov 2026): 32 roller motors under the Somfy RTS, Somfy Zigbee, One Touch +, One Touch Dual and Motion sundry types. Which tube each goes in follows what capturers fitted from Nov 2025 to Oct 2026, and BlindIQ's adaptor kits:

- **System 40 only:** Sonesse 28, Roll Up Basic 28, One Touch+ (1.2 / 1.8 Nm, also 220V 1.8 Nm), One Touch Dual 1.1–3 Nm (Li-ion, 220V 2 Nm, Matter & Thread), Motion 25.
- **System 55 only:** Sonesse 40 (RTS, wired, Zigbee, wire-free), Optuo RTS 3 Nm, One Touch Dual 220V 6 Nm, Motion 40.
- **Either:** Sonesse 30 wire-free (BlindIQ has a "Sys 55 Adaptor Kit for Sonesse 30 Wire Free").

A sundry is read as a roller motor (`rollerMotorOf`) when it is one of those names (also behind BlindIQ's type, "Motors One Touch Dual - …"), or another wording of one that gives its torque. Adaptor kits (BlindIQ also spells them "Adpator" and "Adpater"), chargers, remotes, battery packs and tubes, power supplies, transformers, motor plates and drives, the lift spring, and outdoor, curtain, cellular and tilt motors are not. Over BlindIQ's 5,573 sundry names this reads 53 as roller motors: the 32, plus 21 older or factory-component wordings of them.

The torque is worked out on the tube the motor goes in. A System 40-sized blind that only a System 55 motor can lift is checked at the 55 mm radius and shown as a motor upgrade. The selector didn't do this, but no fabric heavy enough to make the difference fits System 40's sizes.

**Fabrics.** There is one fabric list: OrderBot's **Fabric properties** (Firestore `orderbot_fabric_properties`, the panel on the Orders view). It is edited there and read by the comparison, this view and the converter (Russel, 2 Nov 2026). The code keeps no copy. See [History, feedback and reference data](comparison/history-feedback-and-reference-data.md#fabric-properties-orderbot_fabric_properties) for its fields, including the **Also known as** aliases. `findFabric` finds a line's fabric from Blind IQ's range and says how (`match`):

| `match` | How | Roll width used for the width check? |
|---|---|---|
| `name` | the range is a fabric's name or alias (case and a trailing "#" don't matter) | yes |
| `print` | Blind IQ's PDF shortened the range ("Perspective White Bac"): 12+ characters that start exactly one name or alias | yes |
| `design` | a "Designer Fab X" range, by the colour's design ("Argent Gold 2050mm @" → Argent), with the colour's own roll width | yes |
| `part` | one side of " / " ("5 Screen / Aventus 5%" → 5 Screen) | no: System 55's "X / Y" ranges are other mills' fabrics, maybe on wider rolls |

**How the lists were brought together.** On 2 Nov 2026 three lists were compared: Firestore (127 fabrics), the selector workbook and the converter's own tables. They agreed on 41 of 130 names (`fabric-list-comparison-2026-11-02.csv` in the review package "Roller check 2026-11", with a backup of every Firestore row the tidy-up changed).
- The workbook and the converter repeat a few weights (0.23, 0.24, 0.447) across dozens of Designer fabrics, while Firestore has a weight per design. So Firestore's values were kept.
- Louvolite's fabric pages give the roller roll width (not the weight). Firestore matches Louvolite on 15 of the 24 widths in dispute, the workbook on 9. Voile and Monet Sheer are 2000 mm, as in Firestore; the workbook and the converter had 3000.

## The view

The **Roller check** pill sits between Orders and Drawings and is visible to everyone. Its module is only loaded the first time the pill is clicked, and a failed import is caught, so it can't stop OrderBot loading. Each blind is a card:

- **Inputs:** fabric (or its kg/m²), width, drop, bottom bar, system (worked out, or fixed at 40 or 55) and chain or motorised.
- **Chain blinds:** whether the order already has the 1.5:1 control or the Lift Assisting Spring.
- **Motorised blinds:** brand, power and protocol narrow the motors. "Motor on the order" checks one motor against the blind: whether it fits the tube the blind needs (also without a fabric weight) and whether its torque is enough.

Results show the weight, the torque on both tubes, the system, the chain or the lightest motor that lifts the blind (plus up to three others), and **every** warning; the selector only showed the first. When there is no motor of the chosen brand, power or protocol for the tube at all, it says so rather than "not strong enough". The fabric list is read from Firestore when the view opens. If it can't load (or the page isn't signed in yet), the view says so with a **Try again** button and asks for each fabric's weight. The lines are kept in `localStorage` (`ob_roller_lines`) for that browser only, and the view writes nothing to Firestore.

## In the comparison

`runPostAIValidations` (index.html) uses the same module:

- **Weight (section 0):** the fabric from the one list (any `match`). The bottom bar is the line's own (SmartRail, plastic, else aluminium); before, it was always aluminium. Options packed into another one ("Hardware Colour = Mech Colour=White | Bottom Bar=White Plastic") are read too (`optionPairs`).
- **Fabric width (section 1):** not for verticals, panels or outdoor blinds (`notOnRollerRolls`): their fabric doesn't come off the list's roller rolls. A `part` match has no known roll, and a Roller System 40 / 55 blind gets the 35 mm allowance.
- **Chain (section 3b, `chainValidation`):** `chainCheck`.
  - System 40 is amber from 4 kg without the 1.5:1 control and red over 8 kg. The 1.5:1 counts as its own "System 40 1.5:1=Yes", packed into another option, or in a control. Before Nov 2026 any "1.5" in the options switched the warning off, including Blind IQ's blank "System 40 1.5:1 =".
  - On System 55 the spring advice is blue and isn't an alert. The spring counts as the option, a "Chain Spring" control, or a lift-assisting spring sundry on the order. Over 11.5 kg is reported by the System 40/55 check; a chain blind over 8 kg on System 55 is no longer red.
  - Double rollers and other roller types without 40 / 55 in their name keep the System 40 thresholds.
- **System 40/55 (section 4b, before the valances, `rollerValidation`):** `validateRollerSystems`. Red, amber or blue, worst first, all messages joined:
  - **Selling limit:** a blind beyond System 40's or 55's size limit is amber, or blue when the line is marked Out of Warranty.
  - **System 55 weight:** a System 55 blind over 11.5 kg is red.
  - **Too heavy for any System 40 motor:** a motorised System 40 blind needing more torque than the strongest System 40 motor (3 Nm) is amber. This can't happen at today's fabric weights.
  - **Motors on the wrong tube:** motors are order-level sundries, so this is judged only when every motorised line on the order is a Roller System 40 or 55. Blinds are counted by their quantity, like the motors. More System 55-only motors than System 55 blinds means some System 40 blind would get one, and the reverse for System 40-only motors. It's red when every roller motor on the order is the wrong kind, otherwise amber ("confirm which blinds take which motor").
- **Adapter kits (`validateMotorDependencies`):** BlindIQ's "Adpator" / "Adpater" kits now count as adapter kits. Before, an order with "Sys 55 Motor Adpator Kit for Sonesse 40" got "only 0 adapter kits found". The kit each motor needs is found in any of the four spellings, on the motor table's side and the order's. That part only works from the hotfix after the merge (2 Nov 2026). The merged version held backspace characters where the pattern's word boundaries belong, so it matched no spelling at all, not even "Adaptor" against "Adapter".

The report shows red errors and amber warnings as alerts. Red ones also go in the critical issues box and the end-of-run popup, which now escape what they show (they quote values the AI read and sundry names). Blue is shown as advice and isn't counted. The converter's check panel takes the same flags, except blue (`biqExtractCheckResults`).

### Replayed over every stored comparison

All 19,170 comparisons in `orderbot_comparisons` (Aug 2025 – Nov 2026) were run through the old and the new checks, with the fabric list as proposed on 2 Nov 2026. The outcomes come from BlindIQ's final orders.

| Check | Old flags kept | Old flags gone | New flags |
|---|---|---|---|
| Fabric width, red | 76 | 187 | 30 |
| Fabric width, amber | 249 | 52 | 21 |
| Chain (amber) | 235 | 7, plus 7 now blue | 26 (31 blue) |
| Motors on the wrong tube | — | — | 6 red |
| "Only N adapter kits" | 71 | 102 | — |

- **The red fabric flags gone** were mostly false alarms: 132 were outdoor blinds, among them 119 Free Hang lines in Mode, Mode Zero or Dayscreen read against the 3200 mm indoor roll but made as ordered (BDO611651: 5480 × 3290); 34 were verticals and 4 panels. The rest were within the 35 mm allowance.
- **The new red fabric flags** are Designer blinds wider than their colour's roll, and ranges the list now finds by an alias. Of 14 checked, 10 were acted on afterwards: 6 marked Out of Warranty (BDO642596, BDO650699, BDO651971, BDO653673, BDO655177 ×2) and 4 made narrower (BDO649685 D 2050 → 2010; BDO662558 H–J about 2090 → 1040).
- **The new chain warnings** are blinds whose fabric is now found (10 Screen, Linen Block, Sheerweave FR), or that the old "1.5 anywhere" test let through.
- **Both red motor-tube orders were real mistakes, corrected later.** BDO668562's three System 40 blinds with Sonesse 40 motors became System 55. BDO658467's One Touch Dual M&T 2 Nm motors on System 55 became the 6 Nm with System 55 kits. The old check had said nothing at that comparison.
- **BlindIQ orders, Nov 2025 – Oct 2026:**
  - The motor rule fires on 2 of 1,269 qualifying orders, both amber (BDO649605, BDO649530: a Sonesse 28 on all-System 55 orders).
  - Selling limits: 338 System 40 and 106 System 55 lines were beyond them, 171 and 75 of those marked Out of Warranty; most of the rest are two project orders (BDO669153, BDO669417: 105 System 40 lines at 3545 mm).
  - 602 of the 1,460 System 40 chain blinds of 4–8 kg had the 1.5:1, so its amber warning stays common (Russel kept it at 4 kg).

## Deploying it

The converter no longer has its own fabric tables. So before this code is live, the fabric list must hold what BlindIQ's ranges need:
- the aliases for "Linen Block", "Sheerweave 4500 Fr", "Sheerweave 4901 Fr", "Didsbury Block", "Bird Song" and "Como";
- a "10 Screen" row.

Without them, those ranges (about 8,000 lines a year) lose the converter's Out of Warranty and 1.5:1 rules. The live code ignores aliases, so adding them first is safe. Delete the "Urban Block / Paris" row only after the new code is live, since the live code still finds System 55 Urban Block by that exact name. The command-line converter outside this repository (`convert-cli.mjs`) must set `mappings.fabricList` for the same rules.

## Changing it

- **Fabrics:** edit them in the Fabric properties panel (or its CSV upload, which replaces every fabric, aliases included). Never add a fabric table to the code.
- **Rules and the motor table:** they live in `js/roller-selector.js`, with the reasons in its header comment.
- **BlindIQ adds a roller motor:** add it to `MOTORS` with the tubes it goes in. If its family isn't already one of the patterns in `rollerMotorOf`, add it there too.
- **No regex lookbehind** (`(?<!…)`) in these modules: Safari before 16.4 can't parse it, and `roller-selector.js` is a static import of the app.
- **Tests** (regression package, see [Testing](testing.md)):
  - `new-tests/biq-roller-selector.test.mjs` (32 checks) covers the rules and their wiring into index.html and the converter. Three checks cover the motor check: kit spellings, remotes found by name, and no control characters in index.html.
  - `new-tests/_maps.mjs` gives the converter tests the fabric list (`fixtures/fabric_properties_2026-11-02.json`).
  - `tests/biq-converter.test.mjs` and `tests/biq-coupled-control.test.mjs` pass the module's functions into the code they lift from index.html.

## Related pages

- [Comparison validations](comparison/validations.md)
- [User interface](app/user-interface.md)
- [Data model](data-model.md)
- [Converter rules](converter/rules.md) (Out of Warranty, 1.5:1 in the converter)
