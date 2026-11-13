// Torque and battery life for Roller System 40 / 55 blinds (Nov 2026). Pure: tested in node.
//
// Russel (13 Nov 2026): apply the motor-calc pack's torque calculation, and its battery autonomy, to the Roller check
// and the comparison's flags, for the One Touch motors too; show the battery autonomy on each line of a comparison
// and flag it under six months.
//
// The calculation is js/motor-calc/engine.js: the pack's roller method, written outside this repository, with its
// builders (js/motor-calc/builders.js). The code is the pack's, line for line.
//   Torque:  at each point of travel, the weight still hanging (fabric + bottom bar) on the tube's radius plus the
//            fabric already rolled on it, plus bearing friction (25 % of everything the tube carries: fabric, bottom
//            bar, tube and motor). The largest value is what the motor must give, and a motor fits when its rated
//            torque is at least that. No 20 % on top: the friction and the fabric build-up are what the 20 % stood
//            for. It comes out 7 to 49 % above "weight × 9.81 × radius + 20 %" (13 % in the middle, on the 1,346
//            motorised Roller System 40 / 55 lines checked from August to November 2026).
//   Battery: battery energy ÷ (energy of one up and down a day + standby + radio + self-discharge), in days.
// Checked against published figures (Sales Resource): the torque grid for the Sonesse 30 on a Louvolite 40 tube
// ("Weight grid sonesse 30.pdf") is this calculation without the motor's weight: all 324 values to within 0.04 Nm.
// With the makers' own motor records the Roll Up Basic 28 lasts 6.5 months on the datasheets' reference blind (its
// datasheet: 6 months) and the Sonesse 28 10.3 months (its reference book: 10 months).
//
// WHAT EACH MOTOR IS (MOTOR_DATA, by BlindIQ's name as in MOTORS, js/roller-selector.js). Published figures only:
//   Louvolite One Touch Dual: the spec sheets "2025_LL_SYSTEM-40…-1100-DC / -1100-DC-SHORT / -2000-DC / -3000-DC /
//     -2000-AC / SYSTEM-55…6000-AC" and the Quick Motor Guide of January 2026 (Sales Resource, Motor One Touch Dual).
//   Louvolite One Touch +: "One Touch + Lithium 1200 / 1800 … TECHNICAL SPEC", the 1200-SHORT sheet, the R1728 1.8 Nm
//     AC data sheet and the 1.8 / 1.2 Nm programming instructions (battery sizes).
//   Somfy: the Roll Up Basic 28 WF RTS Li-ion II data sheet (DOC 161424: currents, standby, weight), the Sonesse 28
//     leaflet, the Sonesse 30 spec sheet, the Sonesse 40 WireFree flyer and the Zigbee reference book.
// Louvolite's weight capacity per motor ("Motor weight capacity of 6kg") is its own limit, so it is checked beside
// the torque. The 220 V 2 Nm motor's is 5 kg in the Quick Motor Guide and on page 1 of its sheet, 6 kg in the table
// on page 2: the lower one is used.
//
// BATTERY FIGURES ARE OF TWO KINDS, and the result says which (`basis`):
//   measured  the maker's own record of the motor (current against torque, standby, battery). Such records are not
//             published figures, so they are NOT in this repository: the caller passes
//             them in (`records`, the shape of the pack's data file: { motors, packs, cells }). A record belongs to
//             a motor by its id (MOTOR_DATA's `record`) or by a `blindIqNames` list on the record itself, so a
//             maker's figures for any motor can be added as data. 'sibling' is the record of the RTS version of a
//             Zigbee motor (same drive and battery; 10 to 12 months is published for both on the reference blind).
//   estimate  built from the datasheet: rated torque, speed, battery voltage and capacity. Louvolite publishes no
//             current for the One Touch Dual and no maker publishes the standby draw, so the builders' defaults fill
//             in (EFFICIENCY, 15 % no-load current, 100 µA standby unless the datasheet gives it, 90 % of the battery's
//             nameplate usable). Published efficiencies run from 14 % (One Touch Dual 6 Nm, 146 W) to 47 % (One Touch
//             + 1.2 Nm, 6.7 W); with the middle of that, 30 %, the One Touch Dual 2 Nm lasts 6 months (184 days) on
//             the reference blind (1.2 × 2.0 m, 375 g/m²), where Louvolite says "a full charge will last up to 6 months".
// An estimate can be a third out (at 45 % efficiency the One Touch Dual 2 Nm lasts 29 to 38 % longer; built the same
// way, the Sonesse 30 comes out 27 % under the figure its own record gives), so it is only flagged when it is under six months
// with half as much again (BATTERY.estimateMargin): under four months. A measured figure is flagged under six months,
// the interval Blind Designs' motorisation brochure gives ("Simply charge every six months").

