# Roller check: the Roller System Selector

The **Roller check** view works out a Roller System 40 or 55 blind the way Blind Designs' Roller System Selector does: its weight, the tube it needs, the chain, and the motors that can lift it. Since 13 Nov 2026 the torque a motor must give is the lift and the bearing friction, and a battery motor shows how long one charge lasts. The same rules flag OrderBot's comparisons. The rules are in `js/roller-selector.js` and `js/roller-motor-calc.js` (pure, tested in node), and the view is `js/roller-selector-ui.js`.

The spreadsheet it comes from is `Sales Resource / Calculation Tools / Roller Blinds / Roller system selector V2.1.xlsx`. It was reviewed on 2 Nov 2026, and the fixes went into **V2.2** in the same folder; V2.1 is unchanged. V2.2's "Changes V2.2" sheet lists the fixes and the open questions. Both versions were recalculated in Excel with the same test blinds to confirm the fixes.

## The rules

| | Rule | Source |
|---|---|---|
| Weight | fabric kg/m² × width × drop + bottom bar kg/m × width (aluminium / oval 0.28, SmartRail 0.36, plastic 0.20) | Selector |
| Torque | The lift at the blind's heaviest point of travel, with the fabric already rolled on the tube and the bearing friction; a motor fits when its rated torque is at least that. Until 13 Nov 2026: weight × 9.81 × tube radius (System 40 0.020 m, System 55 0.0275 m) + 20 % | The motor-calc pack (Russel, 13 Nov 2026; [below](#torque-and-battery-life)); before, the Selector |
| Weight capacity | A One Touch motor must also be within the weight Louvolite publishes for it: 3.5 kg (1.1 and 1.2 Nm), 6 kg (1.8 and 2 Nm battery, and the 220 V 2 Nm), 8.5 kg (3 Nm), 12 kg (220 V 6 Nm) | Louvolite's spec sheets and Quick Motor Guide |
| Battery | A battery motor's charge should last six months at one up and down a day | Blind Designs' motorisation brochure ("Simply charge every six months") |
| Sizes | System 40 to 3200 × 3400 mm; System 55 to 4000 × 4500 mm and 11.5 kg. Beyond them: Out of Warranty, ask the factory | Selector, price list (also `BIQ_SELL_LIMITS` in the converter) |
| Fabric width | wider than the roll + 35 mm: turned if the fabric may be turned and the drop fits the roll; turning "out" fabrics is Out of Warranty | Selector's Fabric Data; the 35 mm is review queue #26, as in the converter |
| Chain, System 40 | 1:1 to 4 kg; 1.5:1 from 4 to 8 kg; over 8 kg System 55 | Selector. A missing 1.5:1 is red on a Roller System 40 (Russel, 5 Nov 2026; amber from 2 Nov) |
| Chain, System 55 | Lift Assisting Spring recommended over 4.5 kg | Selector; advice only (Russel, 2 Nov 2026) |
| Motors | BlindIQ's live roller motors, each with the tubes it goes in | BlindIQ, Nov 2026 (see below) |

**Motors.** The selector's Motor Reference sheet was out of date, so the motor list (`MOTORS`) is BlindIQ's (Russel, 2 Nov 2026): 32 roller motors under the Somfy RTS, Somfy Zigbee, One Touch +, One Touch Dual and Motion sundry types. Which tube each goes in follows what capturers fitted from Nov 2025 to Oct 2026, and BlindIQ's adaptor kits:

- **System 40 only:** Sonesse 28, Roll Up Basic 28, One Touch+ (1.2 / 1.8 Nm, also 220V 1.8 Nm), One Touch Dual 1.1–3 Nm (Li-ion, 220V 2 Nm, Matter & Thread), Motion 25.
- **System 55 only:** Sonesse 40 (RTS, wired, Zigbee, wire-free), Optuo RTS 3 Nm, One Touch Dual 220V 6 Nm, Motion 40.
- **Either:** Sonesse 30 wire-free (BlindIQ has a "Sys 55 Adaptor Kit for Sonesse 30 Wire Free").

