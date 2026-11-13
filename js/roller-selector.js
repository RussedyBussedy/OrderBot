// The Roller System Selector's rules for Roller System 40 / 55 blinds (Nov 2026). Pure: tested in node.
//
// Source: Sales Resource "Calculation Tools/Roller Blinds/Roller system selector V2.1.xlsx" (reviewed 2 Nov 2026,
// corrected in V2.2), with the motor list taken from BlindIQ's live roller motors instead of the workbook's
// Motor Reference sheet (Russel, 2 Nov 2026): the workbook had a Sonesse 40 WF Zigbee 4Nm that BlindIQ doesn't
// sell and missed Optuo RTS 3Nm, Sonesse 40 Wired 3/6Nm, Zigbee 220V 6/9Nm and One Touch+ 220V 1.8Nm.
//
// Weight = fabric kg/m² × width × drop + bottom bar kg/m × width (aluminium 0.28, SmartRail 0.36, plastic 0.20).
// Torque: since 13 Nov 2026 the lift and the friction (Russel; js/roller-motor-calc.js): the hanging weight on the
// tube's radius plus the fabric rolled on it, plus bearing friction, at the heaviest point of travel; a motor fits
// when its rated torque is at least that. Before, it was the workbook's weight × 9.81 × tube radius (System 40
// 0.020 m, System 55 0.0275 m) plus 20 % (torqueNeeded, kept for a line the new method can't work out); the new
// figure is 7 to 49 % above it. Louvolite also gives each One Touch motor a weight capacity, checked beside the
// torque. The torque is worked out on the tube the motor goes in, so a System 40-sized blind that needs a System 55
// motor is checked on the 55 mm tube (V2.1 kept the 40 mm one). A battery motor also gets how long one charge lasts.
// Sizes: System 40 to 3200 × 3400 mm, System 55 to 4000 × 4500 mm and 11.5 kg (the selling limits in
// biq-converter.js's BIQ_SELL_LIMITS). Chain: System 40 1:1 to 4 kg, 1.5:1 from 4 to 8 kg, over 8 kg System 55.
// A Roller System 40 of 4–8 kg without the 1.5:1 is red: the capturer must spec it (Russel, 5 Nov 2026; amber from
// 2 Nov, when 624 of 1,515 such BlindIQ lines of Nov 2025 – Oct 2026 had it: 37% at 4–5 kg, 62% at 5–6, 22 of 23
// over 6). Roller types whose sheet has no 1.5:1 option (double rollers, Perfect Fit) keep the amber warning.
// On System 55 the Lift Assisting Spring is recommended over 4.5 kg, never flagged (11 of 85 had it).
//
// Used by the "Roller check" view (js/roller-selector-ui.js), by runPostAIValidations (index.html) and by the
// converter (js/biq-converter.js): findFabric for the weight and roll, chainCheck for the chain,
// validateRollerSystems for the size limits and which tube the order's motors fit.
//
// Fabrics: there is ONE list, OrderBot's Fabric properties (Firestore orderbot_fabric_properties, edited in the
// panel on the Orders view; Russel, 2 Nov 2026). Nothing here keeps a copy: the caller passes the list built by
// fabricList(). Each fabric is { fabricName, fabricWeight (kg/m²), fabricWidth (roll mm), canTurn (Yes / No / Out),
// aliases (other spellings: BlindIQ's range names such as "Didsbury Block", dealer spellings),
// fabricThickness (mm, optional: the spec sheet's nominal thickness, for the torque; 0.48 mm when it isn't there) }.

import { DEFAULTS, BATTERY, liftTorque, motorKgOf, overCapacity, chargeWh, batteryLife, batteryMessage, monthsText, minWidthOf, biggerBattery, MOTOR_DATA } from './roller-motor-calc.js';

export const RADIUS = { 40: 0.02, 55: 0.0275 };
export const SAFETY = 1.2;
export const LIMITS = { 40: { width: 3200, drop: 3400 }, 55: { width: 4000, drop: 4500, kg: 11.5 } };
export const CHAIN = { ratio15From: 4, sys40Max: 8, springFrom: 4.5 };
export const BAR_KG = { alu: 0.28, smartrail: 0.36, plastic: 0.2 };
// A Roller System 40 / 55 blind may be this much wider than its fabric's roll (the brackets and the tube's
// ends take it; review queue #26, the converter's biqWarrantyReason uses the same allowance).
export const ROLL_ALLOWANCE = 35;