import { rollerTorque, rollerCycle, autonomy, RF_TRAFFIC_PCT } from './motor-calc/engine.js';
import { catalogFrom, motorFromDatasheet, packFromSpec } from './motor-calc/builders.js';

// tube outside diameter (mm) of each roller system; the wall is the engine's rule (2 mm above 35 mm, aluminium),
// which is what the published grid for the Louvolite 40 tube uses
export const TUBE_MM = { 40: 40, 55: 55 };
// used when the fabric list has no thickness for a fabric (the method's default; from 0.3 to 1.2 mm the torque moves
// about 5 %), and when a motor's weight isn't published
export const DEFAULTS = { fabricThicknessMm: 0.48, motorKg: 0.5 };
// one full up and down a day, medium radio traffic: the method's defaults and the basis of the published autonomies
export const USAGE = { cyclesPerDay: 1, rfTrafficPct: RF_TRAFFIC_PCT.medium };
// altGain: a motor of the same range is named as the longer-lasting one only when it lasts a quarter longer
export const BATTERY = { minDays: 183, estimateMargin: 1.5, altGain: 1.25 };
export const EFFICIENCY = 0.3;        // electrical to mechanical at rated torque, where no current is published
export const USABLE_BATTERY = 0.9;    // share of a battery's nameplate capacity the motor can use

