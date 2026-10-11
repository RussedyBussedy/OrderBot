// Deterministic checks on the comparison AI's result (index.html → runComparisonPipeline), Oct 2026.
// Pure functions: no DOM, no Firestore, so they can be tested in node.
//
// Why: across the 16,500 orders compared from July 2025 to October 2026 about 1 flag in 90 led to a change
// on the order. The capturers learnt to skim the flags, and real mistakes that were flagged were passed over
// (about 20 of the admin errors on compared orders). Most of the noise is formatting the AI reports as a
// difference: Blind IQ's 5 mm size steps, its shortened print of long names, colour codes, a quantity the
// customer leaves blank, and the pin that comes with a stated chain side.
//
// 1. applyDeterministicChecks(data)
//    Turns a MISMATCH or OMISSION that is only formatting into MATCH. The AI's own result stays in `aiResult`
//    and the rule in `autoMatched`, so the report and the history show what was matched and why.
// 2. reconcileSecondReading(data, reading)
//    `reading` is a second, customer-only reading of the customer document (no Blind IQ document in view).
//    Most missed mistakes were customer values reported as exactly what Blind IQ shows ("read as Blind IQ").
//    Where the comparison did that and the second reading clearly says otherwise, the field becomes a
//    MISMATCH that carries both readings (`secondReading`).
// 3. needsSecondReading(files, pdfjs)
//    The second reading is only made for handwritten or unclear orders: a photo, a scanned PDF (also one with
//    an OCR layer) or handwriting drawn onto a PDF. Typed documents are read once.
// 4. applyExactReading(data, readings)
//    A BlindIQ Online order is in Blind IQ's own names: its values replace the AI's reading of the customer side.

import { CRITICAL_FIELDS } from './constants.js';

const s = v => (v == null ? '' : String(v)).trim();
const EMPTY_RE = /^(|-|–|n\/?a|none|nil|blank|not specified|not stated|not found|not given|unspecified|\?)$/i;
export const isEmptyValue = v => EMPTY_RE.test(s(v));
const FLAG = new Set(['MISMATCH', 'OMISSION']);
// a critical field the AI calls NOT_SPECIFIED becomes an OMISSION (applyConfidenceThresholds), so it counts as a flag here
const isFlag = (f, r) => FLAG.has(r) || (r === 'NOT_SPECIFIED' && CRITICAL_FIELDS.includes(f));