const s = v => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const lc = v => s(v).toLowerCase();
const mmOf = v => { const m = s(v).match(/\d{2,5}(?:\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };

// "Texblock, 5 Screen / Aventus 5%" or ["Texblock", …] -> clean list of other spellings
export const aliasList = v => (Array.isArray(v) ? v : s(v).split(/[,;|]/)).map(s).filter(Boolean);

// Fabric properties documents -> Map keyed by every name and alias (lower case). Each value keeps the
// document's own fields and adds { name, kg, roll, turn, thick }: kg null when the weight is missing or implausible
// (over 5 kg/m², e.g. 450 typed for 0.45), turn 'yes' | 'out' | 'no', thick the thickness in mm (null when it is
// missing or not between 0 and 3 mm).
const fabricFields = d => {
    const kg = parseFloat(d.fabricWeight), t = lc(d.canTurn), mm = parseFloat(d.fabricThickness);
    return { name: s(d.fabricName), kg: kg > 0 && kg <= 5 ? kg : null, roll: parseInt(d.fabricWidth, 10) || null,
        turn: /^y/.test(t) ? 'yes' : /^o/.test(t) ? 'out' : 'no', aliases: aliasList(d.aliases), thick: mm > 0 && mm <= 3 ? mm : null };
};
export function fabricList(docs) {
    const map = new Map(), all = [];
    for (const d of docs || []) if (d && s(d.fabricName)) all.push({ ...d, ...fabricFields(d) });
    // names first, then aliases: an alias never hides another fabric's own name
    for (const f of all) if (!map.has(lc(f.name))) map.set(lc(f.name), f);
    for (const f of all) for (const a of f.aliases.map(lc)) if (!map.has(a)) map.set(a, f);
    return map;
}
// the distinct fabrics of a list, sorted by name
export const fabricsOf = list => [...new Set(list ? list.values() : [])].sort((a, b) => a.name.localeCompare(b.name));

// The fabric of a BlindIQ range (+ colour), or null. The result is the list's fabric plus `match`, how it was found:
//   'name'   the range is a fabric's name or alias as written (without a trailing "#")
//   'print'  Blind IQ's PDF shortened the range ("Perspective White Bac"): 12+ characters that start exactly one
//            fabric's name or alias (the comparison's rule checks read shortened print the same way)
//   'design' a "Designer Fab X" range, by the colour's design ("Argent Gold 2050mm @" -> Argent), with the colour's
//            own roll width when it gives one
//   'part'   one side of " / " ("5 Screen / Aventus 5%" -> 5 Screen). System 55's "X / Y" ranges are other mills'
//            fabrics, often on wider rolls (Nov 2025 – Oct 2026: 107 "5 Screen / Aventus 5%" blinds over 3035 mm
//            wide, not Out of Warranty), so a 'part' match is good for the weight but not for the roll width
export function findFabric(list, range, colour) {
    if (!list || !list.size) return null;
    const r = lc(range).replace(/\s*#\s*$/, '');
    if (!r) return null;
    // a fabricList() entry, or a bare Fabric properties document (the Map getFabricProperties returned before Nov 2026)
    const as = (f, match, extra) => ({ ...f, ...('turn' in f && 'kg' in f ? {} : fabricFields(f)), ...extra, match });
    if (list.has(r)) return as(list.get(r), 'name');
    if (/^designer fab/.test(r)) {
        const c = lc(colour);
        const key = [...list.keys()].filter(k => c === k || c.startsWith(k + ' ')).sort((a, b) => b.length - a.length)[0];
        if (!key) return null;
        const m = s(colour).match(/(?:^|\D)(\d{4})\s*mm/i);    // not BlindIQ's "17500mm" typo (no lookbehind: Safari < 16.4)
        return as(list.get(key), 'design', m ? { roll: +m[1] } : {});
    }
    if (r.length >= 12) {
        const hits = new Set([...list.keys()].filter(k => k.length > r.length && k.startsWith(r)).map(k => list.get(k)));
        if (hits.size === 1) return as([...hits][0], 'print');
    }
    if (r.includes(' / ')) for (const k of r.split(' / ').map(x => x.trim())) if (list.has(k)) return as(list.get(k), 'part');
    return null;
}

export const barKg = bar => (/smart\s*rail/i.test(s(bar)) ? BAR_KG.smartrail : /plastic/i.test(s(bar)) ? BAR_KG.plastic : BAR_KG.alu);

// kg, or null without a fabric weight
export function rollerWeight(kgPerM2, widthMm, dropMm, bar) {
    const w = +widthMm / 1000, d = +dropMm / 1000;
    if (!(kgPerM2 > 0) || !(w > 0) || !(d > 0)) return null;
    return kgPerM2 * w * d + barKg(bar) * w;
}

export const torqueNeeded = (kg, system) => (kg > 0 && RADIUS[system] ? kg * 9.81 * RADIUS[system] * SAFETY : null);

// The workbook's Fabric Width Check: the width against the roll (plus `allowance`, ROLL_ALLOWANCE on a Roller System
// 40 / 55 blind); a turned fabric needs the drop within the roll.
// { status: 'ok' | 'turned' | 'turned-oow' | 'too-wide' | 'too-wide-turned', message }, or null without a roll width
// (or with only a " / " part match, whose roll isn't known).
export function fabricWidthCheck(fabric, widthMm, dropMm, allowance = 0) {
    if (!fabric || !fabric.roll || fabric.match === 'part' || !(widthMm > 0)) return null;
    const { roll, turn, name } = fabric;
    if (widthMm <= roll + allowance) return { status: 'ok', message: `${widthMm} mm fits the ${roll} mm ${name} roll${widthMm > roll ? ` (a blind may be ${allowance} mm wider than its fabric)` : ''}.` };
    if (turn === 'no') return { status: 'too-wide', message: `${widthMm} mm is wider than the ${roll} mm ${name} roll, and ${name} can't be turned.` };
    if (dropMm > roll) return { status: 'too-wide-turned', message: `${widthMm} mm is wider than the ${roll} mm ${name} roll, and turned the ${dropMm} mm drop is too long for it.` };
    return turn === 'out'
        ? { status: 'turned-oow', message: `${name} is turned to make ${widthMm} mm (roll ${roll} mm) — Out of Warranty: flag it to the client.` }
        : { status: 'turned', message: `${name} is turned to make ${widthMm} mm (roll ${roll} mm), within warranty.` };
}

export const fitsSize = (system, widthMm, dropMm) => widthMm <= LIMITS[system].width && dropMm <= LIMITS[system].drop;

// BlindIQ's roller motors (Nov 2026), in BlindIQ's names. systems = the roller tubes it goes in, as capturers
// fit them (Nov 2025 – Oct 2026 orders) and as BlindIQ's adaptor kits allow (the "Sys 55 Adaptor Kit for
// Sonesse 30 Wire Free" puts the Sonesse 30 WF in a 55 mm tube). power 'wf' = battery (wire-free), '220v'.
// The two Motion motors are 220 V (Russel, 13 Nov 2026), so they get no battery figure.
// variant: a short-head or no-battery version of another motor, checked but never recommended on its own.
export const MOTORS = [
    { name: 'Roll Up Basic 28 Wire Free RTS 0.7nm', brand: 'Somfy', protocol: 'RTS', power: 'wf', nm: 0.7, systems: [40] },
    { name: 'Sonesse 28 Wire Free RTS 1.1nm', brand: 'Somfy', protocol: 'RTS', power: 'wf', nm: 1.1, systems: [40] },
    { name: 'Sonesse 30 Wire Free RTS 2nm', brand: 'Somfy', protocol: 'RTS', power: 'wf', nm: 2, systems: [40, 55] },
    { name: 'Sonesse 40 Wire Free RTS 3nm', brand: 'Somfy', protocol: 'RTS', power: 'wf', nm: 3, systems: [55] },
    { name: 'Optuo Rts 3nm/30', brand: 'Somfy', protocol: 'RTS', power: '220v', nm: 3, systems: [55] },
    { name: 'Sonesse 40 Rts 3nm/30', brand: 'Somfy', protocol: 'RTS', power: '220v', nm: 3, systems: [55] },
    { name: 'Sonesse 40 Rts 6nm/20', brand: 'Somfy', protocol: 'RTS', power: '220v', nm: 6, systems: [55] },
    { name: 'Sonesse 40 Rts 9nm/12', brand: 'Somfy', protocol: 'RTS', power: '220v', nm: 9, systems: [55] },
    { name: 'Sonesse 40 Wired 3nm/30', brand: 'Somfy', protocol: 'Wired switch', power: '220v', nm: 3, systems: [55] },
    { name: 'Sonesse 40 Wired 6nm/20', brand: 'Somfy', protocol: 'Wired switch', power: '220v', nm: 6, systems: [55] },
    { name: 'Somfy Sonesse 28 Wire Free ZIGBEE 1.1nm/20rpm Li-i', brand: 'Somfy', protocol: 'Zigbee', power: 'wf', nm: 1.1, systems: [40] },
    { name: 'Somfy Sonesse 28 Wire Free ZIGBEE 1.1nm No Battery', brand: 'Somfy', protocol: 'Zigbee', power: 'wf', nm: 1.1, systems: [40], variant: true },
    { name: 'Somfy Sonesse 30 Wire Free ZIGBEE 2nm/20rpm Li-ion', brand: 'Somfy', protocol: 'Zigbee', power: 'wf', nm: 2, systems: [40, 55] },
    { name: 'Somfy Sonesse 40 Wire Free ZIGBEE 3nm/30rpm Li-ion', brand: 'Somfy', protocol: 'Zigbee', power: 'wf', nm: 3, systems: [55] },
    { name: 'Somfy Sonesse 40 ZIGBEE 3nm/30rpm 220V', brand: 'Somfy', protocol: 'Zigbee', power: '220v', nm: 3, systems: [55] },
    { name: 'Somfy Sonesse 40 ZIGBEE 6nm/20rpm 220V', brand: 'Somfy', protocol: 'Zigbee', power: '220v', nm: 6, systems: [55] },
    { name: 'Somfy Sonesse 40 ZIGBEE 9nm/12rpm 220V', brand: 'Somfy', protocol: 'Zigbee', power: '220v', nm: 9, systems: [55] },
    { name: 'One Touch + Motor Lithium Rechargeable 1.2nm', brand: 'One Touch Plus', protocol: 'Standard', power: 'wf', nm: 1.2, systems: [40] },
    { name: 'One Touch + Motor Lith Recharg 1.2 Short Ext Bat', brand: 'One Touch Plus', protocol: 'Standard', power: 'wf', nm: 1.2, systems: [40], variant: true },
    { name: 'One Touch + Motor Lithium Rechargeable 1.8nm', brand: 'One Touch Plus', protocol: 'Standard', power: 'wf', nm: 1.8, systems: [40] },
    { name: 'One Touch + Motor220V 1.8nm', brand: 'One Touch Plus', protocol: 'Standard', power: '220v', nm: 1.8, systems: [40] },
    { name: 'One Touch Dual Motor Lithium Ion 1.1nm', brand: 'One Touch Dual', protocol: 'Standard', power: 'wf', nm: 1.1, systems: [40] },
    { name: 'One Touch Dual Motor Short Lithium Ion 1.1nm', brand: 'One Touch Dual', protocol: 'Standard', power: 'wf', nm: 1.1, systems: [40], variant: true },
    { name: 'One Touch Dual Motor Lithium Ion 2.0nm', brand: 'One Touch Dual', protocol: 'Standard', power: 'wf', nm: 2, systems: [40] },
    { name: 'One Touch Dual Motor Lithium Ion 3.0nm', brand: 'One Touch Dual', protocol: 'Standard', power: 'wf', nm: 3, systems: [40] },
    { name: 'One Touch Dual Motor 220V 2nm', brand: 'One Touch Dual', protocol: 'Standard', power: '220v', nm: 2, systems: [40] },
    { name: 'One Touch Dual Motor 220V 6nm', brand: 'One Touch Dual', protocol: 'Standard', power: '220v', nm: 6, systems: [55] },
    { name: 'One Touch Dual Matter & Thread Motor Lithium 2.0nm', brand: 'One Touch Dual', protocol: 'Matter & Thread', power: 'wf', nm: 2, systems: [40] },
    { name: 'One Touch Dual Matter & Thread Motor Lithium 3.0nm', brand: 'One Touch Dual', protocol: 'Matter & Thread', power: 'wf', nm: 3, systems: [40] },
    { name: 'One Touch Dual Matter & Thread Motor 220V 2nm', brand: 'One Touch Dual', protocol: 'Matter & Thread', power: '220v', nm: 2, systems: [40] },
    { name: 'Motion 25 1.5nm Electronic Limits', brand: 'Motion', protocol: 'Motion RF', power: '220v', nm: 1.5, systems: [40] },
    { name: 'Motion 40 6nm Electronic Limits', brand: 'Motion', protocol: 'Motion RF', power: '220v', nm: 6, systems: [55] },
];
export const BRANDS = ['Somfy', 'One Touch Dual', 'One Touch Plus', 'Motion'];
export const protocolsOf = brand => [...new Set(MOTORS.filter(m => m.brand === brand).map(m => m.protocol))];

// A sundry's text -> { nm, systems, name } for a roller motor, or null (adaptor kits, chargers, remotes, outdoor,
// curtain, cellular and tilt motors). By family, so BlindIQ's prefixes ("Motors Somfy Rts / …") don't matter.
// Accessories and parts: adaptor kits (BlindIQ also spells them "Adpator", "Adpater"), chargers, remotes, battery
// packs and tubes, power supplies, motor plates and drives, the lift spring; and motors that aren't roller motors.
const NOT_A_ROLLER_MOTOR = /ad[ao]?p[a-z]*t|adpat|\bkit\b|charger|remote|extension|\bhub\b|switch|solar|panel|bracket|crown|battery\s*(pack|tube)|external\s*battery|replacement|power\s*supply|transformer|\bplate\b|\bdrive\b|\bcable\b|spring|maestria|shawsmart|curtain|cellular|tilt|allusion|vertical/;
export function rollerMotorOf(text) {
    const t = lc(text);
    if (!t) return null;
    // BlindIQ's own name, also behind its type ("Motors One Touch Dual - One Touch Dual Motor 220V 6nm")
    const known = MOTORS.find(m => t === lc(m.name) || t.endsWith(' ' + lc(m.name)));
    if (known) return { nm: known.nm, systems: known.systems, name: known.name };
    if (NOT_A_ROLLER_MOTOR.test(t)) return null;
    // BlindIQ's name inside other wording, the longest first ("ZIQ20220 Motors Somfy Rts Sonesse 30 Wire Free RTS 2nm
    // (Qty: 10.00)", "One Touch Dual Motor Lithium Ion 2.0nm (ZIQ40005)"): the motor itself, so its data is found
    const inside = MOTORS.filter(m => t.includes(lc(m.name))).sort((a, b) => b.name.length - a.name.length)[0];
    if (inside) return { nm: inside.nm, systems: inside.systems, name: inside.name };
    // another wording of a roller motor: only with its torque, which every BlindIQ roller motor name gives
    const nmM = t.match(/(\d+(?:\.\d+)?)\s*n\.?m\b/);
    if (!nmM) return null;
    const nm = parseFloat(nmM[1]);
    let systems = null;
    if (/sonesse\s*40|optuo|motion\s*40/.test(t) || (/one\s*touch\s*dual/.test(t) && nm === 6)) systems = [55];
    else if (/sonesse\s*30/.test(t)) systems = [40, 55];
    else if (/sonesse\s*28|roll\s*up|motion\s*25|one\s*touch\s*(dual|\+|plus)/.test(t)) systems = [40];
    return systems ? { nm, systems, name: s(text) } : null;
}

// The chain for a manual blind. { level: 'ok' | 'info' | 'warning' | 'error', advice, message }
// can15: the blind's sheet offers the 1.5:1 control (a Roller System 40). A missing 1.5:1 is then red; on a roller
// type without the option (double rollers, Perfect Fit), which only borrows System 40's thresholds, it stays amber.
// Off unless the caller says so: for the few minutes GitHub Pages lets a browser keep the previous index.html,
// that page calls this without it and gets the amber of before, never a red a double roller can't clear.
export function chainCheck(system, kg, { has15 = false, hasSpring = false, can15 = false } = {}) {
    if (!(kg > 0)) return null;
    const w = kg.toFixed(1) + ' kg';
    if (system === 40) {
        if (kg > CHAIN.sys40Max) return { level: 'error', advice: 'System 55 chain', message: `Chain Alert: ${w} is too heavy for a System 40 chain (over ${CHAIN.sys40Max} kg) — System 55 (with the Lift Assisting Spring), or motorise.` };
        if (kg > CHAIN.ratio15From) return has15
            ? { level: 'ok', advice: '1.5:1 chain', message: `${w}: the 1.5:1 control is on the order, as the selector needs from ${CHAIN.ratio15From} kg.` }
            : { level: can15 ? 'error' : 'warning', advice: '1.5:1 chain', message: `Chain Alert: ${w} is over ${CHAIN.ratio15From} kg — the Roller System Selector needs the 1.5:1 control (System 40 1.5:1=Yes); the standard 1:1 chain is not enough.` };
        return { level: 'ok', advice: 'Standard 1:1 chain', message: `${w}: standard 1:1 chain.` };
    }
    if (system === 55) {
        if (kg > LIMITS[55].kg) return { level: 'error', advice: 'Too heavy', message: `Chain Alert: ${w} is over System 55's ${LIMITS[55].kg} kg limit — ask the factory.` };
        if (kg > CHAIN.springFrom && !hasSpring) return { level: 'info', advice: 'System 55 chain + Lift Assisting Spring', message: `${w}: the selector recommends the Lift Assisting Spring on a System 55 chain over ${CHAIN.springFrom} kg (not on the order).` };
        return { level: 'ok', advice: kg > CHAIN.springFrom ? 'System 55 chain + Lift Assisting Spring' : 'System 55 chain', message: `${w}: System 55 chain.` };
    }
    return null;
}

// What a motor must give on a tube (Nm): the lift and friction with a motor of motorKg in the tube (0 for a chain blind),
// or the workbook's weight × 9.81 × radius + 20 % for a blind too short for the method (under some 200 mm of drop).
// To two decimals, as it is shown: a 2 Nm motor passes a blind that "needs 2.00 Nm".
const round2 = x => Math.round(x * 100) / 100;
const needOn = (spec, kg, motorKg) => { const t = liftTorque(spec, motorKg); return round2(t && t.nm != null ? t.nm : torqueNeeded(kg, spec.system)); };

// The motors that lift the blind on a tube, weakest first: fit = [{ motor, system, needed }] (needed = the torque with
// that motor in the tube). A One Touch motor whose weight capacity the blind exceeds is never offered: capped lists
// those the torque alone would have allowed.
function fittingMotors(specOn, kg, systems, { brand, power, protocol }, records) {
    const fit = [], capped = [];
    for (const m of MOTORS) {
        if (brand && m.brand !== brand) continue;
        if (power && m.power !== power) continue;
        if (protocol && m.protocol !== protocol) continue;
        if (m.variant) continue;
        const cap = overCapacity(m.name, kg);
        for (const sys of systems) {
            if (!m.systems.includes(sys)) continue;
            const needed = needOn(specOn(sys), kg, motorKgOf(m.name, records));
            if (needed == null || m.nm < needed) continue;
            if (cap) capped.push({ motor: m, system: sys, cap });
            else fit.push({ motor: m, system: sys, needed });
        }
    }
    // System 40 first (no tube upgrade), then the smallest motor
    fit.sort((a, b) => (a.system - b.system) || (a.motor.nm - b.motor.nm));
    return { fit, capped };
}

// The motor of the same range that would last longer on this blind. Russel (13 Nov 2026): "if someone has spec'd a
// one touch dual 2nm motor and the battery autonomy would only be 2 months, could you give them what a 3nm one touch
// dual motor would be as a comparison?" (The 3 Nm's battery is 10.8 V 5000 mAh, the 2 Nm's 7.4 V 2500 mAh.)
// Asked when a charge lasts under six months (BATTERY.minDays), flagged or not. The motor must have the bigger
// battery by its datasheet (a tenth or more: a published fact, where how much current a motor draws is mostly
// assumed), and be one the blind can take as it stands: the same brand and protocol (a Matter & Thread motor for a
// Matter & Thread one), not a short or no-battery version, for the blind's own tube, strong enough with its own
// weight in the tube, within its weight capacity, and not longer than the blind is wide. The narrowest blind is
// OrderBot's own figure where the caller has one (minWidthOf: the motor table's Min W; Russel, 13 Nov 2026: "Stay
// with our min widths"), else Louvolite's (MOTOR_DATA). Of those, the one that lasts longest, and only when that is
// a quarter longer than the motor on the blind (BATTERY.altGain).
// spec: the blind on its tube (rollerBlind's shape); kg: fabric + bottom bar; life: batteryLife() of motorName on it.
// -> { motor, nm, days, basis } or null
export function biggerBatteryMotor(spec, kg, motorName, life, { records, minWidthOf: callerMinWidth } = {}) {
    const own = MOTORS.find(m => m.name === motorName);
    if (!own || !spec || !life || !(life.days > 0)) return null;
    let best = null;
    for (const m of MOTORS) {
        if (m === own || m.variant || m.power !== 'wf' || m.brand !== own.brand || m.protocol !== own.protocol || !m.systems.includes(spec.system)) continue;
        if (!biggerBattery(m.name, own.name)) continue;
        const ours = typeof callerMinWidth === 'function' ? callerMinWidth(m.name) : null;
        const minWidth = ours > 0 ? ours : (minWidthOf(m.name) || 0);
        if (minWidth > 0 && spec.widthMm < minWidth) continue;
        if (kg > 0 && overCapacity(m.name, kg)) continue;
        if (!(m.nm >= needOn(spec, kg, motorKgOf(m.name, records)))) continue;
        const l = batteryLife(spec, m.name, m.nm, records);
        if (!l || !(l.days >= life.days * BATTERY.altGain)) continue;
        if (!best || l.days > best.days) best = { motor: m.name, nm: m.nm, days: l.days, basis: l.basis };
    }
    return best;
}

// The narrowest blind (mm) a motor goes in by OrderBot's motor table (orderbot_motor_properties' "Min W", the figure
// its own "Below Minimum Width" check uses), or null when the table has none for it. The motor's row for the blind's
// own roller system when it has one, else its row for the other.
export function tableMinWidth(motorTable, name, system) {
    let own = 0, other = 0;
    for (const row of Array.isArray(motorTable) ? motorTable : []) {
        const rowSystem = rollerSystemOf(row && row.blindType);
        if (!rowSystem || lc(row.motorName) !== lc(name)) continue;
        const w = parseInt(row.minWidth, 10);
        if (!(w > 0)) continue;
        if (rowSystem === system) own = Math.max(own, w); else other = Math.max(other, w);
    }
    return own || other || null;
}

// One blind, as the selector's multi-line sheet works it out, with every warning (V2.1 showed only the first).
// input: { fabrics (fabricList()), system: 40 | 55 | 'auto', fabric (name, alias or BlindIQ range), colour,
//          kgPerM2 (a weight typed for a fabric that isn't in the list or has no usable weight there; a listed
//          fabric's own weight wins, and a message says so),
//          width, drop, bar, control: 'chain' | 'motor', brand, power: 'wf' | '220v', protocol, motorName (a MOTORS name
//          to check), has15, hasSpring, records (the makers' own motor records, when the page has them),
//          motorTable (OrderBot's motor table, when the page has it: its Min W is the narrowest blind a motor goes in) }
// -> { fabric, kg, widthCheck, system, chain, torque: {40, 55} (what a motor must give on each tube), recommended,
//      alternatives (each { motor, system, needed, battery }), motorCheck, motorBattery, motorBatteryAlternative, messages }
// battery / motorBattery: how long one charge lasts (batteryLife in js/roller-motor-calc.js), null for a 220V motor.
// motorBatteryAlternative: under six months, the same range's motor that would last longer (biggerBatteryMotor), or null.
export function selectRollerSystem(input) {
    const width = mmOf(input.width), drop = mmOf(input.drop);
    const messages = [];
    const add = (level, text) => messages.push({ level, text });
    const fabric = input.fabric ? findFabric(input.fabrics, input.fabric, input.colour) : null;
    // The typed weight is for a fabric that isn't listed. It used to replace a listed fabric's weight without a word,
    // and "Copy" in the Roller check view carried it to the next blind: 5 Screen at 2450 × 2600 with a left-over 0.2
    // read 1.96 kg and "Standard 1:1 chain" where the list's 0.569 gives 4.31 kg and the 1.5:1 (Nov 2026).
    const typedKg = input.kgPerM2 > 0 ? +input.kgPerM2 : null, listedKg = fabric && fabric.kg > 0 ? fabric.kg : null;
    const kgM2 = listedKg != null ? listedKg : typedKg;
    const res = { fabric, width, drop, kg: null, widthCheck: null, system: null, chain: null, torque: {}, recommended: null, alternatives: [], motorCheck: null, motorBattery: null, motorBatteryAlternative: null, messages };
    if (!(width > 0) || !(drop > 0)) { add('info', 'Enter the width and drop.'); return res; }
    if (input.fabric && !fabric) add('warning', `"${s(input.fabric)}" isn't in OrderBot's fabric list — enter its weight (kg/m²), or add it under Fabric properties on the Orders view.`);
    if (fabric && fabric.kg == null && !(input.kgPerM2 > 0)) add('warning', `OrderBot's fabric list has no usable weight for ${fabric.name} — enter it (kg/m²), and correct it under Fabric properties.`);
    if (typedKg != null && listedKg != null && Math.abs(typedKg - listedKg) > 1e-9)
        add('info', `${fabric.name} is in OrderBot's fabric list at ${listedKg} kg/m², so that weight is used, not the ${typedKg} typed. To work with your own weight, clear the fabric.`);
    const kg = rollerWeight(kgM2, width, drop, input.bar);
    res.kg = kg;
    res.widthCheck = fabricWidthCheck(fabric, width, drop, ROLL_ALLOWANCE);
    if (res.widthCheck && res.widthCheck.status !== 'ok') add(/^too-wide/.test(res.widthCheck.status) ? 'error' : res.widthCheck.status === 'turned' ? 'info' : 'warning', res.widthCheck.message);

    const forced = input.system === 40 || input.system === 55 ? input.system : null;
    const fits40 = fitsSize(40, width, drop), fits55 = fitsSize(55, width, drop);
    if (forced && !fitsSize(forced, width, drop)) add(forced === 55 || !fits55 ? 'error' : 'warning', `${width} × ${drop} mm is beyond the System ${forced} selling limit (${LIMITS[forced].width} × ${LIMITS[forced].drop} mm) — Out of Warranty, ask the factory.`);
    if (!forced && !fits55) add('error', `${width} × ${drop} mm is beyond every roller system (System 55 to ${LIMITS[55].width} × ${LIMITS[55].drop} mm) — ask the factory.`);
    // the blind on a tube, as js/roller-motor-calc.js takes it (the fabric's own thickness when the list has it)
    const specOn = sys => ({ system: sys, widthMm: width, dropMm: drop, kgPerM2: kgM2, thicknessMm: fabric ? fabric.thick : null, barKgPerM: barKg(input.bar) });
    const inTube = input.control === 'motor' ? DEFAULTS.motorKg : 0;
    if (kg != null) { res.torque[40] = needOn(specOn(40), kg, inTube); res.torque[55] = needOn(specOn(55), kg, inTube); }

    if (input.control !== 'motor') {
        let sys = forced || (fits40 && !(kg > CHAIN.sys40Max) ? 40 : 55);
        if (!forced && !fits40 && fits55) add('info', `${width} × ${drop} mm is over System 40's ${LIMITS[40].width} × ${LIMITS[40].drop} mm: System 55.`);
        res.system = sys;
        res.chain = chainCheck(sys, kg, { ...input, can15: true });   // a Roller System 40 / 55: the sheet has the 1.5:1
        if (res.chain && res.chain.level !== 'ok') add(res.chain.level, res.chain.message);
        if (!forced && sys === 55 && fits40 && kg > CHAIN.sys40Max) add('info', `Over ${CHAIN.sys40Max} kg on a chain: System 55.`);
        if (sys === 55 && kg > LIMITS[55].kg && !(res.chain && res.chain.level === 'error')) add('error', `${kg.toFixed(1)} kg is over System 55's ${LIMITS[55].kg} kg limit.`);
        if (kg == null) add('info', 'Enter the fabric (or its weight) to work out the chain.');
        return res;
    }

    // motorised
    const systems = forced ? [forced] : fits40 ? [40, 55] : [55];
    if (kg == null) {
        res.system = forced || (fits40 ? 40 : 55);
        add('info', 'Enter the fabric (or its weight) to work out the torque and the motors that lift it.');
        checkMotorOnOrder(input, res, { kg, forced, fits40, add, specOn });
        return res;
    }
    const filters = { brand: input.brand || '', power: input.power || '', protocol: input.protocol || '' };
    const { fit, capped } = fittingMotors(specOn, kg, systems, filters, input.records);
    const cappedNames = [...new Set(capped.map(c => `${c.motor.name} (${c.cap} kg)`))];
    const withBattery = x => ({ ...x, battery: batteryLife(specOn(x.system), x.motor.name, x.motor.nm, input.records) });
    if (fit.length) {
        res.recommended = withBattery(fit[0]);
        // each motor once, on the tube it is listed first for
        res.alternatives = fit.slice(1).filter((x, i, a) => x.motor !== fit[0].motor && a.findIndex(y => y.motor === x.motor) === i).slice(0, 3).map(withBattery);
        res.system = fit[0].system;
        if (!forced && fits40 && fit[0].system === 55) {
            const any40 = MOTORS.some(m => !m.variant && m.systems.includes(40) && (!filters.brand || m.brand === filters.brand)
                && (!filters.power || m.power === filters.power) && (!filters.protocol || m.protocol === filters.protocol));
            add('warning', (any40
                ? `No ${describe(filters)} System 40 motor is strong enough for ${kg.toFixed(1)} kg`
                : `There is no ${describe(filters)} motor for a System 40 tube`)
                + `: ${fit[0].motor.name} goes in System 55, so the blind is made on System 55 (motor upgrade).`);
        }
    } else {
        res.system = forced || (fits40 ? 40 : 55);
        // say what would work instead, never change the power or brand silently
        const other = fittingMotors(specOn, kg, systems, { brand: filters.brand }, input.records).fit[0] || fittingMotors(specOn, kg, systems, {}, input.records).fit[0];
        // no such motor for these tubes at all, or none strong enough
        const anyForTube = MOTORS.some(m => !m.variant && systems.some(x => m.systems.includes(x)) && (!filters.brand || m.brand === filters.brand)
            && (!filters.power || m.power === filters.power) && (!filters.protocol || m.protocol === filters.protocol));
        const tubes = 'System ' + systems.join(' or '), last = systems[systems.length - 1];
        // none for these tubes at all; or the torque would do but the blind is over Louvolite's weight capacity for
        // every one that has it; or none strong enough
        add('error', (!anyForTube ? `There is no ${describe(filters)} motor for a ${tubes} tube`
            : capped.length ? `No ${describe(filters)} motor takes ${kg.toFixed(1)} kg: it is over the weight capacity Louvolite gives the ${cappedNames.join(', the ')}, whose torque would do`
                : `No ${describe(filters)} motor is strong enough for ${kg.toFixed(1)} kg (needs ${needOn(specOn(last), kg, DEFAULTS.motorKg).toFixed(2)} Nm on System ${last})`)
            + (other ? ` — ${other.motor.name} (System ${other.system}) would.` : '.'));
    }
    // Louvolite's weight capacity kept a motor out that the torque alone would have allowed: say so
    if (capped.length && fit.length) add('info', `${kg.toFixed(1)} kg is over the weight capacity Louvolite gives the ${cappedNames.join(', the ')}: not offered, although the torque would do.`);
    if (res.system === 55 && kg > LIMITS[55].kg) add('error', `${kg.toFixed(1)} kg is over System 55's ${LIMITS[55].kg} kg limit.`);
    // the motor the selector would pick: a battery that won't last is worth knowing before it is ordered, with what the
    // same range's longer-lasting motor would give
    if (res.recommended && res.recommended.battery && res.recommended.battery.short && !input.motorName) {
        const r = res.recommended, alt = biggerBatteryMotor(specOn(r.system), kg, r.motor.name, r.battery, { records: input.records, minWidthOf: name => tableMinWidth(input.motorTable, name, r.system) });
        add('warning', batteryMessage(r.battery, r.motor.name, alt).message);
    }

    checkMotorOnOrder(input, res, { kg, forced, fits40, add, specOn });
    return res;
}
// The motor picked under "Motor on the order": the tube it fits (also without a weight) and, with one, its torque,
// the maker's weight capacity and, for a battery motor, how long a charge lasts.
// The tube is the one the blind must have: the system picked, else System 55 when the size is over System 40's,
// else System 40 when the motor fits it (System 55 for a System 55-only motor, a motor upgrade).
function checkMotorOnOrder(input, res, { kg, forced, fits40, add, specOn }) {
    if (!input.motorName) return;
    const parsed = MOTORS.find(x => x.name === input.motorName) || rollerMotorOf(input.motorName);
    if (!parsed) return;
    const sys = forced || (!fits40 ? 55 : parsed.systems.includes(40) ? 40 : 55);
    const tubeOk = parsed.systems.includes(sys);
    const needed = kg != null ? needOn(specOn(sys), kg, motorKgOf(parsed.name, input.records)) : null;
    const strongOk = needed == null || parsed.nm == null || parsed.nm >= needed;
    const cap = kg != null ? overCapacity(parsed.name, kg) : null, capOk = !cap;
    res.motorCheck = { ok: tubeOk && strongOk && capOk, system: sys, needed, nm: parsed.nm, capKg: cap };
    if (tubeOk) res.system = sys;          // the order's motor decides the tube
    if (!tubeOk) add('error', `${parsed.name} doesn't fit a System ${sys} tube (it goes in System ${parsed.systems.join(' / ')}).`);
    else if (!strongOk) add('error', `${parsed.name} (${parsed.nm} Nm) is too weak: ${kg.toFixed(1)} kg on System ${sys} needs ${needed.toFixed(2)} Nm.`);
    else if (needed != null) add('ok', `${parsed.name} lifts it on System ${sys} (${parsed.nm} Nm, needs ${needed.toFixed(2)} Nm).`);
    else add('ok', `${parsed.name} fits a System ${sys} tube.`);
    if (tubeOk && strongOk && !capOk) add('warning', `${kg.toFixed(1)} kg is over the weight capacity Louvolite gives the ${parsed.name} (${cap} kg), although its torque would do. Confirm the motor.`);
    if (tubeOk && !forced && sys === 55 && fits40) add('info', `${parsed.name} goes in System 55, so the blind is made on System 55.`);
    if (tubeOk && kg != null) {
        const life = res.motorBattery = batteryLife(specOn(sys), parsed.name, parsed.nm, input.records);
        // under six months: what the same range's longer-lasting motor would give on this blind
        res.motorBatteryAlternative = life && life.days < BATTERY.minDays ? biggerBatteryMotor(specOn(sys), kg, parsed.name, life, { records: input.records, minWidthOf: name => tableMinWidth(input.motorTable, name, sys) }) : null;
        const msg = batteryMessage(life, parsed.name, res.motorBatteryAlternative);
        if (msg) add(msg.type, msg.message);
    }
}
const describe = f => [f.brand, f.protocol, f.power === 'wf' ? 'wire-free' : f.power === '220v' ? '220V' : ''].filter(Boolean).join(' ') || 'roller';

// --- comparison (runPostAIValidations) ----------------------------------------------------------------------

// Blind types whose fabric doesn't come off the fabric list's roller rolls: a vertical's louvres, a panel's
// fabric, outdoor blinds (Nov 2025 – Oct 2026: 170 of the comparison's red fabric-width alerts were on these,
// e.g. 119 Outdoor Free Hang lines in Mode / Mode Zero / Dayscreen, made as ordered)
export const notOnRollerRolls = blindType => /vertical|panel|outdoor|zip\s*x|channel\s*x|wire\s*x|free\s*hang/.test(lc(blindType));
// "Roller System 40" / "Element Roller Sys 40" / "System 55" (a dealer's or the converter's wording) -> 40 / 55;
// not double rollers, Vision, kits, the retired Z types or other products.
export function rollerSystemOf(blindType) {
    const t = lc(blindType);
    if (/double|vision|kit|z roller|romashade|skylight|cellular|venetian|allusion|curtain|shutter/.test(t) || notOnRollerRolls(t)) return null;
    const m = t.match(/\bsys(?:tem)?\.?\s*(40|55)\b/) || (/roller/.test(t) && t.match(/\b(40|55)\b/));
    return m ? +m[1] : null;
}
// A line's Blind IQ options as [name, value] pairs, lower case. The comparison's reading sometimes packs several
// options into one ("System = System 40 1.5:1=Yes", "Hardware Colour = Mech Colour=White | Bottom Bar=White
// Aluminium": 132 and 44+ stored lines), so a value holding "k=v" pieces adds those pieces too.
export function optionPairs(item) {
    const out = [];
    for (const sp of (item && item.specifications) || []) {
        const name = lc(sp && sp.specName), value = lc(sp && sp.specComparison && sp.specComparison.blindIQValue);
        out.push([name, value]);
        if (value.includes('=')) for (const piece of value.split('|')) {
            const i = piece.indexOf('=');
            if (i > 0) out.push([piece.slice(0, i).trim(), piece.slice(i + 1).trim()]);
        }
    }
    return out;
}
const yes = v => /^(yes|y|true|1)$/i.test(s(v));
const optYes = (item, re) => optionPairs(item).some(([k, v]) => re.test(k) && yes(v));
const controlsOf = item => lc(s(item && item.control1 && item.control1.blindIQValue) + ' ' + s(item && item.control2 && item.control2.blindIQValue));
// System 40 1.5:1 = Yes (as its own option or packed into another), or the ratio as a value or in a control
export const has15Of = item => optYes(item, /1\.5\s*:\s*1/) || optionPairs(item).some(([, v]) => /^(system\s*40\s*)?1\.5\s*:\s*1$/.test(v))
    || /1\.5\s*:\s*1/.test(controlsOf(item));
// Lift Assisting Spring = Yes, or a spring control ("Lh Chain Spring")
export const hasSpringOf = item => optYes(item, /lift\s*assist|easi[\s-]*lift/) || /spring/.test(controlsOf(item));
// 'SmartRail', 'Plastic' or the Bottom Bar value ("White Aluminium"), for barKg
export const barOf = item => {
    if (optYes(item, /^smart\s*rail$/)) return 'SmartRail';
    if (optYes(item, /^plastic\s*bottom\s*bar$/)) return 'Plastic';
    const bar = optionPairs(item).find(([k, v]) => /^bottom\s*bar(\s*(colour|color|type|material))?$/.test(k) && v);
    return bar ? bar[1] : '';
};
export const outOfWarrantyOf = item => optYes(item, /^out\s*of\s*warranty$/);
// the strongest motor a System 40 tube takes (3 Nm)
const MAX_SYS40_NM = () => Math.max(...MOTORS.filter(m => m.systems.includes(40)).map(m => m.nm));
const ctl = it => lc(s(it.control1 && it.control1.blindIQValue) + ' ' + s(it.control2 && it.control2.blindIQValue));
const motorised = it => /motor|dual/.test(ctl(it));

// Blind IQ's lines: the selling limits, the System 55 weight limit, and which tube the order's roller motors fit.
// Sets item.rollerValidation = { type: 'error' | 'warning' | 'info', message } (the most serious first) and
// returns { checked, errors, warnings }. The chain itself is chainCheck's (index.html section 3b).
// Motors are order-level sundries, so they are only judged when every motorised line on the order is a
// Roller System 40 / 55 blind (a Sonesse 40 can be a double roller's): a System 55-only motor (Sonesse 40, Optuo,
// OT Dual 6Nm, Motion 40) beyond the System 55 blinds, or a System 40-only one (Sonesse 28, Roll Up, One Touch+,
// OT Dual 1.1–3Nm, Motion 25) beyond the System 40 blinds, must be on the wrong tube. Red when every roller
// motor on the order is the wrong kind, amber when the mix leaves it open.
export function validateRollerSystems(data) {
    const out = { checked: 0, errors: 0, warnings: 0 };
    if (!data || !Array.isArray(data.lineItems)) return out;
    const lines = data.lineItems.map(it => ({ it, sys: rollerSystemOf(it && it.blindType && it.blindType.blindIQValue) })).filter(x => x.sys);
    if (!lines.length) return out;
    const notes = new Map();
    const note = (it, type, message) => { if (!notes.has(it)) notes.set(it, []); notes.get(it).push({ type, message }); };

    for (const { it, sys } of lines) {
        out.checked++;
        const w = mmOf(it.width && it.width.blindIQValue), d = mmOf(it.drop && it.drop.blindIQValue);
        const oow = outOfWarrantyOf(it);
        if (w > 0 && d > 0 && !fitsSize(sys, w, d))
            note(it, oow ? 'info' : 'warning', `Roller System: ${w} × ${d} mm is beyond the System ${sys} selling limit (${LIMITS[sys].width} × ${LIMITS[sys].drop} mm)` + (oow ? ', marked Out of Warranty.' : ' — it should be Out of Warranty (ask the factory).'));
        const kg = parseFloat(it.blindWeight);
        if (sys === 55 && kg > LIMITS[55].kg) note(it, 'error', `Roller System: ${kg.toFixed(1)} kg is over System 55's ${LIMITS[55].kg} kg limit — ask the factory.`);
        if (sys === 40 && motorised(it) && kg > 0) {
            // past the strongest System 40 motor only a System 55 motor lifts the blind. The torque is the one
            // validateRollerMotors worked out (lift and friction) when it ran before this, else the simple formula's
            const lifted = it.torqueMethod === 'lift' && parseFloat(it.requiredTorque) > 0;
            const need = lifted ? parseFloat(it.requiredTorque) : torqueNeeded(kg, 40), max = MAX_SYS40_NM();
            if (need > max) note(it, 'warning', `Roller System: ${kg.toFixed(1)} kg needs ${need.toFixed(2)} Nm${lifted ? '' : ' incl. 20 %'} — more than any System 40 motor (${max} Nm): System 55.`);
        }
    }

    const motorLines = (data.lineItems || []).filter(motorised);
    const allRoller = motorLines.length > 0 && motorLines.every(it => rollerSystemOf(it.blindType && it.blindType.blindIQValue));
    if (allRoller) {
        // blinds by their quantity, like the motors (a line of 2 takes 2 motors)
        const qtyOf = it => Math.max(1, parseInt(s(it.qty && it.qty.blindIQValue), 10) || 1);
        const b40 = lines.filter(x => x.sys === 40 && motorised(x.it)), b55 = lines.filter(x => x.sys === 55 && motorised(x.it));
        const n40 = b40.reduce((a, x) => a + qtyOf(x.it), 0), n55 = b55.reduce((a, x) => a + qtyOf(x.it), 0);
        let only40 = 0, only55 = 0, both = 0;
        const names40 = new Set(), names55 = new Set();
        (data.sundries || []).forEach(sd => {
            const m = rollerMotorOf(sd && sd.item && sd.item.blindIQValue);
            if (!m) return;
            const q = Math.max(1, parseInt(sd.quantity, 10) || 1);
            if (m.systems.length === 2) both += q;
            else if (m.systems[0] === 55) { only55 += q; names55.add(m.name); }
            else { only40 += q; names40.add(m.name); }
        });
        if (only55 > n55 && n40) {
            const definitive = only40 + both === 0 && n55 === 0;
            b40.forEach(({ it }) => note(it, definitive ? 'error' : 'warning', definitive
                ? `Roller System: ${[...names55].join(', ')} only fits a System 55 tube, and this blind is System 40 — make it System 55 or order a System 40 motor.`
                : `Roller System: ${only55} System 55-only motor${only55 === 1 ? '' : 's'} (${[...names55].join(', ')}) for ${n55} System 55 blind${n55 === 1 ? '' : 's'} — if this System 40 blind takes one, it must be System 55. Confirm which blinds take which motor.`));
        }
        if (only40 > n40 && n55) {
            const definitive = only55 + both === 0 && n40 === 0;
            b55.forEach(({ it }) => note(it, definitive ? 'error' : 'warning', definitive
                ? `Roller System: ${[...names40].join(', ')} only fits a System 40 tube, and this blind is System 55 — order a System 55 motor (or make it System 40 if the size allows).`
                : `Roller System: ${only40} System 40-only motor${only40 === 1 ? '' : 's'} (${[...names40].join(', ')}) for ${n40} System 40 blind${n40 === 1 ? '' : 's'} — if this System 55 blind takes one, it doesn't fit. Confirm which blinds take which motor.`));
        }
    }

    const rank = { error: 0, warning: 1, info: 2 };
    for (const [it, list] of notes) {
        list.sort((a, b) => rank[a.type] - rank[b.type]);
        it.rollerValidation = { type: list[0].type, message: list.map(x => x.message).join(' ') };
        if (list[0].type === 'error') out.errors++;
        else if (list[0].type === 'warning') out.warnings++;
    }
    return out;
}

// Blind IQ's Roller System 40 / 55 lines: the torque each needs, whether its motor gives it, and how long a battery
// motor's charge lasts (js/roller-motor-calc.js; Russel, 13 Nov 2026).
// Every such line with a fabric weight and a size gets
//   it.requiredTorque   what a motor must give at the heaviest point of travel (Nm, two decimals), it.torqueMethod =
//                       'lift'; the simple formula's "+20 %" figure (requiredTorqueSafety) is removed.
// The motorised ones are then paired with the order's roller motors: the sundries rollerMotorOf reads, else a motor the
// motor table (opts.motorTable, orderbot_motor_properties) lists for Roller System 40 / 55 by its name, which is how the
// table's own check finds older motors ("Roll Up 28 Rts 1.1/28" has no "nm" in its name). One motor per unit of a
// sundry, one slot per unit of a line's quantity. The most demanding blind takes the strongest motor left that is of
// its kind (a One Touch Dual where a System 40 blind is specified Dual) and fits its tube; of equally strong motors
// the mains one goes first, then the bigger battery, so a battery alert means no other sharing-out avoids it. A line
// is judged on the weakest motor that falls to its units:
//   it.torqueValidation   { type: 'error' }: the motor's rated torque is under what the blind needs (to two decimals).
//                         { type: 'warning' } instead where the pairing can't be known: the order has fewer roller
//                         motors than motorised roller blinds (some take the dealer's own), or it also has motorised
//                         double rollers, Vision or other roller types and a stronger motor that may be this blind's.
//                         Also 'warning' when the torque is enough but the blind is over the weight capacity Louvolite
//                         publishes for the motor. On a paired line it replaces the motor table's own torque alert.
//   it.batteryValidation  { type: 'info' | 'warning', message, months, days, basis, motor }: how long one charge lasts
//                         at one up and down a day. 'warning' under six months (an estimate: under four, see the module).
//                         Under six months, flagged or not, it also carries `alternative` { motor, months, days, basis }
//                         when a motor of the same range would last a quarter longer on this blind (biggerBatteryMotor:
//                         the One Touch Dual 3 Nm for a 2 Nm), and the message says what that motor would give.
// A line with no motor to pair (the dealer's own motors, a sundry that isn't read as a roller motor) keeps its torque,
// and whatever the motor table's own check said of it. Double rollers and other roller types aren't worked out: the
// method is for one fabric on one tube.
// opts: { fabrics (fabricList()), records (the makers' own motor records, when the page has them), motorTable }
// -> { checked, paired, torqueErrors, torqueWarnings, capacityWarnings, battery, batteryWarnings, batteryAlternatives }
export function validateRollerMotors(data, { fabrics, records, motorTable } = {}) {
    const out = { checked: 0, paired: 0, torqueErrors: 0, torqueWarnings: 0, capacityWarnings: 0, battery: 0, batteryWarnings: 0, batteryAlternatives: 0 };
    if (!data || !Array.isArray(data.lineItems)) return out;
    const qtyOf = it => Math.min(500, Math.max(1, parseInt(s(it.qty && it.qty.blindIQValue), 10) || 1));
    const blinds = [];
    for (const it of data.lineItems) {
        if (!it) continue;
        // what an earlier pass over the same lines left: the app makes one pass, and a second must not keep the first's
        delete it.batteryValidation; delete it.torqueMethod;
        if (it.torqueValidation && it.torqueValidation.by === 'rollerMotors') delete it.torqueValidation;
        const sys = rollerSystemOf(it.blindType && it.blindType.blindIQValue);
        if (!sys) continue;
        const w = mmOf(it.width && it.width.blindIQValue), d = mmOf(it.drop && it.drop.blindIQValue);
        const fabric = findFabric(fabrics, it.range && it.range.blindIQValue, it.colour && it.colour.blindIQValue);
        if (!fabric || !(fabric.kg > 0) || !(w > 0) || !(d > 0)) continue;
        const spec = { system: sys, widthMm: w, dropMm: d, kgPerM2: fabric.kg, thicknessMm: fabric.thick, barKgPerM: barKg(barOf(it)) };
        const powered = motorised(it);
        const base = liftTorque(spec, powered ? DEFAULTS.motorKg : 0);      // a chain blind has no motor in its tube
        if (!base || base.nm == null) continue;
        out.checked++;
        it.requiredTorque = round2(base.nm).toFixed(2);
        it.torqueMethod = 'lift';
        if (it.blindWeight == null) it.blindWeight = base.kg.toFixed(2);
        delete it.requiredTorqueSafety;
        if (powered) blinds.push({ it, sys, spec, need: base.nm, kg: base.kg, dual: /dual/.test(ctl(it)), qty: qtyOf(it), motor: null });
    }
    if (!blinds.length) return out;

    // a motor the motor table lists for Roller System 40 / 55, by its name inside the sundry (the longest name wins)
    const tableMotorOf = text => {
        const t = lc(text);
        if (!t || NOT_A_ROLLER_MOTOR.test(t)) return null;
        let best = null;
        for (const row of Array.isArray(motorTable) ? motorTable : []) {
            const name = lc(row && row.motorName), sys = rollerSystemOf(row && row.blindType), nm = parseFloat(row && row.torque);
            if (!name || !sys || !(nm > 0) || !t.includes(name)) continue;
            if (!best || name.length > best.key.length) best = { key: name, nm, name: s(row.motorName), systems: [sys] };
            else if (name === best.key && !best.systems.includes(sys)) best.systems.push(sys);
        }
        return best ? { nm: best.nm, systems: best.systems, name: best.name } : null;
    };
    const motors = [];
    for (const sd of data.sundries || []) {
        const text = sd && sd.item && sd.item.blindIQValue;
        const m = rollerMotorOf(text) || tableMotorOf(text);
        if (!m) continue;
        const known = MOTORS.find(x => x.name === m.name);
        const q = Math.min(500, Math.max(1, parseInt(sd.quantity, 10) || 1));
        for (let i = 0; i < q; i++) motors.push({ ...m, otd: /one\s*touch\s*dual/i.test(m.name), wh: chargeWh(m.name, !!known && known.power === '220v') });
    }
    const total = motors.length;
    const mixed = new Set(motors.map(m => m.name)).size > 1;       // more than one kind of motor: the pairing matters
    const strongest = motors.reduce((a, m) => Math.max(a, m.nm), 0);
    // Motors are order-level sundries. When the order also has motorised blinds of other types that take roller motors
    // (a double roller, a Vision, a Romashade), a motor paired here may be theirs: a weak pairing is then a question
    // (amber), not a verdict, unless no motor on the order is strong enough (BDO673291: six 1.1 Nm motors for two
    // double rollers and two Roller System 40 blinds that need more). Outdoor blinds, curtains and venetians have
    // motors of their own, which aren't read here.
    const OWN_MOTORS = /outdoor|zip\s*x|channel\s*x|wire\s*x|free\s*hang|curtain|venetian|cellular|vertical|allusion|shutter/;
    const shared = data.lineItems.some(it => { const t = lc(it && it.blindType && it.blindType.blindIQValue); return it && motorised(it) && !rollerSystemOf(t) && !OWN_MOTORS.test(t); });
    // one slot per blind, the most demanding first
    const slots = [];
    for (const b of blinds) for (let i = 0; i < b.qty; i++) slots.push(b);
    slots.sort((a, b) => b.need - a.need);
    // With fewer motors than blinds some blinds take the dealer's own, and which ones isn't known: a question too.
    const enough = total >= slots.length;
    const better = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
    for (const b of slots) {
        if (!motors.length) break;
        let pick = 0, best = null;
        motors.forEach((m, i) => {
            const key = [b.sys === 40 ? +(m.otd === b.dual) : 1, +m.systems.includes(b.sys), m.nm, m.wh];
            if (!best || better(key, best)) { pick = i; best = key; }
        });
        const m = motors.splice(pick, 1)[0];
        if (!b.motor || m.nm < b.motor.nm) b.motor = m;
    }

    for (const b of blinds) {
        const m = b.motor;
        if (!m) continue;
        out.paired++;
        const t = liftTorque(b.spec, motorKgOf(m.name, records));
        const need = round2(t && t.nm != null ? t.nm : b.need);
        b.it.requiredTorque = need.toFixed(2);
        delete b.it.torqueValidation;                 // the motor table's weight × radius + 20 % verdict gives way to this one
        const cap = overCapacity(m.name, b.kg), maker = (MOTOR_DATA[m.name] && MOTOR_DATA[m.name].maker) || 'the maker';
        if (m.nm < need) {
            const none = strongest < need, sure = enough && (none || !shared);
            const why = !enough ? ` The order has ${total} roller motor${total === 1 ? '' : 's'} for ${slots.length} motorised roller blinds, so confirm which blinds take which motor.`
                : none ? (mixed ? ' No motor on the order is strong enough.' : '')
                    : shared ? ' The order also has motorised blinds of other types, so confirm which blinds take which motor.'
                        : mixed ? ' The order\'s motors are paired with its blinds strongest first, each on a tube it fits and a One Touch Dual where the blind is specified Dual.' : '';
            b.it.torqueValidation = { type: sure ? 'error' : 'warning', by: 'rollerMotors', message: `Torque Alert: this blind needs ${need.toFixed(2)} Nm at its heaviest point (${b.kg.toFixed(2)} kg on a System ${b.sys} tube, with the fabric rolled on it and the bearing friction) and the ${m.name} gives ${m.nm} Nm.` + why };
            if (sure) out.torqueErrors++; else out.torqueWarnings++;
        } else if (cap) {
            b.it.torqueValidation = { type: 'warning', by: 'rollerMotors', message: `Motor Alert: ${b.kg.toFixed(2)} kg is over the weight capacity ${maker} gives the ${m.name} (${cap} kg), although its ${m.nm} Nm covers the ${need.toFixed(2)} Nm this blind needs. Confirm the motor.` };
            out.capacityWarnings++;
        }
        const life = batteryLife(b.spec, m.name, m.nm, records);
        // under six months, flagged or not: what the same range's longer-lasting motor would give on this blind
        const alt = life && life.days < BATTERY.minDays ? biggerBatteryMotor(b.spec, b.kg, m.name, life, { records, minWidthOf: name => tableMinWidth(motorTable, name, b.sys) }) : null;
        const msg = batteryMessage(life, m.name, alt);
        if (msg) {
            b.it.batteryValidation = { ...msg, days: Math.round(life.days), basis: life.basis, motor: m.name };
            if (alt) {
                b.it.batteryValidation.alternative = { motor: alt.motor, months: monthsText(alt.days), days: Math.round(alt.days), basis: alt.basis };
                out.batteryAlternatives++;
            }
            out.battery++;
            if (msg.type === 'warning') out.batteryWarnings++;
        }
    }
    return out;
}