const li = (volts, cells, mAh) => ({ volts, cells, mAh });
const SOMFY_RTS = 'standby taken as the 85 µA Somfy publishes for the Roll Up Basic 28 (the same RTS receiver)';
// kg: the motor's weight (with its battery), where a datasheet gives it. capKg: the maker's weight capacity.
// battery: nameplate volts, cells in series, mAh. rpm: the speed the motor is delivered at. amps / noLoadAmps /
// standbyUa: published currents. record: the id of the maker's own record; sibling: that record is of the RTS
// version of this motor (same drive and battery), and the result says so. minWidthMm: the narrowest blind the motor
// goes in ("Blind width min" in Louvolite's Quick Motor Guide of January 2026), so a longer motor is never named for
// a blind it doesn't fit.
export const MOTOR_DATA = {
    'Roll Up Basic 28 Wire Free RTS 0.7nm': { maker: 'Somfy', kg: 0.5, rpm: 28, battery: li(12, 3, 1400), amps: 0.8, noLoadAmps: 0.2, standbyUa: 85, record: 'roll-up-basic-28-rts-li-ion' },
    'Sonesse 28 Wire Free RTS 1.1nm': { maker: 'Somfy', rpm: 20, battery: li(12, 3, 2600), standbyUa: 85, note: SOMFY_RTS, record: 'sonesse-28-rts-li-ion' },
    'Sonesse 30 Wire Free RTS 2nm': { maker: 'Somfy', rpm: 20, battery: li(12, 3, 2600), standbyUa: 85, note: SOMFY_RTS, record: 'sonesse-30-rts-li-ion' },
    'Sonesse 40 Wire Free RTS 3nm': { maker: 'Somfy', rpm: 20, battery: li(12, 3, 4600), standbyUa: 85, note: SOMFY_RTS },
    'Somfy Sonesse 28 Wire Free ZIGBEE 1.1nm/20rpm Li-i': { maker: 'Somfy', rpm: 20, battery: li(12, 3, 2600), record: 'sonesse-28-rts-li-ion', sibling: true },
    'Somfy Sonesse 30 Wire Free ZIGBEE 2nm/20rpm Li-ion': { maker: 'Somfy', rpm: 20, battery: li(12, 3, 2600), record: 'sonesse-30-rts-li-ion', sibling: true },
    'Somfy Sonesse 40 Wire Free ZIGBEE 3nm/30rpm Li-ion': { maker: 'Somfy', rpm: 20, battery: li(12, 3, 5000) },
    'One Touch + Motor Lithium Rechargeable 1.2nm': { maker: 'Louvolite', capKg: 3.5, rpm: 25, battery: li(7.4, 2, 2600), amps: 0.9 },
    'One Touch + Motor Lith Recharg 1.2 Short Ext Bat': { maker: 'Louvolite', capKg: 3.5 },        // external battery pack, size not published
    'One Touch + Motor Lithium Rechargeable 1.8nm': { maker: 'Louvolite', capKg: 6, rpm: 25, battery: li(7.4, 2, 3000), amps: 3 },
    'One Touch + Motor220V 1.8nm': { maker: 'Louvolite', capKg: 6 },
    'One Touch Dual Motor Lithium Ion 1.1nm': { maker: 'Louvolite', capKg: 3.5, minWidthMm: 520, rpm: 20, battery: li(7.4, 2, 2600) },
    'One Touch Dual Motor Short Lithium Ion 1.1nm': { maker: 'Louvolite', capKg: 3.5, minWidthMm: 400, rpm: 20, battery: li(12, 3, 2500) },
    // 2600 mAh on the spec sheet, 2500 in the Quick Motor Guide of January 2026: the lower one
    'One Touch Dual Motor Lithium Ion 2.0nm': { maker: 'Louvolite', capKg: 6, minWidthMm: 630, rpm: 20, battery: li(7.4, 2, 2500) },
    'One Touch Dual Motor Lithium Ion 3.0nm': { maker: 'Louvolite', capKg: 8.5, minWidthMm: 665, rpm: 20, battery: li(10.8, 3, 5000) },
    'One Touch Dual Motor 220V 2nm': { maker: 'Louvolite', capKg: 5, minWidthMm: 560 },
    'One Touch Dual Motor 220V 6nm': { maker: 'Louvolite', capKg: 12, minWidthMm: 650 },
    'One Touch Dual Matter & Thread Motor Lithium 2.0nm': { maker: 'Louvolite', capKg: 6, minWidthMm: 630, rpm: 20, battery: li(7.4, 2, 2500) },
    'One Touch Dual Matter & Thread Motor Lithium 3.0nm': { maker: 'Louvolite', capKg: 8.5, minWidthMm: 665, rpm: 20, battery: li(10.8, 3, 5000) },
    'One Touch Dual Matter & Thread Motor 220V 2nm': { maker: 'Louvolite', capKg: 5, minWidthMm: 560 },
};

// The blind as the engine takes it, or null when a figure is missing.
// spec: { system: 40 | 55, widthMm, dropMm, kgPerM2, thicknessMm (optional), barKgPerM }
export function rollerBlind(spec) {
    const { system, widthMm, dropMm, kgPerM2, thicknessMm, barKgPerM } = spec || {};
    if (!TUBE_MM[system] || !(widthMm > 0) || !(dropMm > 0) || !(kgPerM2 > 0)) return null;
    return {
        widthM: widthMm / 1000, dropM: dropMm / 1000, tubeDiameterM: TUBE_MM[system] / 1000,
        fabricThicknessM: (thicknessMm > 0 ? thicknessMm : DEFAULTS.fabricThicknessMm) / 1000,
        fabricKgPerM2: kgPerM2, bottomBarKgPerM: barKgPerM >= 0 ? barKgPerM : 0,
    };
}