// ---------------------------------------------------------------- names
// Lower case, without punctuation, Blind IQ's roll-width suffix ("2050mm"), its marker symbols (@ # ^),
// "Fr" (fire retardant) and "/ Aventus 5%". Dots and apostrophes are dropped ("M.B.R" = "MBR").
export function normName(v) {
    return s(v).toLowerCase()
        .replace(/[.'’`]/g, '')
        .replace(/\/\s*aventus.*$/, ' ')
        .replace(/\b\d{3,4}\s*mm\b/g, ' ')
        .replace(/[@#^*]+/g, ' ')
        .replace(/[,:;"()[\]{}\-_/\\|+]/g, ' ')
        .replace(/\bfr\b\s*$/, ' ')
        .replace(/\s+/g, ' ').trim();
}
// colours also drop a code before or after the name ("129 White", "Argent Copper 2050")
export const normColour = v => normName(v).replace(/^\d{2,5}\s+/, '').replace(/\s+\d{2,5}$/, '').trim();
// locations also drop the customer's own numbering ("1. Window 1" = "Window 1")
export const normLocation = v => normName(s(v).replace(/^\s*\d{1,3}\s*[.)]\s+/, ''));

// fixes keep their sizes: "Ext Reveal 130mm" is not "Ext Reveal", "Gasket 18 mm" is "Gasket 18mm"
export const normFix = v => s(v).toLowerCase()
    .replace(/[.'’`]/g, '')
    .replace(/[@#^*]+/g, ' ')
    .replace(/[,:;"()[\]{}\-_/\\|+]/g, ' ')
    .replace(/(\d)\s+mm\b/g, '$1mm')
    .replace(/\s+/g, ' ').trim();

const NORM = { location: normLocation, colour: normColour, range: normName, blindType: normName, fix: normFix };

// Blind IQ prints long names shortened ("Chef's Kitchen :" for "Chef's Kitchen : Window 1A",
// "Collina Champagne" for "Collina Champagne Fizz 2050mm @"). The shorter must be a long prefix.
// A fix is cut inside a word ("Gasket 18m", "Universal Fra"): "Ext Face 80mm" is a fix of its own, not a shortened
// "Ext Face 80mm (Waterfall)".
const PREFIX_MIN = { location: 8, colour: 12, range: 12, fix: 9 };
const MID_WORD_CUT = { fix: true };
function isPrintedPrefix(a, b, min, midWord) {
    if (!a || !b || a === b) return false;
    const [short, long] = a.length < b.length ? [a, b] : [b, a];
    if (midWord && long.charAt(short.length) === ' ') return false;
    return short.length >= min && long.startsWith(short);
}

// ---------------------------------------------------------------- sizes
export function parseMm(v) {
    const m = s(v).replace(/\s+/g, '').match(/^(\d{1,5})(?:[.,]0+)?(?:mm)?$/i);
    return m ? parseInt(m[1], 10) : NaN;
}
// Products Blind Designs makes to the millimetre (BD_STANDARDS): every difference counts there.
const MADE_TO_MM = /shutter|perfect\s*fit|outdoor|zip\s*x|channel\s*x|wire\s*x|free\s*hang|widescreen|skylight|velux/i;
export const roundsTo5mm = blindType => !MADE_TO_MM.test(s(blindType));
const isFiveMmStep = (c, b) => Math.abs(c - b) <= 2 && b % 5 === 0 && 5 * Math.round(c / 5) === b;
const NO_DROP = /valance|pelmet|track|extrusion|cassette/i;
const MIN_STEP_MM = 300;   // below this a 1–2 mm difference can be a dropped digit (259 for 2590, BDO643589)

// ---------------------------------------------------------------- controls
// One control (or a customer's "R", "Lh chain + Rh intermediate") → its side and kind.
// "Dual" is the One Touch Dual motor, a different spec from "Motor" (Paul's One Touch Dual rule); "Double Chain"
// belongs to double rollers.
const DRIVE = new Set(['chain', 'doublechain', 'motor', 'dual', 'crank', 'spring', 'wand', 'cord']);
const IDLE = new Set(['pin', 'intermediate', 'coupled', 'none']);
function kindOf(t) {
    if (/\bdouble\s*(chain|chai)\b/.test(t)) return 'doublechain';
    if (/\bdual\b/.test(t)) return 'dual';
    if (/\b(chain|chai|ch|steel\s*ball|ball\s*chain)\b/.test(t)) return 'chain';
    if (/\b(motor|motori[sz]ed|motorized|somfy|one\s*touch|battery|rechargeable)\b/.test(t)) return 'motor';
    if (/\bcrank\b/.test(t)) return 'crank';
    if (/\bspring\b/.test(t)) return 'spring';
    if (/\bwand\b/.test(t)) return 'wand';
    if (/\bcord\b/.test(t)) return 'cord';
    if (/\b(intermediate|inter)\b/.test(t)) return 'intermediate';
    if (/\b(coupled|coupling|couple)\b/.test(t)) return 'coupled';
    if (/\b(pin|idle|free\s*end)\b/.test(t)) return 'pin';
    if (/^\s*(none|n\/a|-)\s*$/.test(t)) return 'none';
    return null;
}
function sideOf(t) {
    const l = /\b(lh|left|l|lc)\b/.test(t), r = /\b(rh|right|r|rc)\b/.test(t);
    return l && !r ? 'L' : r && !l ? 'R' : null;
}
export function parseControlPart(v) {
    const t = s(v).toLowerCase().replace(/[.]/g, '');
    return { side: sideOf(t), kind: kindOf(t), text: t };
}
// The customer's statement over both control cells: the drive side and kind, the idle-side kind.
export function parseCustomerControls(c1, c2) {
    const parts = [s(c1), s(c2)].join(' + ').split(/\s*(?:\+|,|;|&|\band\b|\/)\s*/i).map(parseControlPart).filter(p => p.side || p.kind);
    if (!parts.length) return null;
    const drives = parts.filter(p => DRIVE.has(p.kind));
    const bare = parts.filter(p => p.side && !p.kind);           // "R", "Right": the control side
    const idles = parts.filter(p => IDLE.has(p.kind) && p.kind !== 'none');
    let side = null, kind = null;
    if (drives.length) {
        const sides = new Set(drives.map(p => p.side).filter(Boolean));
        if (sides.size > 1) return null;
        side = [...sides][0] || (bare.length === 1 ? bare[0].side : null);
        kind = drives[0].kind;
    } else if (bare.length) {
        const sides = new Set(bare.map(p => p.side));
        if (sides.size > 1) return null;
        side = bare[0].side;
    }
    return { side, kind, idle: idles.length ? idles[0].kind : null };
}

const isVenetianControl = (b1, b2) => /^(left|right)$/i.test(s(b1)) && /^(grouped|split)$/i.test(s(b2));
// the roller rule is for roller-type blinds: venetians, verticals and shutters have other controls, and double
// rollers a double chain (BDO662998: Retro venetians captured with roller controls; BDO662216: a double roller
// with a single chain)
const NOT_ROLLER = /venetian|retro|wood|aluminium|vertical|shutter|double|curtain|track/i;

// ---------------------------------------------------------------- "as per quote"
// A customer order that only accepts this order's own quote ("Please go ahead as per quote number BDO669711",
// "1x Element Double Roller Blind as per attached quote BDO659288") and gives no sizes has nothing to compare
// line by line: every Blind IQ field came back as an OMISSION (14 critical flags on a two-blind order). They
// become NOTE, and data.quoteAccepted names the quote. A quote for another order, or any size on the customer's
// lines, leaves the comparison as it is.
const LINE_FIELDS = ['item', 'location', 'qty', 'width', 'drop', 'colour', 'blindType', 'range', 'fix', 'control1', 'control2'];
function acceptsOwnQuote(data, changes) {
    const bdo = (s(data.bdoOrderNumber).match(/\d{6,}/) || [])[0];
    const lines = data.lineItems;
    if (!bdo || !lines.length) return false;
    const texts = [s(data.specialInstructions && data.specialInstructions.customerValue)];
    lines.forEach(li => LINE_FIELDS.forEach(f => texts.push(s(li[f] && li[f].customerValue))));
    const refers = texts.some(t => /\bquot(e|ation)\b/i.test(t) && t.replace(/\D+/g, ' ').trim().split(' ').includes(bdo));
    const noSizes = lines.every(li => isEmptyValue(li.width && li.width.customerValue) && isEmptyValue(li.drop && li.drop.customerValue));
    if (!refers || !noSizes) return false;
    const reason = 'the customer accepted quote BDO' + bdo + ' without listing the blinds';
    const toNote = (x, where) => { if (!x || !(FLAG.has(x.result) || x.result === 'NOT_SPECIFIED')) return; x.aiResult = x.result; x.result = 'NOTE'; x.autoMatched = reason; changes.push({ ...where, from: x.aiResult, reason }); };
    lines.forEach((li, idx) => {
        const id = s(li.item && (li.item.blindIQValue || li.item.customerValue)) || String(idx + 1);
        LINE_FIELDS.forEach(f => toNote(li[f], { item: id, field: f }));
        (li.specifications || []).forEach(sp => toNote(sp && sp.specComparison, { item: id, field: 'spec:' + s(sp && sp.specName) }));
    });
    data.quoteAccepted = 'BDO' + bdo;
    return true;
}

// ---------------------------------------------------------------- 1. deterministic checks
function autoMatch(field, reason, changes, where, result = 'MATCH') {
    field.aiResult = field.result;
    field.result = result;
    field.autoMatched = reason;
    changes.push({ ...where, from: field.aiResult, reason });
}
// the same for a value the rule cannot call the same, only explain: the field becomes a NOTE
const autoNote = (field, reason, changes, where) => autoMatch(field, reason, changes, where, 'NOTE');

// A rule that knows the customer's value is a mistake in Blind IQ (the opposite of autoMatch): the field becomes a
// MISMATCH with the rule in `ruleFlag`, the AI's own result and reading kept.
function ruleFlag(field, customerText, reason, flags, where) {
    if (field.aiResult === undefined) field.aiResult = field.result;
    if (customerText && !s(field.customerValue).toLowerCase().includes(s(customerText).toLowerCase())) {
        if (field.aiCustomerValue === undefined) field.aiCustomerValue = s(field.customerValue);
        field.customerValue = s(customerText);
    }
    field.result = 'MISMATCH';
    field.ruleFlag = reason;
    flags.push({ ...where, from: field.aiResult, reason });
}

// ---------------------------------------------------------------- Perfect Fit (Russel, Oct 2026)
// A Perfect Fit blind sits in its own frame, clipped into the window's beading on brackets ("clips", "gaskets")
// sized to the bead depth. Blind IQ's fix is the Gasket of that size: 12 mm is "Gasket 12mm (18mm+foam)" (printed
// "Gasket 12m"), then 18, 20, 22, 24, 30 and 38 mm, with Remove Universal Frame=Yes (every gasket line since June
// 2026). The Universal Frame, a secondary frame with a 24 mm clip inside, is never the customer's option: with a clip
// or gasket size on the order it is a mistake (BDO643569 "Perfect fit frame with 25mm clips" was made on a Universal
// Frame and remade free on Gasket 24mm; BDO635086, BDO637782 and BDO645474 were re-ordered on 18, 38 and 30 mm
// gaskets). A blind fitted to the reveal or face does not clip into the window: it goes on the Universal Frame.
const PERFECT_FIT = /perfect\s*fit/i;
export const PF_GASKETS = [12, 18, 20, 22, 24, 30, 38];
// an option about the clips: "Clips=25mm clips", "Fix PF Only=18mm", "Frame depth: 15mm" (the bead depth)
const CLIP_WORDS = /clip|gask|gass|bracket|bead|depth|\bfix\b/i;
const NOT_THIS_LINE = /additional|extra|spare/i;   // "Need additional 20mm gaskets as well" (BDO649643)
export function clipSizeOf(t) {
    const v = s(t);
    if (/\b18\s*(mm)?\s*(\+|plus|with|&|and)\s*foam/i.test(v)) return 12;   // the 18 mm bracket and foam is Gasket 12mm
    const m = v.match(/(?:^|[^\d])(\d{2})\s*(?:mm)?(?![\d])/i);
    const n = m ? +m[1] : NaN;
    return n >= 10 && n <= 45 ? n : null;
}
// The clip size on the customer's line: a size in its fix, or in an option about clips, gaskets or the bead depth
export function customerClipSize(item) {
    const fix = s(item && item.fix && item.fix.customerValue);
    if (fix && !isEmptyValue(fix) && clipSizeOf(fix) != null) return { size: clipSizeOf(fix), text: fix };
    for (const sp of (item && item.specifications) || []) {
        const c = s(sp && sp.specComparison && sp.specComparison.customerValue);
        if (!c || isEmptyValue(c) || NOT_THIS_LINE.test(c) || !CLIP_WORDS.test(s(sp.specName) + ' ' + c)) continue;
        if (clipSizeOf(c) != null) return { size: clipSizeOf(c), text: c };
    }
    return null;
}
export const gasketOf = v => { const m = s(v).match(/^gasket\s*(\d{2})/i); return m ? +m[1] : null; };
// Louvolite's Perfect Fit beading depth chart (Sales Resource, Product Installation Instructions): a bracket of N mm
// covers a bead of N - 2 to N + 1 mm with foam and goal packing, and the 18 mm bracket with foam (Blind IQ's
// "Gasket 12mm (18mm+foam)") covers 12 to 15 mm. A bead depth Blind IQ has no Gasket for, inside the span of the
// Gasket on the order, is a NOTE (BDO650118 "Frame depth: 15mm" on Gasket 12mm; BDO643569's 25 mm remade on 24 mm).
export function chartFit(gasket, bead) {
    if (gasket == null || bead == null || PF_GASKETS.includes(bead)) return '';
    if (gasket === 12) return bead >= 12 && bead <= 15 ? 'the 18 mm bracket with foam (Gasket 12mm (18mm+foam))' : '';
    if (gasket === 38) return '';                                     // not on the chart
    return bead >= gasket - 2 && bead <= gasket + 1 ? `the ${gasket} mm bracket with foam and goal packing` : '';
}
const FACE_OR_REVEAL = /^(f|f\s*f|f\s*fix|face(\s*fix(ed)?)?|r|r\s*fix|reveal(\s*fix(ed)?)?|recess(\s*fit(ted)?)?|inside\s*reveal|i\s*r)$/;
// the customer's word for Remove Universal Frame=Yes: "No universal Frame", "Please do not send Universal Frame",
// "Remove PF universal", "NO FRAME"; a bare "No" depends on the customer's column and is left to the AI
const NO_UNIVERSAL = /\b(no|without|remove[sd]?|do\s*n[o']?t\s*(send|supply|need|want|fit)|excl\w*)\b[^.]*\b(universal|frame|frome)/i;
const isRemoveUf = (name, biq) => /remove\s*universa/i.test(name + ' ' + biq);
const ufYes = v => /(^|=)\s*yes\s*$/i.test(s(v)) || /^remove\s*universa\S*\s*frame$/i.test(s(v));

function perfectFitChecks(item, id, changes, flags) {
    const bt = s(item.blindType && item.blindType.blindIQValue);
    if (!PERFECT_FIT.test(bt) || !item.fix) return;
    const where = f => ({ item: id, field: f });
    const flagged = x => x && isFlag('fix', x.result);
    const fx = item.fix, clip = customerClipSize(item), b = s(fx.blindIQValue), g = gasketOf(b), uf = /^universal\s*fr/i.test(b);
    if (clip && g != null && clip.size === g) {
        if (flagged(fx)) autoMatch(fx, 'the same gasket size (Perfect Fit)', changes, where('fix'));
    } else if (clip && g != null && chartFit(g, clip.size)) {
        if (flagged(fx)) autoNote(fx, `a ${clip.size} mm bead takes ${chartFit(g, clip.size)} on Louvolite's beading depth chart: confirm the bracket`, changes, where('fix'));
    } else if (clip && g != null && PF_GASKETS.includes(clip.size) && fx.result !== 'MISMATCH') {
        ruleFlag(fx, clip.text, `the customer's ${clip.size} mm gasket is Blind IQ's Gasket ${clip.size === 12 ? '12mm (18mm+foam)' : clip.size + 'mm'}`, flags, where('fix'));
    } else if (clip && uf && !/universal/i.test(clip.text) && fx.result !== 'MISMATCH') {
        ruleFlag(fx, clip.text, 'a clip or gasket size on a Perfect Fit order is the Gasket fix of that size; the Universal Frame is not a customer option', flags, where('fix'));
    } else if (!clip && uf && flagged(fx) && FACE_OR_REVEAL.test(normFix(fx.customerValue))) {
        autoNote(fx, 'a Perfect Fit blind fitted to the reveal or face goes on the Universal Frame', changes, where('fix'));
    }
    // options: Remove Universal Frame with a Gasket fix, and the clip size given as an option ("Fix PF Only=18mm")
    (item.specifications || []).forEach(sp => {
        const x = sp && sp.specComparison;
        if (!x || !FLAG.has(x.result)) return;
        const name = s(sp.specName), c = s(x.customerValue), bv = s(x.blindIQValue), at = { item: id, field: 'spec:' + name };
        if (isRemoveUf(name, bv)) {
            if (!ufYes(bv)) return;
            if (g != null && isEmptyValue(c)) autoMatch(x, 'goes with the Gasket fix (Perfect Fit: no Universal Frame)', changes, at);
            else if (NO_UNIVERSAL.test(c)) autoMatch(x, 'same meaning (no Universal Frame)', changes, at);
        } else if (gasketOf(bv) != null && clipSizeOf(c) === gasketOf(bv)) {
            autoMatch(x, 'the same gasket size (Perfect Fit)', changes, at);
        }
    });
}

// opts.catalogue (optional): { liveRanges(blindType), rangesForColour(blindType, colour) } from the converter's
// catalogue (BiqUI.biqComparisonCatalogue); without it the range rule is skipped.
// Returns { data, changes (rule matches), flags (rule mismatches) }.
export function applyDeterministicChecks(data, opts = {}) {
    const changes = [], flags = [];
    const cat = opts && opts.catalogue;
    if (!data || !Array.isArray(data.lineItems)) return { data, changes, flags };
    if (acceptsOwnQuote(data, changes)) return { data, changes, flags };
    data.lineItems.forEach((item, idx) => {
        const id = s(item.item && (item.item.blindIQValue || item.item.customerValue)) || String(idx + 1);
        const bt = s(item.blindType && item.blindType.blindIQValue);
        const flagged = f => item[f] && isFlag(f, item[f].result);
        const where = f => ({ item: id, field: f });

        // same value, or Blind IQ's shortened print of it
        for (const f of ['location', 'colour', 'range', 'blindType', 'fix']) {
            if (!flagged(f)) continue;
            if (isEmptyValue(item[f].customerValue) || isEmptyValue(item[f].blindIQValue)) continue;   // "Not Specified" twice is a missing value
            const c = NORM[f](item[f].customerValue), b = NORM[f](item[f].blindIQValue);
            if (!c || !b) continue;
            if (c === b) autoMatch(item[f], f === 'colour' && normName(item[f].customerValue) !== normName(item[f].blindIQValue) ? 'same colour (colour code)' : 'same value', changes, where(f));
            else if (PREFIX_MIN[f] && isPrintedPrefix(c, b, PREFIX_MIN[f], MID_WORD_CUT[f])) autoMatch(item[f], 'Blind IQ prints the name shortened', changes, where(f));
        }

        // range not given, and the only live range that fits: the blind type has one, or one sells the colour the
        // customer gave ("Snow" on a Wood Venetian is Classic) — the converter's own range-from-colour rule
        if (cat && flagged('range') && isEmptyValue(item.range.customerValue) && !isEmptyValue(item.range.blindIQValue)) {
            const br = normName(item.range.blindIQValue);
            const same = n => { const x = normName(n); return x === br || (br.length >= 12 && x.startsWith(br)); };   // Blind IQ prints long ranges shortened
            const byType = cat.liveRanges(bt);
            const col = item.colour, colourGiven = col && !isEmptyValue(col.customerValue) && (col.result === 'MATCH' || normColour(col.customerValue) === normColour(col.blindIQValue));
            const byColour = colourGiven ? cat.rangesForColour(bt, col.blindIQValue) : null;
            if (byType && byType.length === 1 && same(byType[0])) autoMatch(item.range, 'the only range of this blind type', changes, where('range'));
            else if (byColour && byColour.length === 1 && same(byColour[0])) autoMatch(item.range, 'the only range with this colour', changes, where('range'));
        }

        // quantity: not given on the customer's line, Blind IQ 1
        if (flagged('qty')) {
            const c = s(item.qty.customerValue), b = parseFloat(s(item.qty.blindIQValue));
            if (isEmptyValue(c) && b === 1) autoMatch(item.qty, 'one blind per line (QTY not given)', changes, where('qty'));
            else if (parseFloat(c) === b && !isNaN(b)) autoMatch(item.qty, 'same value', changes, where('qty'));
        }

        // sizes: the same number, Blind IQ's 5 mm step, a valance's drop of 0
        for (const f of ['width', 'drop']) {
            if (!flagged(f)) continue;
            const c = parseMm(item[f].customerValue), b = parseMm(item[f].blindIQValue);
            if (f === 'drop' && b === 0 && isEmptyValue(item[f].customerValue) && NO_DROP.test(bt)) { autoMatch(item[f], 'valances and tracks have no drop', changes, where(f)); continue; }
            if (isNaN(c) || isNaN(b)) continue;
            if (c === b) autoMatch(item[f], 'same value', changes, where(f));
            else if (roundsTo5mm(bt) && b >= MIN_STEP_MM && isFiveMmStep(c, b)) autoMatch(item[f], 'Blind IQ\'s 5 mm size step', changes, where(f));
        }

        // controls
        if (item.control1 && item.control2 && (flagged('control1') || flagged('control2'))) {
            const b1 = s(item.control1.blindIQValue), b2 = s(item.control2.blindIQValue);
            const cust = parseCustomerControls(item.control1.customerValue, item.control2.customerValue);
            if (isVenetianControl(b1, b2)) {
                // venetians: control side in Control 1, Grouped/Split in Control 2 (Blind Designs standard by width)
                const side = cust && (!cust.kind || cust.kind === 'cord' || cust.kind === 'wand') ? cust.side : null;
                if (flagged('control1') && side && side === (/^left$/i.test(b1) ? 'L' : 'R')) autoMatch(item.control1, 'same control side', changes, where('control1'));
                if (flagged('control2')) {
                    const c2 = s(item.control2.customerValue).toLowerCase();
                    const w = parseMm(item.width && item.width.blindIQValue);
                    const std = /35\s*mm/i.test(bt) ? 'grouped' : (isNaN(w) ? null : (w < 600 ? 'split' : 'grouped'));
                    if (c2 && c2 === b2.toLowerCase()) autoMatch(item.control2, 'same value', changes, where('control2'));
                    else if (!/grouped|split/.test(c2) && std && std === b2.toLowerCase()) autoMatch(item.control2, 'Blind Designs standard (Grouped from 600 mm wide, Split under)', changes, where('control2'));
                }
            } else if (cust && cust.side && !NOT_ROLLER.test(bt)) {
                // rollers and the like: one driven side (chain, motor, crank, spring), a pin/intermediate/coupled on the other
                const p1 = parseControlPart(b1), p2 = parseControlPart(b2);
                const drives = [p1, p2].filter(p => DRIVE.has(p.kind));
                // Blind IQ keeps the left side in Control 1 and the right side in Control 2 ("Rh Pin" in Control 1 was
                // corrected later on BDO660982 and BDO663690), so a reversed pair is left to the AI
                const columnsOk = p1.side !== 'R' && p2.side !== 'L';
                if (drives.length === 1 && drives[0].side && columnsOk) {
                    const drive = drives[0], other = drive === p1 ? p2 : p1;
                    // the other side must carry a pin, or the intermediate / coupled bracket the customer asked for:
                    // a blank or "None" there is a missing control (BDO649201), and an intermediate or coupled
                    // bracket the customer did not mention is left to the AI (pins changed to intermediates later)
                    const otherOk = other.kind === 'pin' || ((other.kind === 'intermediate' || other.kind === 'coupled') && cust.idle === other.kind);
                    // a chain is the usual control; a motor, crank or spring is matched only when the customer says so
                    // (BDO660854: "R" against Rh Motor, changed to a chain afterwards)
                    const kindOk = cust.kind ? cust.kind === drive.kind : drive.kind === 'chain';
                    const idleOk = !cust.idle || cust.idle === other.kind;
                    if (otherOk && kindOk && idleOk && cust.side === drive.side) {
                        const reason = other.kind === 'pin' ? 'same control side (the pin comes with the chain side)' : 'same control side';
                        if (flagged('control1')) autoMatch(item.control1, reason, changes, where('control1'));
                        if (flagged('control2')) autoMatch(item.control2, reason, changes, where('control2'));
                    }
                }
            }
        }

        // Perfect Fit: the gasket size in other words ("12mm White", "18 mm Gasket" against "Gasket 12m"), a bead depth
        // on Louvolite's chart, a clip or gasket size against Blind IQ's Universal Frame, Remove Universal Frame
        perfectFitChecks(item, id, changes, flags);

        // specifications: the same value once formatting is ignored
        (item.specifications || []).forEach(sp => {
            const x = sp && sp.specComparison;
            if (!x || !FLAG.has(x.result)) return;
            const c = normName(x.customerValue), b = normName(x.blindIQValue);
            if (c && b && c === b) autoMatch(x, 'same value', changes, { item: id, field: 'spec:' + s(sp.specName) });
        });
    });
    return { data, changes, flags };
}

// ---------------------------------------------------------------- 2. second reading
const num = v => { const n = parseMm(v); return isNaN(n) ? NaN : n; };
const words = v => new Set(normColour(v).split(' ').filter(w => w.length >= 3));
function locSim(a, b) {
    const A = new Set(normLocation(a).split(' ').filter(Boolean)), B = new Set(normLocation(b).split(' ').filter(Boolean));
    if (!A.size || !B.size) return 0;
    let n = 0; A.forEach(w => { if (B.has(w)) n++; });
    return n / Math.max(A.size, B.size);
}
const conf = (r, k) => { const v = r && r[k + 'Confidence']; return typeof v === 'number' ? v : 0.7; };
const sameNum = (a, b, tol = 5) => !isNaN(a) && !isNaN(b) && Math.abs(a - b) <= tol;
const isValanceLine = it => NO_DROP.test(s(it.blindType && it.blindType.blindIQValue));
const isValanceReading = r => /valance|pelmet|cassette|track|fascia/i.test(s(r.product) + ' ' + s(r.range));

// Pair the reading's lines with the comparison's lines: by size (either reading), location and order.
export function pairReadingLines(lineItems, lines) {
    const L = lineItems.map((it, i) => ({ i, it, bw: num(it.width && it.width.blindIQValue), bd: num(it.drop && it.drop.blindIQValue),
        cw: num(it.width && it.width.customerValue), cd: num(it.drop && it.drop.customerValue), val: isValanceLine(it),
        loc: s(it.location && (it.location.blindIQValue || it.location.customerValue)) }))
        .filter(x => s(x.it.item && x.it.item.blindIQValue) && !isNaN(x.bw));
    const R = lines.map((r, j) => ({ j, r, w: num(r.width), d: num(r.drop), val: isValanceReading(r) })).filter(x => !isNaN(x.w) || !isNaN(x.d));
    const cand = [];
    L.forEach((l, li) => R.forEach((r, ri) => {
        if (l.val !== r.val && !(l.val && isNaN(r.d))) return;
        let sc = 0;
        const wOk = sameNum(r.w, l.bw) || sameNum(r.w, l.cw), dOk = l.val ? true : (sameNum(r.d, l.bd) || sameNum(r.d, l.cd));
        const swap = !l.val && sameNum(r.w, l.bd) && sameNum(r.d, l.bw) && r.w !== r.d;
        if (wOk) sc += 3; if (dOk) sc += 3; if (swap) sc += 4;
        sc += 2 * locSim(r.r.location, l.loc);
        sc -= 4 * Math.abs(li / Math.max(1, L.length - 1) - ri / Math.max(1, R.length - 1));
        if (sc > 0.5) cand.push({ li, ri, sc, wOk, dOk, swap });
    }));
    cand.sort((a, b) => b.sc - a.sc);
    const usedL = new Set(), usedR = new Set(), pairs = [];
    for (const c of cand) { if (usedL.has(c.li) || usedR.has(c.ri)) continue; usedL.add(c.li); usedR.add(c.ri); pairs.push({ l: L[c.li], r: R[c.ri], ...c }); }
    return pairs;
}

function secondReadingFlag(field, value, confidence, changes, where, why) {
    const first = s(field.customerValue);
    field.aiResult = field.result;
    field.secondReading = { value: s(value), confidence, firstReading: first, why };
    field.customerValue = s(value);
    field.result = 'MISMATCH';
    field.confidence = Math.min(typeof field.confidence === 'number' ? field.confidence : 1, confidence);
    changes.push({ ...where, from: field.aiResult, firstReading: first, secondReading: s(value), why });
}

// A line whose text fields run long or over several lines is a garbled answer (the model once wrote the whole
// table into one line's "range"): it is left out, and a reading that is mostly garbled is not used at all.
const TEXT_KEYS = ['ref', 'location', 'qty', 'width', 'drop', 'product', 'range', 'colour', 'control', 'fix'];
export const isCleanReadingLine = l => !!l && typeof l === 'object' && TEXT_KEYS.every(k => { const v = l[k]; return v == null || (String(v).length <= 80 && !/[\r\n]/.test(String(v))); });

export function reconcileSecondReading(data, reading, opts = {}) {
    const changes = [];
    const minConf = opts.minConfidence ?? 0.8;
    const all = (reading && Array.isArray(reading.lines)) ? reading.lines : [];
    const lines = all.filter(isCleanReadingLine);
    if (all.length && lines.length < 0.7 * all.length) return { data, changes, skipped: 'garbled reading' };
    if (!data || !Array.isArray(data.lineItems) || !lines.length) return { data, changes };
    // only where the comparison reported the customer value as exactly Blind IQ's (MATCH or NOTE)
    const anchored = (f, eq) => f && (f.result === 'MATCH' || f.result === 'NOTE') && eq(f.customerValue, f.blindIQValue);
    const numEq = (a, b) => !isNaN(num(a)) && num(a) === num(b);
    for (const p of pairReadingLines(data.lineItems, lines)) {
        const it = p.l.it, r = p.r.r, id = s(it.item.blindIQValue);
        const bt = s(it.blindType && it.blindType.blindIQValue);
        // a second reading under 300 mm for a blind is more likely a dropped digit ("60" for 600, BDO650187 Men WC)
        const differs = (rv, bv) => !isNaN(rv) && !isNaN(bv) && rv >= MIN_STEP_MM && Math.abs(rv - bv) > 2 && !(roundsTo5mm(bt) && bv >= MIN_STEP_MM && isFiveMmStep(rv, bv));
        // sizes: flag one dimension when the other one (or the location) confirms the pairing; flag both on a swap
        for (const [f, other] of [['width', 'drop'], ['drop', 'width']]) {
            if (f === 'drop' && p.l.val) continue;
            const field = it[f]; if (!anchored(field, numEq)) continue;
            const rv = f === 'width' ? p.r.w : p.r.d, bv = f === 'width' ? p.l.bw : p.l.bd;
            if (!differs(rv, bv) || conf(r, f) < minConf) continue;
            const otherOk = p.l.val || (other === 'drop' ? sameNum(p.r.d, p.l.bd) : sameNum(p.r.w, p.l.bw));
            const support = otherOk || p.swap || locSim(r.location, p.l.loc) >= 0.6;
            if (!support) continue;
            secondReadingFlag(field, rv, conf(r, f), changes, { item: id, field: f }, p.swap ? 'width and drop swapped' : 'size');
        }
        // quantity
        const q = parseFloat(s(r.qty)), bq = parseFloat(s(it.qty && it.qty.blindIQValue));
        if (!isNaN(q) && q > 0 && !isNaN(bq) && q !== bq && conf(r, 'qty') >= minConf && anchored(it.qty, (a, b) => parseFloat(s(a)) === parseFloat(s(b))))
            secondReadingFlag(it.qty, q, conf(r, 'qty'), changes, { item: id, field: 'qty' }, 'quantity');
        // colour: no word in common with Blind IQ's colour
        const rc = s(r.colour);
        if (rc && !isEmptyValue(rc) && !/^(as above|same|ditto|"|〃)$/i.test(rc) && conf(r, 'colour') >= Math.max(minConf, 0.85)
            && anchored(it.colour, (a, b) => normColour(a) === normColour(b) && normColour(a) !== '')) {
            const A = words(rc), B = words(it.colour.blindIQValue);
            let common = false; A.forEach(w => { if (B.has(w)) common = true; });
            if (A.size && B.size && !common) secondReadingFlag(it.colour, rc, conf(r, 'colour'), changes, { item: id, field: 'colour' }, 'colour');
        }
    }
    return { data, changes };
}

// ---------------------------------------------------------------- handwritten or unclear (when to read twice)
// The second reading costs about a third of a comparison, so it runs only for orders that are handwritten or
// unclear (Russel, Oct 2026). That is decided from the customer file itself, before any AI call: a photo, a PDF
// page that is a picture with no typed text on it (a scan, also one with an invisible OCR text layer), or
// handwriting on the PDF (ink annotations, or pen strokes flattened into the page as thousands of curves, as
// tablet note apps export them). Typed PDFs, filled-in PDF forms and spreadsheets are clear.
// Of the A/B test's customer files every handwritten order was a photo or a scan with no text layer, and every
// typed order, "as per quote" orders included, had at least 300 characters of text.
// `pdfjs` is pdf.js (window.pdfjsLib in the page, pdfjs-dist in the tests); `file` is a File or anything with
// name, type and arrayBuffer(). Returns { unclear, kind, page? }.
const IMAGE_FILE = /\.(jpe?g|png|gif|bmp|webp|heic|heif|tiff?)$/i;
const MIN_PAGE_TEXT = 60;      // characters of typed text (spaces left out) under which a page with a picture is a scan
const MIN_INK_STROKES = 10;    // ink strokes drawn on a PDF from which it counts as handwritten (a signature is fewer)
const MIN_PEN_CURVES = 4000;   // curve segments on a page from which it is pen strokes (typed order forms: at most ~800)
const MAX_PAGES = 20;
export async function customerFileLegibility(file, pdfjs) {
    const name = s(file && file.name), type = s(file && file.type);
    if (IMAGE_FILE.test(name) || /^image\//i.test(type)) return { unclear: true, kind: 'photo' };
    if (!/\.pdf$/i.test(name) && !/pdf/i.test(type)) return { unclear: false, kind: 'other' };
    if (!pdfjs || typeof pdfjs.getDocument !== 'function') return { unclear: true, kind: 'pdf not checked' };
    let doc = null;
    try {
        doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), verbosity: 0 }).promise;
        const OPS = pdfjs.OPS || {};
        const IMAGE_OPS = new Set(Object.keys(OPS).filter(k => /^paint\w*Image/i.test(k)).map(k => OPS[k]));
        const TEXT_OPS = new Set(['showText', 'showSpacedText', 'nextLineShowText', 'nextLineSetSpacingShowText'].map(k => OPS[k]).filter(v => v != null));
        const CURVE_OPS = new Set(['curveTo', 'curveTo2', 'curveTo3'].map(k => OPS[k]).filter(v => v != null));
        let typed = 0, ink = 0;
        for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGES); p++) {
            const page = await doc.getPage(p);
            let text = (await page.getTextContent()).items.map(i => i.str || '').join('');
            (await page.getAnnotations()).forEach(a => {
                if (a.fieldName) { const v = a.fieldValue; if (!(v == null || v === 'Off' || v === '/Off')) text += Array.isArray(v) ? v.join('') : String(v); }
                if (a.subtype === 'FreeText') text += s(a.contentsObj ? a.contentsObj.str : a.contents);
                if (a.subtype === 'Ink' && Array.isArray(a.inkLists)) ink += a.inkLists.length;
            });
            const chars = text.replace(/\s/g, '').length;
            typed += chars;
            // pictures on the page, and text drawn invisibly (render mode 3 or 7: an OCR layer over a scan)
            const ops = await page.getOperatorList();
            let images = 0, shown = 0, hidden = 0, mode = 0, curves = 0;
            const saved = [];
            ops.fnArray.forEach((fn, i) => {
                if (IMAGE_OPS.has(fn)) images++;
                else if (fn === OPS.constructPath) { const sub = ops.argsArray[i] && ops.argsArray[i][0]; if (Array.isArray(sub)) sub.forEach(o => { if (CURVE_OPS.has(o)) curves++; }); }
                else if (fn === OPS.save) saved.push(mode);
                else if (fn === OPS.restore) mode = saved.length ? saved.pop() : 0;
                else if (fn === OPS.setTextRenderingMode) mode = ops.argsArray[i] ? ops.argsArray[i][0] : 0;
                else if (TEXT_OPS.has(fn)) { shown++; if (mode === 3 || mode === 7) hidden++; }
            });
            if (typeof page.cleanup === 'function') page.cleanup();
            if (images && chars < MIN_PAGE_TEXT) return { unclear: true, kind: 'scan', page: p };
            if (images && shown && hidden / shown >= 0.5) return { unclear: true, kind: 'scan with OCR text', page: p };
            if (curves >= MIN_PEN_CURVES) return { unclear: true, kind: 'pen strokes', page: p };
        }
        if (ink >= MIN_INK_STROKES) return { unclear: true, kind: 'handwriting on the PDF' };
        if (typed < MIN_PAGE_TEXT) return { unclear: true, kind: 'no typed text' };
        return { unclear: false, kind: 'typed' };
    } catch (e) {
        // pdf.js could not open it (damaged or password-protected): read it twice rather than miss a handwritten order
        return { unclear: true, kind: 'pdf not readable' };
    } finally {
        if (doc) { try { await doc.destroy(); } catch (e) { /* already gone */ } }
    }
}

// The order needs the second reading when any of its customer files is handwritten or unclear.
export async function needsSecondReading(files, pdfjs) {
    for (const f of (files || [])) {
        const r = await customerFileLegibility(f, pdfjs);
        if (r.unclear) return { needed: true, file: s(f && f.name), kind: r.kind };
    }
    return { needed: false, kind: 'typed' };
}

// ---------------------------------------------------------------- 4. exact customer values (BlindIQ Online orders)
// A BlindIQ Online order (the dealer's own order in BlindIQ Online, exported as "Online Purchase Order" with an IQ
// Link ID) prints Blind IQ's own names, sizes, controls and options, and the converter parses it without the AI
// (biqParseBiqOnline). Capturers still re-key these orders. So the customer's values are taken from the export
// exactly: on every line the comparison pairs with an export line, each field's customer value becomes the
// export's and its result follows from comparing the two exact values; the AI's own reading stays in
// `aiCustomerValue` / `aiResult`. The rule checks and validations run afterwards as for any order (Russel, Oct 2026).
// `readings`: [{ exact: true, file, order: { items: [{ code, qty, location, blindType, range, colour, width, drop,
// fix, control1, control2, exactOptions: [[k, v]] }] } }] (biqReadCustomerFile).
const EXACT_FIELDS = { qty: 'qty', location: 'location', width: 'width', drop: 'drop', blindType: 'blindType', range: 'range', colour: 'colour', fix: 'fix', control1: 'control1', control2: 'control2' };
// Blind IQ renamed the Element blind types on 1 Aug 2026 (same ids); an online order from before prints the old name
const BT_RENAMED = { 'element roller sys 40': 'roller system 40', 'element wood': 'wood venetian', 'element retro': 'retro venetian', 'element vision': 'vision blind', 'element 35mm aluminium': '35mm aluminium' };
const exactEq = (f, a, b) => {
    if (f === 'width' || f === 'drop' || f === 'qty') { const x = parseFloat(s(a)), y = parseFloat(s(b)); return !isNaN(x) && !isNaN(y) ? x === y : s(a) === s(b); }
    if (f === 'blindType') { const t = v => BT_RENAMED[normName(v)] || normName(v); return t(a) === t(b); }
    return normName(a) === normName(b);
};
function exactResult(f, v, b) {
    if (exactEq(f, v, b) || (isEmptyValue(v) && isEmptyValue(b))) return 'MATCH';
    if (isEmptyValue(v)) return 'NOT_SPECIFIED';     // left open on the order; Blind IQ filled it in
    if (isEmptyValue(b)) return 'OMISSION';          // on the order, missing in Blind IQ
    return 'MISMATCH';
}
export function applyExactReading(data, readings, opts = {}) {
    const changes = [];
    const src = (readings || []).filter(r => r && r.exact && r.order && Array.isArray(r.order.items) && r.order.items.length);
    if (!src.length || !data || !Array.isArray(data.lineItems)) return { data, changes, paired: 0 };
    const label = opts.label || 'the BlindIQ Online order';
    const lines = src.flatMap(r => r.order.items.map(it => ({ it, used: false })));
    const sizeOk = (li, it) => [['width', 'width'], ['drop', 'drop']].some(([f]) => { const b = li[f] && li[f].blindIQValue; return !isNaN(parseFloat(s(b))) && Math.abs(parseFloat(s(b)) - parseFloat(s(it[f]))) <= 5; })
        || exactEq('blindType', li.blindType && li.blindType.blindIQValue, it.blindType);
    let paired = 0;
    data.lineItems.forEach((li, idx) => {
        if (!li || !li.item) return;
        // the export line: the customer's item letter as the comparison read it (Blind IQ's letters shift when a line
        // is added, e.g. a separate Valance line), when the sizes or the blind type agree; else the same width and drop
        const code = s(li.item.customerValue);
        let e = code ? lines.find(x => !x.used && s(x.it.code).toUpperCase() === code.toUpperCase() && sizeOk(li, x.it)) : null;
        if (!e) e = lines.find(x => !x.used && ['width', 'drop'].every(f => { const b = parseFloat(s(li[f] && li[f].blindIQValue)), c = parseFloat(s(x.it[f])); return !isNaN(b) && !isNaN(c) && Math.abs(b - c) <= 5; })
            && exactEq('blindType', li.blindType && li.blindType.blindIQValue, x.it.blindType));
        if (!e) return;
        e.used = true; paired++;
        const it = e.it, id = s(li.item.blindIQValue) || String(idx + 1);
        for (const [f, k] of Object.entries(EXACT_FIELDS)) {
            const x = li[f]; if (!x) continue;
            const v = s(it[k]), b = s(x.blindIQValue), r = exactResult(f, v, b);
            if (s(x.customerValue) === v && x.result === r) { x.exact = label; continue; }
            if (x.aiCustomerValue === undefined) x.aiCustomerValue = s(x.customerValue);
            if (x.aiResult === undefined) x.aiResult = x.result;
            x.customerValue = v; x.result = r; x.confidence = 1; x.exact = label;
            changes.push({ item: id, field: f, from: x.aiResult, to: r, customerValue: v, aiCustomerValue: x.aiCustomerValue });
        }
        // the options the dealer set on the order, where Blind IQ's line has the same option: an option left at the
        // sheet's default is not printed on the order, and one Blind IQ carries elsewhere (the cassette on its own
        // Valance line, BDO669951) is for the AI and the Blind Designs standards, so both stay as the AI read them
        const opts2 = new Map((it.exactOptions || []).map(([k, v]) => [normName(k), s(v)]));
        (li.specifications || []).forEach(sp => {
            const x = sp && sp.specComparison; if (!x) return;
            const key = normName(sp.specName); if (!opts2.has(key)) return;
            const v = opts2.get(key), b = s(x.blindIQValue);
            if (isEmptyValue(b) || isEmptyValue(v)) return;
            const r = exactEq('spec', v, b) ? 'MATCH' : 'MISMATCH';
            if (s(x.customerValue) === v && x.result === r) { x.exact = label; return; }
            if (x.aiCustomerValue === undefined) x.aiCustomerValue = s(x.customerValue);
            if (x.aiResult === undefined) x.aiResult = x.result;
            x.customerValue = v; x.result = r; x.confidence = 1; x.exact = label;
            changes.push({ item: id, field: 'spec:' + s(sp.specName), from: x.aiResult, to: r, customerValue: v, aiCustomerValue: x.aiCustomerValue });
        });
    });
    data.exactReading = { source: label, lines: lines.length, paired };
    return { data, changes, paired };
}