A sundry is read as a roller motor (`rollerMotorOf`) when it is one of those names (also behind BlindIQ's type, "Motors One Touch Dual - …"), or another wording of one that gives its torque. Adaptor kits (BlindIQ also spells them "Adpator" and "Adpater"), chargers, remotes, battery packs and tubes, power supplies, transformers, motor plates and drives, the lift spring, and outdoor, curtain, cellular and tilt motors are not. Over BlindIQ's 5,573 sundry names this reads 53 as roller motors: the 32, plus 21 older or factory-component wordings of them.

The torque is worked out on the tube the motor goes in. A System 40-sized blind that only a System 55 motor can lift is checked on the 55 mm tube and shown as a motor upgrade. The selector didn't do this, but no fabric heavy enough to make the difference fits System 40's sizes.

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

## Torque and battery life

Russel (13 Nov 2026): apply the motor-calc pack's torque calculation, and its battery autonomy, to the Roller check and the comparison's flags, for the One Touch motors too; show the battery autonomy on each line of a comparison and flag it under six months.

**Where the calculation comes from.** It is the roller-blind method of the "motor-calc" pack: plain JavaScript written and kept outside this repository. Its two code files are in `js/motor-calc/` (`engine.js`, `builders.js`), the code line for line; only a few comment lines are worded differently here. `js/roller-motor-calc.js` ties them to BlindIQ's roller motors and holds each motor's published figures, and `js/roller-selector.js` applies the results. All three are pure and tested in node.

### Torque

At each point of the blind's travel:

```
lift     = 9.81 × (fabric still hanging + bottom bar) × (tube radius + fabric thickness × turns on the tube)
friction = 0.25 × 9.81 × (fabric + bottom bar + tube + motor) × the tube's inner radius
```

The torque a motor must give is the largest lift + friction over the travel, and a motor fits when its rated torque is at least that. There is no 20 % on top: the friction and the fabric's build-up on the tube are what the 20 % stood for.

| Input | Value |
|---|---|
| Tube | 40 mm (System 40) or 55 mm (System 55) outside diameter, aluminium, 2 mm wall (the engine's own rule above 35 mm) |
| Fabric weight | The fabric list, as for the blind's weight |
| Fabric thickness | The fabric list's **Thick** (mm), when it has one; else 0.48 mm, the method's default. From 0.3 to 1.2 mm the torque moves about 5 %. |
| Bottom bar | 0.28, 0.36 or 0.20 kg/m, as for the weight |
| Motor | Its weight where a datasheet gives it (the Roll Up Basic 28: 0.5 kg), else 0.5 kg. A chain blind has none. |

- **It is higher than the old figure.** On the 1,346 motorised Roller System 40 / 55 lines checked from August to November 2026 it is 7 to 49 % above weight × 9.81 × radius + 20 %, 13 % in the middle (the small blinds are furthest above it: the tube's and the motor's own weight count for more).
- **Checked against a published grid.** The torque grid for the Sonesse 30 on a Louvolite 40 tube (`Sales Resource / Product Technical Brochures / Motor Somfy RTS / Weight grid sonesse 30.pdf`: 18 widths by 18 heights, 550 g/m², 450 g/m bar, 0.5 mm) is this calculation without the motor's weight. All 324 values agree to within 0.04 Nm.
- **A blind under about 200 mm of drop** is too short for the method (under 1.6 turns of the tube). The view then keeps the old formula; the comparison gives the line no figure.

| Blind | Weight | Old (with its 20 %) | Lift and friction | Motor |
|---|---|---|---|---|
| BDO673291 C, 3 Screen 2550 × 2400, System 40 | 4.66 kg | 1.10 Nm | 1.18 Nm | One Touch Dual 1.1 Nm: was a pass, now red |
| BDO674642 B, 3 Screen 3800 × 3300, System 55 | 9.15 kg | 2.96 Nm | 3.17 Nm | Optuo RTS 3 Nm: was a pass, now red |
| 5 Screen 2000 × 2400, System 40 | 3.29 kg | 0.77 Nm | 0.85 Nm | |

### Louvolite's weight capacity

Louvolite gives every One Touch motor a weight capacity ("Motor weight capacity of 6kg" on its spec sheet). It is the maker's own limit, so it is checked beside the torque (`capKg` in `MOTOR_DATA`, `overCapacity`):

| Motor | Capacity |
|---|---|
| One Touch Dual 1.1 Nm (also Short), One Touch + 1.2 Nm (also Short) | 3.5 kg |
| One Touch Dual 2 Nm battery (also Matter & Thread), One Touch + 1.8 Nm (battery and 220 V) | 6 kg |
| One Touch Dual 3 Nm (also Matter & Thread) | 8.5 kg |
| One Touch Dual 220 V 2 Nm (also Matter & Thread) | 6 kg |
| One Touch Dual 220 V 6 Nm | 12 kg |

- The blind's weight is worked out from nominal figures, so it is over only when it is more than 50 g over.
- The selector never offers a motor past its capacity and says which ones the torque alone would have allowed. A motor on the order past it is amber.
- **The 220 V 2 Nm is 6 kg** (Russel, 13 November 2026: "make it 6"). Louvolite's own papers disagree: 5 kg in the Quick Motor Guide of January 2026 and on page 1 of its spec sheet ("5kg for blinds up to 3m"), 6 kg in the table on page 2. It was 5 kg for the first hours of 13 November.
- Somfy and Motion motors carry no weight capacity: their torque decides.

### Battery life

```
days = battery energy ÷ (one up and down a day + standby + radio + self-discharge)
```

The engine runs the blind up and down in steps of a tenth of a tube turn, turns the torque at each step into current with the motor's figures, and adds up the energy. The use is one full up and down a day with medium radio traffic: the method's defaults, and the basis of the autonomies the makers publish.

**There are two kinds of figure, and every result says which** (`basis`):

| `basis` | What it is | Flagged when |
|---|---|---|
| `measured` | Worked out from the maker's own record of the motor: its current at each torque, standby draw and battery. Records exist for the Sonesse 30, Sonesse 28 and Roll Up Basic 28, and they are **not in this repository** (see below). `sibling` is the record of the RTS version of a Zigbee motor (same drive and battery; 10 to 12 months is published for both). | Under six months |
| `estimate` | Built from the datasheet: rated torque, speed, battery voltage and capacity. What isn't published is assumed (below). | Under four months: under six even with half as much again |

Six months is what Blind Designs' motorisation brochure promises ("Simply charge every six months"), and what Louvolite's instructions say of the One Touch ("a full charge will last up to 6 months").

**Each battery motor's data** (`MOTOR_DATA`), all from Sales Resource:

| Motor | Battery | Speed used | Published currents | Source |
|---|---|---|---|---|
| Roll Up Basic 28 Wire Free RTS 0.7 Nm | 12 V 1400 mAh | 28 rpm | Up 0.8 A at rated torque, 0.2 A no-load, 85 µA standby | Somfy's data sheet DOC 161424 |
| Sonesse 28 Wire Free RTS 1.1 Nm, and its Zigbee Li-ion twin | 12 V 2600 mAh | 20 rpm | None | Sonesse 28 leaflet, Zigbee reference book |
| Sonesse 30 Wire Free RTS 2 Nm, and its Zigbee Li-ion twin | 12 V 2600 mAh | 20 rpm | None | Sonesse 30 spec sheet, Zigbee reference book |
| Sonesse 40 Wire Free RTS 3 Nm | 12 V 4600 mAh | 20 rpm | None | Sonesse 40 WireFree flyer |
| Sonesse 40 Wire Free Zigbee 3 Nm | 12 V 5000 mAh | 20 rpm | None | Zigbee reference book |
| One Touch + 1.2 Nm | 7.4 V 2600 mAh | 25 rpm | 0.9 A at rated torque | Lithium 1200 spec, programming instructions |
| One Touch + 1.8 Nm | 7.4 V 3000 mAh | 25 rpm | 3.0 A at rated torque | Lithium 1800 spec, programming instructions |
| One Touch Dual 1.1 Nm | 7.4 V 2600 mAh | 20 rpm | None | 1100 DC spec sheet |
| One Touch Dual 1.1 Nm Short | 12 V 2500 mAh (external) | 20 rpm | None | 1100 DC-SHORT spec sheet |
| One Touch Dual 2 Nm, and Matter & Thread | 7.4 V 2500 mAh | 20 rpm | None | 2000 DC spec sheet (2600 mAh), Quick Motor Guide of January 2026 (2500): the lower |
| One Touch Dual 3 Nm, and Matter & Thread | 10.8 V 5000 mAh | 20 rpm | None | 3000 DC spec sheet |

The Sonesse 28 Zigbee "No Battery" and the One Touch + 1.2 Nm "Short Ext Bat" have no published battery, so they get no figure. One Touch Dual motors are delivered at their slowest speed, 20 rpm. The two Motion motors are 220 V (Russel, 13 November 2026), so they have no battery figure.

**The same range's motor with the bigger battery.** Russel (13 Nov 2026): "if someone has spec'd a one touch dual 2nm motor and the battery autonomy would only be 2 months, could you give them what a 3nm one touch dual motor would be as a comparison?" When a charge lasts under six months, flagged or not, the line also says what that motor would give on the same blind (`biggerBatteryMotor` in `js/roller-selector.js`):

> Battery Alert: about 2½ months per charge at one up and down a day (One Touch Dual Motor Lithium Ion 2.0nm; an estimate from Louvolite's datasheet) — under the six months between charges Blind Designs quotes. The One Touch Dual Motor Lithium Ion 3.0nm, with a battery 2.9 times the size (10.8 V 5000 mAh against 7.4 V 2500 mAh), would last about 6½ months on this blind, by the same estimate. A solar panel or a 220V motor would also suit this blind better.

- **Which motor.** It must have the bigger battery by its datasheet, a tenth or more in volts × mAh (`biggerBattery`). That is a published fact; how much current each motor draws is mostly assumed, so a motor is never named for drawing less. Of those, the one that lasts longest, and only when that is a quarter longer (`BATTERY.altGain`).
- **It must be a motor the blind can take as it stands:** the same brand and protocol (a Matter & Thread motor for a Matter & Thread one), not a short or no-battery version, for the blind's own tube, strong enough, within its weight capacity, and not longer than the blind is wide.
- **The narrowest blind is OrderBot's own figure:** the motor table's **Min W** for the motor (`tableMinWidth`), in the comparison and in the view (Russel, 13 November 2026: "Stay with our min widths"). It is the motor's row for the blind's own roller system, else its row for the other. The table has 655 mm for the One Touch Dual Matter & Thread 3 Nm, so that motor is named from 655 mm.
- **Louvolite's figure is the fallback** for a motor the table has no Min W for, and when the table can't be loaded: its "Blind width min" (Quick Motor Guide of January 2026, `minWidthMm` in `MOTOR_DATA`) is 520 mm for the One Touch Dual 1.1 Nm, 400 for the short 1.1 Nm, 630 for the 2 Nm, 665 for the 3 Nm (also Matter & Thread), 560 for the 220 V 2 Nm and 650 for the 220 V 6 Nm. A motor with neither figure is named whatever the width.
- **What comes of it:** the 3 Nm for a One Touch Dual 1.1 or 2 Nm (the 1.1 and 2 Nm batteries are the same size), the Matter & Thread 3 Nm for the Matter & Thread 2 Nm, the Sonesse 28 for a Roll Up Basic 28, and on a System 55 tube the Sonesse 40 Wire Free for a Sonesse 30. A Sonesse 30 on a System 40 tube has none, and neither has a One Touch + 1.2 Nm (the 1.8 Nm's battery is bigger, but by Louvolite's own currents it lasts no longer).
- **How much longer.** Over twice as long for the 3 Nm against the 2 Nm, not the 2.9 times of its battery: the estimate gives the bigger motor a bigger draw. Both figures are estimates built the same way, and the sentence says so. When the two figures are of different kinds it says which the second is.
- The comparison keeps it on the line as `batteryValidation.alternative` (`motor`, `months`, `days`, `basis`). It changes no flag.

**What an estimate assumes** (the builders' defaults, listed with every result as `assumptions`):

- Where no current is published: the current at rated torque from 30 % efficiency (`EFFICIENCY`). Published figures run from 14 % (One Touch Dual 220 V 6 Nm: 146 W) to 47 % (One Touch + 1.2 Nm: 6.7 W).
- No-load current 15 % of the rated current; standby 100 µA (85 µA for Somfy's RTS motors, the Roll Up Basic 28's published figure); the receiver awake 9 mA.
- 90 % of the battery's nameplate capacity usable (`USABLE_BATTERY`), at 3.6 V a cell; 20 % self-discharge a year.

**How far to trust an estimate.** On the datasheets' reference blind (1.2 × 2.0 m, 375 g/m², 300 g/m bar) the One Touch Dual 2 Nm comes out at 184 days, where Louvolite says "up to 6 months". Built the same way, the Sonesse 30 comes out 27 % under the figure its own record gives, and at 45 % efficiency the One Touch Dual 2 Nm lasts 29 to 38 % longer. So an estimate can be a third out, which is why it is only flagged under four months. Louvolite's own figures (the current at rated torque, the no-load current and the standby current of each One Touch Dual motor) would settle it; Russel judged the estimates close enough (13 Nov 2026).

**The makers' own records.** The pack has records for the Sonesse 30, Sonesse 28 and Roll Up Basic 28 (RTS Li-ion). They are not published figures, so:

- they are **never committed to this repository** and never put in a file the site serves (every file on `main` is public);
- the page reads them from one optional Firestore document, `orderbot_motor_calc/records` ([data model](data-model.md#orderbot_motor_calc-optional)). Russel decided on 13 November 2026 to hold them there, so on the live site those three motors and the Zigbee Sonesse 30 and 28 show figures from their records. Without the document every figure is an estimate;
- with them the results agree with what is published: 6½ months for the Roll Up Basic 28 on the datasheets' reference blind (its data sheet: 6 months), about 10 for the Sonesse 28 and 11½ for the Sonesse 30 (published: 10 to 12 months);
- a record belongs to a motor by its `id` (`record` in `MOTOR_DATA`) or by a `blindIqNames` list on the record, so a maker's figures for any motor (Louvolite's, when they come) can be added as data without a code change.

### Replayed over the stored comparisons

The latest check of every order from 1 August to 10 November 2026 (4,908 orders, 25,133 lines), through the code before and after:

- **Torque:** 13,269 Roller System 40 / 55 lines get the new torque. The old rule raised no torque alert on any of them; the new one makes three lines red: BDO673291 C and D (One Touch Dual 1.1 Nm on 4.66 and 4.49 kg of 3 Screen) and BDO674642 B (Optuo 3 Nm on 9.15 kg on System 55).
- **Weight capacity:** two lines amber: BDO673178 D (6.63 kg on the 220 V 2 Nm, whose capacity is 6 kg) and BDO675210 C (3.55 kg on the 1.1 Nm, 3.5 kg). At the 5 kg first used for the 220 V 2 Nm, BDO667608 AI, AJ and AL (5.2 to 5.8 kg) were amber too.
- **Battery:** 676 lines on 173 orders get a battery line. No other validation changes.

| Motor | Lines | Days per charge (lowest, middle, highest) | Flagged, estimates only | Flagged, with the motor records (the live site) |
|---|---|---|---|---|
| One Touch Dual 2 Nm | 218 | 91, 135, 452 | 54 | 54 |
| Sonesse 30 Wire Free RTS 2 Nm | 198 | 119, 192, 461 (with its record: 152, 254, 521) | 1 | 8 |
| One Touch Dual 1.1 Nm | 87 | 138, 239, 447 | 0 | 0 |
| Sonesse 30 Wire Free Zigbee 2 Nm | 38 | 122, 189, 340 (159, 255, 468) | 1 | 2 |
| Sonesse 28 Wire Free RTS 1.1 Nm | 36 | 213, 285, 464 (217, 284, 451) | 0 | 0 |
| One Touch Dual Matter & Thread 2 Nm | 33 | 110, 148, 324 | 6 | 6 |
| Sonesse 40 Wire Free RTS 3 Nm | 17 | 189, 221, 735 | 0 | 0 |
| Roll Up Basic 28 0.7 Nm | 16 | 169, 183, 209 (217, 232, 260) | 0 | 0 |
| Others (One Touch Dual Short and 3 Nm, One Touch + 1.2 Nm, Sonesse 28 Zigbee) | 33 | 228 and up | 0 | 0 |
| **All** | **676** | | **62 on 23 orders** | **70 on 25 orders** |

- **The One Touch Dual 2 Nm is the one to look at.** Its battery (7.4 V, 2500 mAh) holds two thirds of the Sonesse 30's, and the blinds it is ordered on are as big (4.4 m² in the middle). By the estimate, 177 of its 218 lines last under six months and 54 under four. The flagged ones are blinds of 2.2 m and wider with drops near 3 m, in 5 Screen, 3 Screen or Urban Block. The 3 Nm motor (10.8 V, 5000 mAh) lasts about twice as long on the same blind.
- A flag at six months on estimates would have flagged four in five One Touch Dual 2 Nm lines (177 of 218), and 75 of the 198 Sonesse 30 lines, where the motor's own record puts only 8 under six months. That is why an estimate is flagged at four months.
- **The bigger-battery motor is named on 231 of the 324 lines under six months,** 60 of the 62 flagged ones among them, and every motor named would reach six months:

| Motor on the order | Lines under six months | Motor named | Days per charge, middle line |
|---|---|---|---|
| One Touch Dual 2 Nm | 177 | One Touch Dual 3 Nm, on all 177 | 130 → 272 |
| One Touch Dual Matter & Thread 2 Nm | 29 | Matter & Thread 3 Nm, on all 29 | 147 → 302 |
| Roll Up Basic 28 0.7 Nm | 14 | Sonesse 28 Wire Free RTS, on all 14 | 183 → 363 |
| One Touch Dual 1.1 Nm | 11 | One Touch Dual 3 Nm, on all 11 | 174 → 278 |
| Sonesse 30 Wire Free, RTS and Zigbee | 93 | None: all are on System 40 tubes | |

The table is by datasheet estimates only. With the motor records the Sonesse and Roll Up Basic figures are longer, so 227 lines are under six months and 217 name a motor, all of them One Touch Dual.

**As it runs live.** Since 13 November 2026 Firestore holds the motor records and the spec-sheet thickness of 45 fabrics (Russel: "can you populate all known fabric thickness"). With both, the same replay gives the same three red and two amber lines, 57 battery lines flagged on 20 orders, and a bigger-battery motor named on 214 of the 223 lines under six months. Two thicknesses were judgement calls: Filter is 0.61 mm on its 2021 sheet and 0.29 mm on the 2018 one (0.61 is entered), and Oxford is taken as Oxford Filter (0.51 mm, the same weight).

## The view

The **Roller check** pill sits between Orders and Drawings and is visible to everyone. Its module is only loaded the first time the pill is clicked, and a failed import is caught, so it can't stop OrderBot loading. Each blind is a card:

- **Inputs:** fabric (or its kg/m²), width, drop, bottom bar, system (worked out, or fixed at 40 or 55) and chain or motorised.
- **A typed weight is for a fabric that isn't listed** (or one the list has no usable weight for). A listed fabric's own weight is always used, and a blue line says so when a different weight is in the box (Nov 2026). Before that the typed weight replaced the list's without a word, and Copy carried it to the next blind: 5 Screen at 2450 × 2600 with a left-over 0.2 read 1.96 kg and "Standard 1:1 chain" where the list's 0.569 gives 4.31 kg and the 1.5:1. To work with your own weight for a listed fabric, clear the fabric box.
- **Chain blinds:** whether the order already has the 1.5:1 control or the Lift Assisting Spring.
- **Motorised blinds:** brand, power and protocol narrow the motors. "Motor on the order" checks one motor against the blind: whether it fits the tube the blind needs (also without a fabric weight), whether its torque is enough, whether the blind is within Louvolite's weight capacity for it, and how long its battery lasts. The view also reads OrderBot's motor table when the page has it, for the narrowest blind a longer-lasting motor goes in.

Results show the weight, the torque a motor must give on both tubes ("Torque needed": the lift and the friction), the system, the chain or the lightest motor that lifts the blind (plus up to three others), and **every** warning; the selector only showed the first. A battery motor carries its life beside its name ("· battery about 8½ months", with "(est.)" when it is an estimate), and a charge that won't last is an amber line. Under six months the line also says what the same range's motor with the bigger battery would give on that blind (the One Touch Dual 3 Nm for a 2 Nm). A One Touch motor past its weight capacity is never offered, and a blue line names the ones the torque alone would have allowed. When there is no motor of the chosen brand, power or protocol for the tube at all, it says so rather than "not strong enough". The fabric list is read from Firestore when the view opens. If it can't load (or the page isn't signed in yet), the view says so with a **Try again** button and asks for each fabric's weight. The lines are kept in `localStorage` (`ob_roller_lines`) for that browser only, and the view writes nothing to Firestore.

## In the comparison

`runPostAIValidations` (index.html) uses the same module:

- **Weight (section 0):** the fabric from the one list (any `match`). The bottom bar is the line's own (SmartRail, plastic, else aluminium); before, it was always aluminium. Options packed into another one ("Hardware Colour = Mech Colour=White | Bottom Bar=White Plastic") are read too (`optionPairs`).
- **Fabric width (section 1):** not for verticals, panels or outdoor blinds (`notOnRollerRolls`): their fabric doesn't come off the list's roller rolls. A `part` match has no known roll, and a Roller System 40 / 55 blind gets the 35 mm allowance.
- **Chain (section 3b, `chainValidation`):** `chainCheck`.
  - A Roller System 40 is red from 4 kg without the 1.5:1 control, because the capturer must spec it (Russel, 5 Nov 2026; it was amber from 2 Nov). Over 8 kg is red too (System 55). The 1.5:1 counts as its own "System 40 1.5:1=Yes", packed into another option, or in a control. Before Nov 2026 any "1.5" in the options switched the warning off, including Blind IQ's blank "System 40 1.5:1 =".
  - On System 55 the spring advice is blue and isn't an alert. The spring counts as the option, a "Chain Spring" control, or a lift-assisting spring sundry on the order. Over 11.5 kg is reported by the System 40/55 check; a chain blind over 8 kg on System 55 is no longer red.
  - Double rollers, Perfect Fit and other roller types without 40 / 55 in their name keep the System 40 thresholds. A missing 1.5:1 stays amber on them: their sheets have no 1.5:1 option (`chainCheck`'s `can15`).
- **Roller motors (section 4b, `torqueValidation` and `batteryValidation`):** `validateRollerMotors` (13 Nov 2026). Every Roller System 40 / 55 line gets the lift-and-friction torque. The order's roller motors are paired with its motorised lines, strongest motor to the most demanding blind, one per unit of quantity. A motor too weak for its blind is red (amber where the pairing can't be known: fewer motors than blinds, or other motorised roller types on the order), a blind over Louvolite's weight capacity for its motor is amber, and a battery motor's line shows how long a charge lasts: blue, or amber when it won't last. Under six months it also says what the same range's motor with the bigger battery would give. See [validations](comparison/validations.md#roller-motors-torque-and-battery-life-validaterollermotors) for the pairing and [above](#torque-and-battery-life) for the method.
- **System 40/55 (section 4c, before the valances, `rollerValidation`):** `validateRollerSystems`. Red, amber or blue, worst first, all messages joined:
  - **Selling limit:** a blind beyond System 40's or 55's size limit is amber, or blue when the line is marked Out of Warranty.
  - **System 55 weight:** a System 55 blind over 11.5 kg is red.
  - **Too heavy for any System 40 motor:** a motorised System 40 blind needing more torque than the strongest System 40 motor (3 Nm) is amber. The torque is the one section 4b worked out. This can't happen at today's fabric weights.
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
  - Recounted on 5 Nov 2026 with the live fabric list, when Russel made the missing 1.5:1 red: 624 of 1,515 such lines had it (37 % at 4–5 kg, 62 % at 5–6 kg, 22 of 23 over 6 kg). So about 890 lines a year would have been red. The table above is the amber version of 2 Nov.

## Deploying it

The converter no longer has its own fabric tables. So before this code is live, the fabric list must hold what BlindIQ's ranges need:
- the aliases for "Linen Block", "Sheerweave 4500 Fr", "Sheerweave 4901 Fr", "Didsbury Block", "Bird Song" and "Como";
- a "10 Screen" row.

Without them, those ranges (about 8,000 lines a year) lose the converter's Out of Warranty and 1.5:1 rules. The live code ignores aliases, so adding them first is safe. Delete the "Urban Block / Paris" row only after the new code is live, since the live code still finds System 55 Urban Block by that exact name. The command-line converter outside this repository (`convert-cli.mjs`) must set `mappings.fabricList` for the same rules.

## Changing it

- **Fabrics:** edit them in the Fabric properties panel (or its CSV upload, which replaces every fabric, aliases and thicknesses included). Never add a fabric table to the code. A fabric's thickness comes from its spec sheet ("Nominal Thickness", `Sales Resource / Product Technical Specifications Fabric`).
- **Rules and the motor table:** they live in `js/roller-selector.js`, with the reasons in its header comment.
- **BlindIQ adds a roller motor:** add it to `MOTORS` with the tubes it goes in. If its family isn't already one of the patterns in `rollerMotorOf`, add it there too. A battery motor, or one with a published weight capacity, also goes in `MOTOR_DATA` (`js/roller-motor-calc.js`) with the datasheet it comes from.
- **The calculation itself** (`js/motor-calc/engine.js`, `builders.js`) is the motor-calc pack's, line for line; only a few comment lines are worded differently. Don't edit the code here: replace both files from a new pack, reword the same comment lines (`js/motor-calc/README.md`) and run the pack's own `selftest.mjs`. The test below checks the copies against the pack when it is on the PC, and lets only comment lines differ.
- **Never commit a maker's motor records**, the pack's data file or its `reference-cases.js`: they are not published figures, and every file on `main` is public. `MOTOR_DATA` holds published datasheet figures only.
- **The thresholds** are `BATTERY` (183 days, 1.5 for an estimate, and 1.25 for naming a longer-lasting motor), `EFFICIENCY`, `USABLE_BATTERY`, `DEFAULTS` and `CAPACITY_TOLERANCE_KG` in `js/roller-motor-calc.js`.
- **No regex lookbehind** (`(?<!…)`) in these modules: Safari before 16.4 can't parse it, and `roller-selector.js` is a static import of the app.
- **Tests** (regression package, see [Testing](testing.md)):
  - `new-tests/biq-roller-selector.test.mjs` (33 checks) covers the rules and their wiring into index.html and the converter. Four checks cover the motor check: kit spellings, remotes found by name, the note for an order with no remote, and no control characters in index.html.
  - `new-tests/biq-chain-15.test.mjs` (28 checks, review package "Chain 1.5 red 2026-11") covers the red 1.5:1: `chainCheck`, section 3b, the critical issues, the converter's flags and this view.
  - `new-tests/biq-motor-calc.test.mjs` (137 checks, review package "Motor calc 2026-11") covers the torque and the battery life: the published torque grid, each motor's data, the estimates and their flag, records passed in, the selector, the pairing in a comparison, the motor with the bigger battery, index.html's wiring, the converter's check panel, the fabric thickness and this view. Six of its checks need the motor-calc pack on the PC (`MOTOR_CALC_PACK`): they compare the repository's engine with the pack's and run the pack's 141 reference cycles and the motor records. Without the pack they are skipped.
  - `new-tests/_maps.mjs` gives the converter tests the fabric list (`fixtures/fabric_properties_2026-11-02.json`).
  - `tests/biq-converter.test.mjs` and `tests/biq-coupled-control.test.mjs` pass the module's functions into the code they lift from index.html.

## Related pages

- [Comparison validations](comparison/validations.md)
- [User interface](app/user-interface.md)
- [Data model](data-model.md)
- [Converter rules](converter/rules.md) (Out of Warranty, 1.5:1 in the converter)