// The torque the motor must give (Nm), with a motor of `motorKg` in the tube (0 for a chain blind).
// { nm, frictionNm, kg (fabric + bottom bar), tooShort } or null. tooShort: under about 1.6 turns of the tube the
// method gives no figure (a drop of some 200 mm); nm is then null, never a pass.
export function liftTorque(spec, motorKg = DEFAULTS.motorKg) {
    const blind = rollerBlind(spec);
    if (!blind) return null;
    const kg = Number(motorKg);                                    // a weight held as text must not be joined on as text
    const t = rollerTorque(blind, kg >= 0 ? kg : DEFAULTS.motorKg);
    return { nm: t.tooShortForModel ? null : t.peakTorqueNm, frictionNm: t.frictionTorqueNm, kg: t.fabricKg + t.bottomBarKg, tooShort: t.tooShortForModel };
}

// --- the makers' own records, when the caller has them ---------------------------------------------------------
// The records come from a document someone may have typed: a figure held as text ("0.645") becomes a number, so the
// engine adds it instead of joining it on. Names and ids stay text.
const TEXT_KEYS = new Set(['id', 'name', 'source', 'cellId', 'technology', 'size', 'packIds', 'blindIqNames', 'assumptions']);
function figures(v, key) {
    if (TEXT_KEYS.has(key)) return v;
    if (typeof v === 'string') return /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? +v : v;
    if (Array.isArray(v)) return v.map(x => figures(x, ''));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, figures(x, k)]));
    return v;
}
const catalogs = new WeakMap();
function catalogOf(records) {
    if (!records || typeof records !== 'object' || !Array.isArray(records.motors)) return null;
    if (catalogs.has(records)) return catalogs.get(records);
    let cat = null;
    try {
        const c = catalogFrom(figures({ motors: records.motors, packs: records.packs || [], cells: records.cells || [] }, ''));
        const byName = new Map();
        for (const m of c.motors) for (const n of Array.isArray(m.blindIqNames) ? m.blindIqNames : []) byName.set(String(n).toLowerCase().trim(), m);
        const packOf = m => { try { return c.packsFor(m)[0] || null; } catch (e) { return null; } };
        cat = { byId: new Map(c.motors.map(m => [m.id, m])), byName, packOf };
    } catch (e) { cat = null; }                       // a pack without its cell, a record without an id: no records
    catalogs.set(records, cat);
    return cat;
}
function recordOf(name, records) {
    const cat = catalogOf(records);
    if (!cat) return null;
    const d = MOTOR_DATA[name] || {};
    const own = cat.byName.get(String(name).toLowerCase().trim());
    const motor = own || (d.record ? cat.byId.get(d.record) : null);
    if (!motor) return null;
    const pack = cat.packOf(motor);
    return pack ? { motor, pack, sibling: !own && !!d.sibling } : null;
}

// the weight of the motor in the tube (kg): the maker's record, else its datasheet, else DEFAULTS.motorKg
export function motorKgOf(name, records) {
    const r = recordOf(name, records), kg = r ? Number(r.motor.massKg) : NaN;
    if (kg > 0) return kg;
    const d = MOTOR_DATA[name];
    return d && d.kg > 0 ? d.kg : DEFAULTS.motorKg;
}
// What a motor runs on, for sharing an order's motors out: Infinity for a mains motor (no charge to run down), the
// battery's nameplate Wh for a battery motor, 0 when the battery isn't known.
export function chargeWh(name, mains) {
    if (mains) return Infinity;
    const b = MOTOR_DATA[name] && MOTOR_DATA[name].battery;
    return b ? b.volts * b.mAh / 1000 : 0;
}
export const capacityKgOf = name => (MOTOR_DATA[name] && MOTOR_DATA[name].capKg) || null;
// The maker's weight capacity (kg) when the blind is over it, else null. The weight is worked out from nominal
// figures, so 50 g over isn't "over": 5.05 kg on a 5 kg motor passes, 5.06 doesn't.
export const CAPACITY_TOLERANCE_KG = 0.05;
export function overCapacity(name, kg) {
    const cap = capacityKgOf(name);
    return cap && kg - cap > CAPACITY_TOLERANCE_KG + 1e-9 ? cap : null;
}
export const hasBattery = (name, records) => !!((MOTOR_DATA[name] && MOTOR_DATA[name].battery) || recordOf(name, records));
// the narrowest blind (mm) the maker gives for the motor, or null where it isn't published
export const minWidthOf = name => (MOTOR_DATA[name] && MOTOR_DATA[name].minWidthMm) || null;
// the battery a motor is delivered with, as its datasheet names it ("10.8 V 5000 mAh"), or '' where it isn't published
export const batteryText = name => { const b = MOTOR_DATA[name] && MOTOR_DATA[name].battery; return b ? `${b.volts} V ${b.mAh} mAh` : ''; };
// How many times the energy of `than`'s battery `name`'s holds (nameplate volts × mAh), when it is the bigger one by a
// tenth or more; else 0. The One Touch Dual 3 Nm's is 2.9 times the 2 Nm's (54 Wh against 18.5 Wh).
export function biggerBattery(name, than) {
    const a = chargeWh(name, false), b = chargeWh(than, false);
    return a > 0 && b > 0 && a / b >= 1.1 ? a / b : 0;
}

// What the engine needs to run a motor on its battery: { motor, pack, basis, assumptions } or null (a 220 V motor,
// a motor whose battery isn't published, a name that isn't in MOTOR_DATA).
// basis: 'measured' (the maker's record of this motor), 'sibling' (of its RTS version), 'estimate' (the datasheet).
// nm: the motor's rated torque (MOTORS).
export function motorElectrics(name, nm, records) {
    const r = recordOf(name, records);
    const d = MOTOR_DATA[name];
    if (r) return { motor: r.motor, pack: r.pack, basis: r.sibling ? 'sibling' : 'measured', assumptions: [] };
    if (!d || !d.battery || !(nm > 0) || !(d.rpm > 0)) return null;
    const assumptions = [];
    let amps = d.amps;
    if (!(amps > 0)) {
        amps = nm * (d.rpm * 2 * Math.PI / 60) / EFFICIENCY / d.battery.volts;
        assumptions.push(`current at rated torque worked out from ${EFFICIENCY * 100} % efficiency (${amps.toFixed(2)} A): not published`);
    }
    const motor = motorFromDatasheet({ name, ratedTorqueNm: nm, ratedSpeedRpm: d.rpm, nominalVoltageV: d.battery.volts, ratedCurrentA: amps,
        noLoadCurrentA: d.noLoadAmps, standbyCurrentUa: d.standbyUa, massKg: d.kg });
    const pack = packFromSpec({ name: name + ' battery', capacityAh: d.battery.mAh / 1000 * USABLE_BATTERY, meanVoltageV: 3.6 * d.battery.cells });
    assumptions.push(...motor.assumptions, ...pack.assumptions, `${USABLE_BATTERY * 100} % of the battery's ${d.battery.mAh} mAh taken as usable`);
    if (d.note) assumptions.push(d.note);
    return { motor, pack, basis: 'estimate', assumptions };
}

// How long one charge lasts. { days, basis, short, cyclesPerCharge, energyPerCycleMWh, maker, assumptions } or null.
// short: under BATTERY.minDays; for an estimate, under it even with BATTERY.estimateMargin times the figure.
// A maker's record that can't be worked with (a cell without its tables, a figure that isn't a number) gives way to
// the datasheet estimate, never to "no figure".
export function batteryLife(spec, name, nm, records, usage = USAGE) {
    const e = motorElectrics(name, nm, records);
    const blind = e && rollerBlind(spec);
    if (!blind) return null;
    let cycle, life;
    try { cycle = rollerCycle(blind, e.motor, e.pack); life = autonomy(e.motor, e.pack, cycle, usage); } catch (err) { cycle = null; }
    const worked = cycle && life && !cycle.tooShortForModel && cycle.energyPerCycleMWh > 0 && life.days > 0 && Number.isFinite(life.days);
    if (!worked) return e.basis !== 'estimate' && records ? batteryLife(spec, name, nm, null, usage) : null;
    const short = life.days * (e.basis === 'estimate' ? BATTERY.estimateMargin : 1) < BATTERY.minDays;
    return { days: life.days, basis: e.basis, short, cyclesPerCharge: life.cyclesPerCharge, energyPerCycleMWh: cycle.energyPerCycleMWh,
        maker: (MOTOR_DATA[name] && MOTOR_DATA[name].maker) || '', assumptions: e.assumptions };
}

// "about 8½ months", never rounded up: 181 days is "about 5½ months", not 6
export function monthsText(days) {
    if (!(days > 0)) return '';
    if (days >= 365) return 'over a year';
    if (days < 7) return 'under a week';
    const halves = Math.floor(days / (365 / 12) * 2);
    if (halves < 2) return `about ${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? 's' : ''}`;
    return `about ${Math.floor(halves / 2)}${halves % 2 ? '½' : ''} month${halves === 2 ? '' : 's'}`;
}

// What the longer-lasting motor of the same range would give on the blind: "The One Touch Dual Motor Lithium Ion 3.0nm,
// with a battery 2.9 times the size (10.8 V 5000 mAh against 7.4 V 2500 mAh), would last about 6 months on this blind,
// by the same estimate." The battery is named only when it is the bigger one (a tenth or more). The kind of figure is
// named unless both figures are the maker's own.
function alternativeText(life, motorName, alt, maker) {
    const times = biggerBattery(alt.motor, motorName);
    const bigger = times ? `, with a battery ${+times.toFixed(1)} times the size (${batteryText(alt.motor)} against ${batteryText(motorName)}),` : '';
    const by = alt.basis === life.basis ? (alt.basis === 'estimate' ? ', by the same estimate' : '')
        : alt.basis === 'estimate' ? ', by an estimate from its datasheet' : ", by the maker's own figures";
    return `The ${alt.motor}${bigger} would last ${monthsText(alt.days)} on this blind${by}.`;
}

// The sentence for a battery result: { type: 'info' | 'warning', message, months ("about 8½ months") }
// alt (optional): the motor of the same range that lasts longer on this blind, { motor, days, basis }
// (biggerBatteryMotor in js/roller-selector.js). The sentence then says what that motor would give.
export function batteryMessage(life, motorName, alt) {
    if (!life) return null;
    const maker = life.maker || 'the maker', months = monthsText(life.days);
    // a figure from a record says so without naming whose record it is; an estimate names the datasheet it is built from
    const basis = life.basis === 'measured' ? "the maker's own figures" : life.basis === 'sibling' ? "the maker's figures for its RTS version" : `an estimate from ${maker}'s datasheet`;
    const text = `${months} per charge at one up and down a day (${motorName}; ${basis})`;
    const other = alt && alt.motor && alt.days > life.days ? alternativeText(life, motorName, alt, maker) : '';
    return life.short
        ? { type: 'warning', months, message: `Battery Alert: ${text} — under the six months between charges Blind Designs quotes. ` + (other ? `${other} A solar panel or a 220V motor would also suit this blind better.` : 'A bigger battery, a solar panel or a 220V motor would suit this blind better.') }
        : { type: 'info', months, message: `Battery: ${text}.` + (other ? ' ' + other : '') };
}
