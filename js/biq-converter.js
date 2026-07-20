// =============================================================================
// biq-converter.js — BlindIQ XML Converter core (pure module, no DOM/network)
// Parses customer order documents (Blind Guys xlsx rows, Mathéo PDF text,
// BD fillable-form fields, or AI-extracted JSON) into a common order model,
// resolves names -> BlindIQ IDs via a mappings object, emits BlindIQExport_CO
// XML, and bridges orders into OrderBot's comparison shape so
// runPostAIValidations() / validateMotorDependencies() can check them.
// All exports are named (repo convention). No default exports. No CommonJS.
// =============================================================================

// ---------- tiny helpers ----------
export const biqNorm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
export const biqLc = s => biqNorm(s).toLowerCase();
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const isOff = v => v == null || v === '' || v === '/Off' || v === 'Off';
const cleanVal = v => { const x = biqNorm(v); return /^(no|none|n\/a|na|off|-)$/i.test(x) ? '' : x; };

// ---------- seed mappings (learned from real BlindIQ exports 116888 / 20112) ----------
export const BIQ_SEED_MAPPINGS = {
    blindTypes: { 'element roller sys 40': 25, 'system 40': 25, 'roller blinds': 25, 'roller blind': 25, 'element wood': 24, 'wood venetian': 24, 'curtain ripple': 18, 'double roller blinds': 28, 'double roller': 28 },
    ranges: { 'edge block': 993, 'urban filter': 1023, '3 screen': 754, 'classic': 408, 'hand drawn': 327 },
    colours: { 'edge block|alabaster': 35, 'urban filter|melody': 2854, '3 screen|ice': 517, 'classic|snow': 686 },
    fixes: { 'reveal': 1, 'face': 2, 'none': -1 },
    control1: { 'lh chain': 9, 'lh pin': 11, 'left': 1, 'none': -1 },
    control2: { 'rh chain': 10, 'rh pin': 18, 'grouped': 7, 'stack centre split': 47, 'none': -1 },
    deliveryMethods: { 'courier triton': 3, 'courier': 3 },
    packingTypes: { 'boxed': 2 },
    customers: { 'total blind designs': { customer: 7051, address: 7050, operator: 954 } },
    fabricSplits: {}, rangesScoped: {}, rangeFormulas: {}, sundries: {}, sundryTypes: {}, variantTemplates: {}
};
export const BIQ_MAPPING_CATEGORIES = {
    blindTypes: { label: 'Blind types', xml: 'COI_BlindType_Link' },
    ranges: { label: 'Fabric ranges', xml: 'COI_BlindRange_Link' },
    colours: { label: 'Colours (key: range|colour)', xml: 'COI_Colour_Link' },
    fixes: { label: 'Fix types', xml: 'COI_Fix_Link' },
    control1: { label: 'Controls — left / primary', xml: 'COI_Control1_Link' },
    control2: { label: 'Controls — right / secondary', xml: 'COI_Control2_Link' },
    deliveryMethods: { label: 'Delivery methods', xml: 'CO_DeliveryMethod_Link' },
    packingTypes: { label: 'Packing types', xml: 'CO_PackingType_Link' },
    customers: { label: 'Customers', xml: 'CO_Customer_Link + address + operator' },
    fabricSplits: { label: 'Fabric splits (combined fabric -> range + colour)', xml: '—' },
    rangesScoped: { label: 'Ranges (scoped: blindTypeId|range)', xml: 'COI_BlindRange_Link' },
    rangeFormulas: { label: 'Control drop formulas (rangeId -> formula)', xml: 'COI_ControlDrop' },
    sundries: { label: 'Sundries (name/code -> {sundry, type})', xml: 'COS_Sundry_Link + COS_SundryType_Link' },
    sundryTypes: { label: 'Sundry types', xml: 'COS_SundryType_Link' },
    variantTemplates: { label: 'Variant option templates (blindTypeId -> options)', xml: 'COI_VariantOptions' }
};

// ---------- mapping resolution ----------
// Code-based aliases for dealer wording that isn't a catalogue key. Kept in code (not data) so both
// OrderBot and the offline tool get them without a Firestore re-import. Values are catalogue keys.
const BIQ_ALIASES = {
    blindTypes: {
        'bd element roller 40': 'element roller sys 40', 'element roller 40': 'element roller sys 40',
        'bd element vision': 'element vision', 'element vision blind': 'element vision',
        'bd element wood alloy': 'element wood', 'element wood alloy': 'element wood', 'bd element wood': 'element wood',
        'bd outdoor blinds - free hang': 'outdoor free hang', 'outdoor blinds - free hang': 'outdoor free hang', 'bd outdoor free hang': 'outdoor free hang',
        'bd cellular skylight': 'cellular skylight lantern', 'cellular skylight': 'cellular skylight lantern',
        'element wood venetian': 'element wood', 'wood venetian': 'element wood', 'bd element wood venetian': 'element wood',
        'urban hinged': 'urban hinged shutter', 'altra hinged': 'altra hinged shutter', 'altra fold': 'altra fold shutter',
        'vertical blind': '90mm vertical blind', 'vertical': '90mm vertical blind', '90mm vertical': '90mm vertical blind'
    },
    fixes: {
        'f/f': 'face', 'ff': 'face', 'face fix': 'face', 'facefix': 'face',
        'i/r': 'reveal', 'ir': 'reveal', 'inside reveal': 'reveal', 'recess': 'reveal', 'standard recess': 'reveal', 'standard facefix': 'face',
        'rev': 'reveal', 'rev l': 'reveal', 'rev r': 'reveal', 'reveal l': 'reveal', 'reveal r': 'reveal'
    }
};
export function biqResolve(mappings, cat, name) {
    const key = biqLc(name);
    if (!key) return { id: null, known: false, empty: true };
    if (mappings[cat] && mappings[cat][key] != null) return { id: mappings[cat][key], known: true };
    const al = BIQ_ALIASES[cat];
    if (al && mappings[cat]) {
        let aliasKey = al[key];
        if (aliasKey == null && cat === 'blindTypes' && key.startsWith('bd ')) {            // generic "BD " prefix strip
            const k2 = key.slice(3);
            if (mappings[cat][k2] != null) return { id: mappings[cat][k2], known: true, alias: true };
            aliasKey = al[k2];
        }
        if (aliasKey != null && mappings[cat][biqLc(aliasKey)] != null) return { id: mappings[cat][biqLc(aliasKey)], known: true, alias: true };
    }
    return { id: null, known: false };
}
export function biqResolveColour(mappings, range, colour) {
    const k1 = biqLc(range) + '|' + biqLc(colour), k2 = '|' + biqLc(colour);
    if (mappings.colours[k1] != null) return { id: mappings.colours[k1], known: true };
    if (mappings.colours[k2] != null) return { id: mappings.colours[k2], known: true };
    if (!biqLc(colour)) return { id: null, known: false, empty: true };
    // Spacing-insensitive fallback: "Dunegrey" -> "Dune Grey". Only accepted when the squashed
    // form maps to exactly one colour, so it can never silently pick between two fabrics.
    const squash = s => biqLc(s).replace(/[\s\-]+/g, '');
    if (!mappings._colourSquash) {
        const idx = {};
        Object.keys(mappings.colours).forEach(k => {
            const s = squash(k.slice(k.indexOf('|') + 1)); if (!s) return;
            if (idx[s] === undefined) idx[s] = mappings.colours[k];
            else if (idx[s] !== mappings.colours[k]) idx[s] = null;      // ambiguous -> never used
        });
        try { Object.defineProperty(mappings, '_colourSquash', { value: idx, enumerable: false }); }
        catch (e) { mappings._colourSquash = idx; }
    }
    const hit = mappings._colourSquash[squash(colour)];
    if (hit != null) return { id: hit, known: true, alias: true };
    return { id: null, known: false };
}

// ---------- order model ----------
// Range lookup, blind-type-scoped: BlindIQ range names repeat across blind types
// ("Sheerweave 4500" exists 12x), so try '<blindTypeId>|<range>' first, then the
// flat map (which only contains globally-unique names).
export function biqResolveRange(mappings, blindTypeName, rangeName) {
    const key = biqLc(rangeName);
    if (!key) return { id: null, known: false, empty: true };
    const bt = biqResolve(mappings, 'blindTypes', blindTypeName);
    if (bt.known && mappings.rangesScoped && mappings.rangesScoped[bt.id + '|' + key] != null)
        return { id: mappings.rangesScoped[bt.id + '|' + key], known: true, scoped: true };
    if (mappings.ranges[key] != null) return { id: mappings.ranges[key], known: true };
    const stripped = key.replace(/\s*\d+$/, '').trim();          // "Duo Screen40" -> "Duo Screen" (Windovert suffixes)
    if (stripped && stripped !== key) {
        if (bt.known && mappings.rangesScoped && mappings.rangesScoped[bt.id + '|' + stripped] != null)
            return { id: mappings.rangesScoped[bt.id + '|' + stripped], known: true, scoped: true };
        if (mappings.ranges[stripped] != null) return { id: mappings.ranges[stripped], known: true };
    }
    return { id: null, known: false };
}
// Candidate range names for fabric-splitting, narrowed to the blind type when known.
export function biqRangeNamesFor(mappings, blindTypeName) {
    const names = new Set(Object.keys(mappings.ranges));
    const bt = biqResolve(mappings, 'blindTypes', blindTypeName);
    for (const k of Object.keys(mappings.rangesScoped || {})) {
        const i = k.indexOf('|');
        if (!bt.known || k.slice(0, i) === String(bt.id)) names.add(k.slice(i + 1));
    }
    return [...names].sort((a, b) => b.length - a.length);
}
// Control drop from the range's real BlindIQ formula ("[drop]*0.75", "[drop]*0.66",
// "400", "0", "[drop]-0"); falls back to the 75% heuristic when the range is unknown.
export function biqComputeControlDropV2(mappings, raw, drop, blindTypeName, rangeName) {
    const r = biqNorm(raw);
    if (/^\d+(\.\d+)?$/.test(r)) return String(Math.round(+r));
    const d = parseFloat(drop);
    if (!d && d !== 0) return '';
    if (r && !/std|standard|75/i.test(r)) return '';
    const rr = biqResolveRange(mappings, blindTypeName, rangeName);
    if (rr.known) {
        const entry = (mappings.rangeFormulas || {})[String(rr.id)];
        if (entry === undefined) return String(Math.floor(d * 0.75)); // range known, formula not in DB -> heuristic
        const f = String(entry).trim();
        if (!f || f === '0') return '0';                              // DB says no control drop (curtains etc.)
        let m = f.match(/^\[drop\]\s*\*\s*([\d.]+)$/i);   if (m) return String(Math.floor(d * parseFloat(m[1])));
        m = f.match(/^\[drop\]\s*-\s*([\d.]+)$/i);          if (m) return String(Math.round(d - parseFloat(m[1])));
        m = f.match(/^[\d.]+$/);                                if (m) return String(Math.round(parseFloat(f)));
        return String(Math.floor(d * 0.75));
    }
    return String(Math.floor(d * 0.75));
}
// Exact-name (or stock-code) sundry lookup -> {sundry, type} or null.
export function biqResolveSundry(mappings, text) {
    const e = (mappings.sundries || {})[biqLc(text)];
    return e ? { sundry: e.sundry, type: e.type } : null;
}
// Fuzzy sundry match: exact key first, else every word of the text must appear in
// the key; a single hit resolves, several hits stay unresolved (operator picks —
// e.g. adapter kits that come in colour variants).
export function biqFuzzySundry(mappings, text) {
    const exact = biqResolveSundry(mappings, text);
    if (exact) return Object.assign({ desc: biqLc(text), exact: true }, exact);
    const stop = new Set(['for', 'the', 'and', 'with', 'x']);
    const tokens = biqLc(text).split(/[^a-z0-9.:]+/).filter(t => t.length > 1 && !stop.has(t));
    if (!tokens.length) return null;
    const hits = Object.keys(mappings.sundries || {}).filter(k => tokens.every(t => k.includes(t)));
    if (hits.length === 1) { const e = mappings.sundries[hits[0]]; return { sundry: e.sundry, type: e.type, desc: hits[0], exact: false }; }
    if (hits.length > 1) return { ambiguous: hits.length };
    // second pass: gentle spelling synonyms (li-ion <-> lithium ion, "2.0nm" <-> "2nm")
    const canon = str => str.replace(/li-ion/g, 'lithiumion').replace(/lithium\s+ion/g, 'lithiumion').replace(/(\d)\.0\s*nm/g, '$1nm').replace(/\s+nm/g, 'nm');
    const ctokens = canon(biqLc(text)).split(/[^a-z0-9.:]+/).filter(t => t.length > 1 && !stop.has(t));
    const chits = Object.keys(mappings.sundries || {}).filter(k => { const ck = canon(k); return ctokens.every(t => ck.includes(t)); });
    if (chits.length === 1) { const e = mappings.sundries[chits[0]]; return { sundry: e.sundry, type: e.type, desc: chits[0], exact: false }; }
    if (chits.length > 1) return { ambiguous: chits.length };
    return null;
}
// Turn motorisation text (motor / remote / adapter) into an order sundry line,
// aggregating duplicates by description.
export function biqAddMotorSundry(mappings, order, text, qty) {
    const t = biqNorm(text); if (!t) return;
    const existing = order.sundries.find(su => biqLc(su.notes) === biqLc(t) || (su._src && biqLc(su._src) === biqLc(t)));
    if (existing) { existing.qty = String((+existing.qty || 0) + (+qty || 1)); return; }
    const hit = biqFuzzySundry(mappings, t);
    const su = { code: '', qty: String(+qty || 1), type: '', sundry: '', notes: t, _src: t };
    if (hit && hit.sundry != null) { su.type = String(hit.type); su.sundry = String(hit.sundry); if (!hit.exact) su.notes = t; }
    order.sundries.push(su);
}
// Recompute auto-filled control drops once mappings/blind types resolve.
export function biqRecomputeControlDrops(mappings, order) {
    (order ? order.items : []).forEach(it => {
        if (it._cdAuto || !biqNorm(it.controlDrop)) {
            const v = biqComputeControlDropV2(mappings, '', it.drop, it.blindType, it.range);
            if (v !== '') { it.controlDrop = v; it._cdAuto = true; }
        }
    });
}

export function biqBlankOrder() {
    return {
        source: 'manual', sourceDesc: 'Manual entry',
        customer: '', orderNumber: '', client: '', orderDate: '', requiredDate: '',
        deliveryMethod: '', packingType: '', address: '', notes: '', orderId: '0',
        items: [], sundries: []
    };
}
export function biqBlankItem(code) {
    return {
        code: code || '', qty: '1', location: '', blindType: '', range: '', colour: '',
        width: '', drop: '', fix: '', control1: '', control2: '', controlDrop: '',
        variants: [], notes: ''
    };
}

// ---------- date parsing ----------
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function biqParseDate(s) {
    s = biqNorm(s); if (!s) return '';
    let m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    m = s.match(/(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{2,4})/);
    if (m) { const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; if (mo) { let y = +m[3]; if (y < 100) y += 2000; return `${y}-${String(mo).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`; } }
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`; }
    return '';
}

// ---------- control drop: "Std" = 75% of drop, floored (matches BlindIQ portal) ----------
export function biqComputeControlDrop(raw, drop) {
    const r = biqNorm(raw);
    if (/^\d+(\.\d+)?$/.test(r)) return String(Math.round(+r));
    const d = parseFloat(drop);
    if (!d) return '';
    if (!r || /std|standard|75/i.test(r)) return String(Math.floor(d * 0.75));
    return '';
}

// ---------- variant templates (exact key sets from real BlindIQ exports) ----------
const VARIANT_TEMPLATES = {
    roller: ['Mech Colour', 'Bottom Bar', 'Roll Type', 'Steel Ball Chain', 'Remove Bracket Covers', 'Plastic Bottom Bar', 'SmartRail', 'Intermediate Bracket', 'Coupled Bracket', 'System 40 1.5:1', 'System 32', 'Sys 40 70mm Cassette', 'Fabric Insert for 70mm Cassette', 'White PVC 70mm Cassette', 'Chain Tidy', 'Wire Side Guides', 'Fabric Only', 'Out of Warranty'],
    venetian: ['Val Size', 'Val Returns', 'Mitre Val LH', 'Mitre Val RH', 'Ladder Tape', 'Ladder Tape Colour', 'Hold Downs Clip In', 'Hold Downs Magnetic', 'Cut Out LH', 'Cut Out RH', 'Mixed Slats', 'Out Of Warranty'],
    defaults: { 'Steel Ball Chain': 'No', 'Remove Bracket Covers': 'No', 'Chain Tidy': 'No' }
};
export function biqTemplateFor(blindTypeName) {
    const t = biqLc(blindTypeName);
    if (/venetian|wood/.test(t)) return VARIANT_TEMPLATES.venetian.map(k => [k, '']);
    if (/roller|element|system/.test(t)) return VARIANT_TEMPLATES.roller.map(k => [k, VARIANT_TEMPLATES.defaults[k] || '']);
    return [];
}
// Variant option spec per blind type, harvested from the BlindIQ price matrices:
// [{k, values[], def, req}] in the exact order the exports use. Null when unknown.
export function biqVariantSpec(mappings, blindTypeName) {
    const bt = biqResolve(mappings, 'blindTypes', blindTypeName);
    if (!bt.known) return null;
    const t = (mappings.variantTemplates || {})[String(bt.id)];
    return (t && t.length) ? t : null;
}
// Template as [key, default] pairs — DB spec when available, legacy heuristics otherwise.
export function biqTemplateFor2(mappings, blindTypeName) {
    const spec = biqVariantSpec(mappings, blindTypeName);
    if (spec) return spec.map(o => [o.k, o.def || '']);
    return biqTemplateFor(blindTypeName);
}
// Add any template keys missing from an item's variants (keeps existing values + order).
export function biqMergeTemplate(mappings, it) {
    const spec = biqVariantSpec(mappings, it.blindType);
    if (!spec) return;
    const have = new Set(it.variants.map(v => biqLc(v[0])));
    const merged = [];
    spec.forEach(o => {
        const i = it.variants.findIndex(v => biqLc(v[0]) === biqLc(o.k));
        if (i >= 0) merged.push(it.variants[i]); else merged.push([o.k, o.def || '']);
    });
    it.variants.forEach(v => { if (!spec.some(o => biqLc(o.k) === biqLc(v[0]))) merged.push(v); });
    it.variants = merged;
}
export function biqSetVar(variants, key, val) {
    if (val === '' || val == null) return;
    const i = variants.findIndex(v => biqLc(v[0]) === biqLc(key));
    if (i >= 0) variants[i][1] = val; else variants.push([key, val]);
}
// The variant options that will actually reach BlindIQ for an item — the single source of truth for
// both the XML and the import preview. Key must exist in the spec, value must be non-empty and (when a
// value list is known) a real catalogue value; optional options sitting at their default are dropped
// (absence = default in BlindIQ); required options always emit. Unknown blind type -> all non-empty.
export function biqEmittedVariants(mappings, it) {
    const spec = biqVariantSpec(mappings, it.blindType);
    if (!spec) return it.variants.filter(v => biqNorm(v[0]) && biqNorm(v[1]));
    return it.variants.filter(v => {
        const o = spec.find(s => biqLc(s.k) === biqLc(v[0]));
        if (!o) return false;
        const val = biqNorm(v[1]);
        if (!val) return false;
        const allowed = (o.values || []).map(biqLc);
        if (allowed.length && !allowed.includes(biqLc(val))) return false;
        if (!o.req && o.def != null && biqNorm(o.def) && biqLc(val) === biqLc(o.def)) return false;
        return true;
    });
}

// ---------- fabric split ("5 Screen Charcoal Grey" -> range + colour) ----------
export function biqSplitFabric(mappings, fabric, blindTypeName) {
    const f = biqNorm(fabric); if (!f) return { range: '', colour: '' };
    const saved = mappings.fabricSplits[biqLc(f)]; if (saved) return { range: saved.range, colour: saved.colour };
    const ranges = biqRangeNamesFor(mappings, blindTypeName);
    const fl = biqLc(f);
    for (const r of ranges) {
        if (fl.startsWith(r + ' ')) return { range: f.slice(0, r.length), colour: biqNorm(f.slice(r.length)) };
        if (fl === r) return { range: f, colour: '' };
    }
    return { range: f, colour: '' };
}
export function biqNeedsSplit(mappings, it) {
    return !!(it._origFabric && biqLc(it.range) === biqLc(it._origFabric)
        && !biqResolveRange(mappings, it.blindType, it.range).known && biqLc(it._origFabric).split(' ').length > 1);
}
export function biqReSplitFabrics(mappings, order) {
    (order ? order.items : []).forEach(it => {
        if (it._origFabric && !biqResolveRange(mappings, it.blindType, it.range).known) {
            const f = biqSplitFabric(mappings, it._origFabric, it.blindType);
            if (biqResolveRange(mappings, it.blindType, f.range).known) { it.range = f.range; if (f.colour) it.colour = f.colour; }
        }
    });
}

// =============================================================================
// PARSERS — deterministic fast-paths for known formats
// =============================================================================

// ---------- Blind Guys XLSX (rows = array-of-arrays from SheetJS, header:1) ----------
export function biqParseBlindGuysRows(rows) {
    const get = (r, c) => biqNorm(rows[r] && rows[r][c]);
    let meta = { customerName: '', orderNumber: '', address: '', orderDate: '', company: '', product: '', rep: '' };
    for (let r = 0; r < Math.min(rows.length, 8); r++) for (let c = 0; c < (rows[r] || []).length; c++) {
        const v = biqLc(rows[r][c]);
        if (v === 'customer name:') meta.customerName = get(r, c + 2) || get(r, c + 1);
        if (v === 'orderno/ref:') meta.orderNumber = get(r, c + 2) || get(r, c + 1);
        if (v === 'address:') meta.address = String(rows[r][c + 2] || rows[r][c + 1] || '').replace(/\r/g, '').trim();
        if (v === 'order date:') meta.orderDate = get(r, c + 2) || get(r, c + 1);
        if (v === 'company') meta.company = get(r, c + 1) || get(r, c + 2);
        if (v === 'product') meta.product = get(r, c + 1) || get(r, c + 2);
        if (v === 'sales rep') meta.rep = get(r, c + 1) || get(r, c + 2);
    }
    let hr = -1, headers = [];
    for (let r = 0; r < Math.min(rows.length, 15); r++) {
        const vals = (rows[r] || []).map(biqLc);
        if (vals.includes('item #') && vals.includes('location')) { hr = r; headers = (rows[r] || []).map(biqNorm); break; }
    }
    if (hr < 0) return null;
    const col = {}; headers.forEach((h, i) => { if (h) col[biqLc(h)] = i; });
    const items = [];
    for (let r = hr + 1; r < rows.length; r++) {
        const code = get(r, col['item #']); if (!code) continue;
        const raw = {}; headers.forEach((h, i) => { if (h) raw[h] = biqNorm(rows[r][i]); });
        items.push(raw);
    }
    const prod = biqLc(meta.product);
    let kind = 'roller';
    if (/double/.test(prod)) kind = 'doubleRoller';
    else if (/shutter/.test(prod)) kind = 'shutter';
    else if (/venetian|wood/.test(prod)) kind = 'venetian';
    return { meta, items, kind, doubleRoller: kind === 'doubleRoller' };
}
// Roller + Double Roller line (the original mapping, unchanged).
function biqBgRoller(mappings, o, it, raw, doubleRoller, product) {
    it.width = raw['Finished Width'] || ''; it.drop = raw['Finished Height'] || '';
    it.fix = raw['Fixing'] || '';
    it.blindType = doubleRoller ? (product || 'Double Roller Blinds') : (raw['Type'] || product || '');
    const fabRaw = doubleRoller ? (raw['Front Blind Fabric'] || '') : (raw['Fabric'] || '');
    { const f = biqSplitFabric(mappings, fabRaw, it.blindType); it.range = f.range; it.colour = f.colour; it._origFabric = fabRaw; }
    it.control1 = raw['LH Control'] || ''; it.control2 = raw['RH Control'] || '';
    { const cl = biqNorm(raw['Control Length'] || '');
      it.controlDrop = biqComputeControlDropV2(mappings, cl, it.drop, it.blindType, it.range);
      it._cdAuto = !/^\d/.test(cl); }
    it.variants = biqTemplateFor2(mappings, doubleRoller ? (product || 'Double Roller Blinds') : it.blindType);
    const mapv = (src, key) => { const v = cleanVal(raw[src]); if (v) biqSetVar(it.variants, key, v); };
    if (doubleRoller) {
        const frontIsBlockout = /block/i.test(raw['Configuration Front Blind'] || '');
        const front = cleanVal(raw['Front Blind Fabric']), back = cleanVal(raw['Back Blind Fabric']);
        if (front) biqSetVar(it.variants, frontIsBlockout ? 'Blockout Fabric' : 'View Fabric', front);
        if (back) biqSetVar(it.variants, frontIsBlockout ? 'View Fabric' : 'Blockout Fabric', back);
        mapv('Bottom Bar Colour', 'Bottom Bar'); mapv('Cassette Colour', 'Cassette Colour');
        mapv('Fabric Insert Cassette', 'Fabric Insert for 70mm Cassette');
        mapv('Roll Type Front', 'Roll Type'); mapv('Roll Type Back', 'Roll Type Back');
    } else {
        mapv('Mechanism Colour', 'Mech Colour'); mapv('Bottom Bar Colour', 'Bottom Bar'); mapv('Roll', 'Roll Type');
        mapv('Steel Ball Chain', 'Steel Ball Chain'); mapv('Remove Bracket Covers', 'Remove Bracket Covers');
        mapv('Plastic Bottom Bar', 'Plastic Bottom Bar'); mapv('Chain Tidy', 'Chain Tidy');
        mapv('Wired Side Guides', 'Wire Side Guides'); mapv('Fabric Only', 'Fabric Only');
        mapv('Fabric Insert', 'Fabric Insert for 70mm Cassette');
        const cass = cleanVal(raw['System 40 70mm Cassette'] || raw['Closed Cassette']); if (cass) biqSetVar(it.variants, 'Sys 40 70mm Cassette', cass);
        const ty = biqLc(raw['Type']); if (ty.includes('system 32')) biqSetVar(it.variants, 'System 32', 'Yes');
        if (ty.includes('1.5')) biqSetVar(it.variants, 'System 40 1.5:1', 'Yes');
    }
    const motorTxt = cleanVal(raw['Motor']), remoteTxt = cleanVal(raw['Remotes']),
        accTxt = cleanVal(raw['Accessory']) || cleanVal(raw['Accessories']);
    if (motorTxt) biqAddMotorSundry(mappings, o, motorTxt, +it.qty || 1);
    if (remoteTxt) biqAddMotorSundry(mappings, o, remoteTxt, 1);
    if (accTxt) biqAddMotorSundry(mappings, o, accTxt, +it.qty || 1);
    if (!motorTxt && cleanVal(raw['Motor Type'])) it.notes = (it.notes ? it.notes + ' | ' : '') + 'Motor type: ' + cleanVal(raw['Motor Type']);
    const skip = new Set(['Item #', 'Location', 'Finished Width', 'Finished Height', 'Qty', 'Type', 'LH Control', 'RH Control', 'Control Length', 'Mechanism Colour', 'Bottom Bar Colour', 'Fabric', 'Fixing', 'Roll', 'Line Notes', 'Express', 'Front Blind Fabric', 'Back Blind Fabric', 'Configuration Front Blind', 'Configuration Back Blind', 'Cassette Colour', 'Fabric Insert Cassette', 'Roll Type Front', 'Roll Type Back', 'Steel Ball Chain', 'Remove Bracket Covers', 'Plastic Bottom Bar', 'Chain Tidy', 'Wired Side Guides', 'Fabric Only', 'Fabric Insert', 'System 40 70mm Cassette', 'Closed Cassette', 'Motor', 'Motor Type', 'Remotes', 'Accessory', 'Accessories']);
    for (const [k, v] of Object.entries(raw)) {
        if (skip.has(k)) continue; const cv = cleanVal(v); if (cv) biqSetVar(it.variants, k, cv);
    }
}
// Element Wood Venetian line (Blind Guys BD1-EWV "Supply Sheet").
function biqBgVenetian(mappings, o, it, raw) {
    it.width = raw['Finished Width'] || ''; it.drop = raw['Finished Drop'] || raw['Finished Height'] || '';
    it.fix = raw['Fit'] || raw['Fixing'] || '';
    it.blindType = 'Element Wood';
    it.colour = raw['Colour'] || '';            // slat colour; wood range isn't on the sheet -> left to flag/map
    it.control1 = raw['Control Side'] || ''; it.control2 = raw['Operation'] || '';
    { const cl = biqNorm(raw['Control Length'] || '');
      it.controlDrop = biqComputeControlDropV2(mappings, cl, it.drop, it.blindType, it.range);
      it._cdAuto = !/^\d/.test(cl); }
    it.variants = biqTemplateFor2(mappings, it.blindType);
    const mapv = (src, key) => { const v = cleanVal(raw[src]); if (v) biqSetVar(it.variants, key, v); };
    mapv('Valance Length', 'Val Size');
    const vr = biqLc(raw['Valancce Returns'] || raw['Valance Returns'] || '');
    if (vr) biqSetVar(it.variants, 'Val Returns', /^(no|none)$/.test(vr) ? 'None' : (raw['Valancce Returns'] || raw['Valance Returns']));
    mapv('Mitre Val LH', 'Mitre Val LH'); mapv('Mitre Val RH', 'Mitre Val RH');
    mapv('Mixed Slats', 'Mixed Slats'); mapv('Ladder Tape', 'Ladder Tape'); mapv('Ladder Tape Colour', 'Ladder Tape Colour');
    const hd = biqLc(raw['Hold Downs'] || '');
    if (/magnet/.test(hd)) biqSetVar(it.variants, 'Hold Downs Magnetic', 'Yes');
    else if (/clip/.test(hd)) biqSetVar(it.variants, 'Hold Downs Clip In', 'Yes');
    const lcut = [cleanVal(raw['Left Cutout Drop from Bottom']), cleanVal(raw['Left Cutout Width'])].filter(Boolean).join(' x ');
    const rcut = [cleanVal(raw['Right Cutout Drop from Bottom']), cleanVal(raw['Right Cutout Width'])].filter(Boolean).join(' x ');
    if (lcut) biqSetVar(it.variants, 'Cut Out LH', lcut);
    if (rcut) biqSetVar(it.variants, 'Cut Out RH', rcut);
    ['Second Colour', 'Additional Colour', 'Third Colour'].forEach(k => { const v = cleanVal(raw[k]); if (v && biqLc(v) !== 'standard') it.notes = (it.notes ? it.notes + ' | ' : '') + k + ': ' + v; });
}
// Shutter line (Blind Guys BD1-SHUT "Supply Sheet"). Range is derived from the panel count
// ("1 Panel" -> "1 Panel Hinged"), which matches BlindIQ's shutter range names.
function biqBgShutter(mappings, o, it, raw) {
    it.width = raw['Width'] || raw['Finished Width'] || ''; it.drop = raw['Height'] || raw['Finished Height'] || '';
    it.fix = raw['Fixing'] || '';
    it.blindType = biqNorm((raw['Shutter Type'] || 'Urban Hinged') + ' Shutter');
    it.colour = raw['Colours'] || raw['Colour'] || '';
    it.controlDrop = '0';
    const panels = (raw['No. of Panels'] || '').match(/\d+/);
    if (panels) {
        const tier = /tier/i.test(raw['Style'] || raw['Configuration'] || '');
        it.range = panels[0] + ' Panel Hinged' + (tier ? ' Tier on Tier' : '');
    }
    it.variants = biqTemplateFor2(mappings, it.blindType);
    const spec = biqVariantSpec(mappings, it.blindType) || [];
    const keys = spec.map(s => s.k);
    const findOpt = col => { const c = biqLc(col); return keys.find(k => biqLc(k) === c) || keys.find(k => biqLc(k).startsWith(c + ' (')); };
    const reb = { 'left over right': 'LH over RH', 'right over left': 'RH over LH' };
    const skip = new Set(['Item #', 'Location', 'Width', 'Height', 'Finished Width', 'Finished Height', 'Qty', 'Shutter Type', 'Colours', 'Colour', 'Fixing', 'No. of Panels', 'Style', 'Configuration', 'Frame', 'Hinge Type', 'Top Track', 'Bottom Track', 'Line Notes']);
    for (const [col, v] of Object.entries(raw)) {
        if (skip.has(col)) continue;
        let cv = cleanVal(v); if (!cv) continue;
        if (biqLc(col) === 'rebate' && reb[biqLc(cv)]) cv = reb[biqLc(cv)];
        const k = findOpt(col); if (k) biqSetVar(it.variants, k, cv);
    }
    // keep the workshop-relevant descriptors that aren't BlindIQ options
    const desc = ['No. of Panels', 'Configuration', 'Style'].map(k => cleanVal(raw[k])).filter(Boolean);
    if (desc.length) it.notes = (it.notes ? it.notes + ' | ' : '') + desc.join(' | ');
}
export function biqNormalizeBlindGuys(mappings, p) {
    const o = biqBlankOrder();
    const kind = p.kind || (p.doubleRoller ? 'doubleRoller' : 'roller');
    o.source = 'blindguys'; o.sourceDesc = 'Blind Guys order sheet (' + kind + ')';
    o.customer = p.meta.company; o.orderNumber = p.meta.orderNumber; o.client = p.meta.customerName;
    o.orderDate = biqParseDate(p.meta.orderDate); o.address = p.meta.address;
    o.notes = p.meta.rep ? ('Sales rep: ' + p.meta.rep) : '';
    let express = false;
    p.items.forEach(raw => {
        const it = biqBlankItem(raw['Item #'] || '');
        it.qty = raw['Qty'] || '1'; it.location = raw['Location'] || '';
        if (kind === 'shutter') biqBgShutter(mappings, o, it, raw);
        else if (kind === 'venetian') biqBgVenetian(mappings, o, it, raw);
        else biqBgRoller(mappings, o, it, raw, kind === 'doubleRoller', p.meta.product);
        if (biqLc(raw['Express']) === 'yes') express = true;
        if (raw['Line Notes']) it.notes = (it.notes ? it.notes + ' | ' : '') + raw['Line Notes'];
        o.items.push(it);
    });
    if (express) o.notes = (o.notes ? o.notes + ' | ' : '') + 'EXPRESS (3 day delivery) +10%';
    return o;
}

// ---------- Mathéo PDF (textItems = [{s,x,y}] from pdf.js getTextContent) ----------
export function biqParseMatheoItems(textItems) {
    const items = textItems.filter(i => i.s.trim());
    const lineMap = {};
    items.forEach(i => { const k = Math.round(i.y / 3) * 3; (lineMap[k] = lineMap[k] || []).push(i); });
    const ys = Object.keys(lineMap).map(Number).sort((a, b) => b - a);
    const lines = ys.map(y => ({ y, parts: lineMap[y].sort((a, b) => a.x - b.x) }));
    const fullText = lines.map(l => l.parts.map(p => p.s).join(' ')).join('\n');
    if (!/math.o|matheoblinds/i.test(fullText)) return null;
    const meta = {};
    let m = fullText.match(/PO#:\s*(\S+)/); if (m) meta.po = m[1];
    m = fullText.match(/Quote #\s*:\s*(\S+)/); if (m) meta.quote = m[1];
    m = fullText.match(/Job #\s*:\s*(\S+)/); if (m) meta.job = m[1];
    m = fullText.match(/Date\s*:\s*([A-Za-z]*,?\s*\d{1,2}\s+[A-Za-z]+\s+\d{2,4})/); if (m) meta.orderDate = m[1].trim();
    const compLine = fullText.split('\n').find(l => /math.o\s*blinds/i.test(l) && !/@|phone|e-mail/i.test(l));
    if (compLine) meta.company = biqNorm(compLine);
    m = fullText.match(/Name\s*:\s*([A-Za-zÀ-ž'\- ]+?)\s+Tel/i); if (m) meta.customerName = biqNorm(m[1]);
    m = fullText.match(/BD\s+(Roller Blind|Outdoor Free Hang|Urban Shutter|Vision|Wood|Cellular|Double Roller)[A-Za-z ]*/i); if (m) meta.product = biqNorm(m[0]);
    // header row: tolerate split words ("Locatio"+"n") — match on '#' + Location/Price prefixes
    const hl = lines.find(l => { const t = l.parts.map(p => p.s.trim()); return t.includes('#') && t.some(s => /^locatio/i.test(s)) && t.some(s => /^price/i.test(s)); });
    if (!hl) return null;
    const cols = hl.parts.map(p => ({ name: biqNorm(p.s), x: p.x }));
    const hi = lines.indexOf(hl);
    for (let k = 1; k <= 3; k++) {
        const l2 = lines[hi + k]; if (!l2) break;
        if (l2.parts.some(p => /^\d+$/.test(p.s.trim())) && l2.parts[0].x < cols[1].x) break;
        let used = false;
        l2.parts.forEach(p => {
            let best = null, bd = 1e9; cols.forEach(c => { const d = Math.abs(c.x - p.x); if (d < bd) { bd = d; best = c; } });
            if (best && bd < 30) { best.name = biqNorm(best.name + ' ' + p.s); used = true; }
        });
        if (!used) break;
    }
    cols.forEach(c => { c.name = c.name.replace(/\s+([a-z])$/, '$1'); });
    const rowsOut = []; let cur = null;
    const assign = (row, p) => {
        let best = -1, bd = 1e9; cols.forEach((c, ci) => { const d = p.x - c.x; if (d >= -12 && Math.abs(d) < bd) { bd = Math.abs(d); best = ci; } });
        if (best < 0) best = 0; const key = cols[best].name;
        const s = p.s.trim();
        row[key] = row[key] ? (s.length <= 2 ? row[key] + s : row[key] + ' ' + s) : s;
    };
    for (let li = hi + 1; li < lines.length; li++) {
        const l = lines[li]; const first = l.parts[0]; const joined = l.parts.map(p => p.s).join(' ');
        if (/Sub Total|Grand Total|Discount|Vat\(|Rounding|Page \d/i.test(joined)) { if (/Sub Total|Grand Total/i.test(joined)) break; else continue; }
        if (/^\d+$/.test(first.s.trim()) && first.x < cols[1].x) { cur = {}; rowsOut.push(cur); l.parts.forEach(p => assign(cur, p)); }
        else if (cur) { l.parts.forEach(p => assign(cur, p)); }
    }
    return { meta, rows: rowsOut };
}
export function biqNormalizeMatheo(mappings, p) {
    const o = biqBlankOrder();
    o.source = 'matheo'; o.sourceDesc = 'Mathéo order sheet';
    o.customer = p.meta.company || 'Mathéo Blinds & Awnings';
    o.orderNumber = p.meta.po || p.meta.quote || ''; o.client = p.meta.customerName || '';
    o.orderDate = biqParseDate(p.meta.orderDate);
    o.notes = [p.meta.quote ? ('Quote ' + p.meta.quote) : '', p.meta.job ? ('Job ' + p.meta.job) : ''].filter(Boolean).join(' | ');
    // map the "BD ..." title to a BlindIQ blind type (the per-row "Type" is a price group, not a type)
    const tp = biqLc(p.meta.product || '');
    const titleType = /outdoor/.test(tp) ? 'Outdoor Free Hang' : /urban shutter|shutter/.test(tp) ? 'Urban Hinged Shutter'
        : /vision/.test(tp) ? 'Element Vision' : /wood/.test(tp) ? 'Element Wood' : /cellular/.test(tp) ? 'Cellular Skylight Lantern'
            : /double roller/.test(tp) ? 'Double Roller Blinds' : /roller/.test(tp) ? 'Element Roller Sys 40' : '';
    p.rows.forEach(raw => {
        const it = biqBlankItem(raw['#'] || '');
        it.qty = '1'; it.location = raw['Location'] || '';
        it.width = raw['Width'] || ''; it.drop = raw['Height'] || '';
        it.blindType = titleType || raw['Type'] || '';
        if (titleType && raw['Type']) it.notes = (it.notes ? it.notes + ' | ' : '') + raw['Type'];   // keep the price group as a note
        let mat = biqNorm(raw['Material'] || '');
        let rng = mat;
        if (!biqResolveRange(mappings, it.blindType, rng).known) {
            for (const re of [/^bd\s+element\s+/i, /^bd\s*e\s+/i, /^bd\s+/i, /^element\s+/i]) {
                const s = biqNorm(mat.replace(re, ''));
                if (s && s !== mat && biqResolveRange(mappings, it.blindType, s).known) { rng = s; break; }
            }
        }
        it.range = rng; it.colour = raw['Colour'] || '';
        it.fix = raw['Fix'] || '';
        const ctl = biqLc(raw['Controls'] || '');
        if (ctl.includes('rh') && ctl.includes('chain')) { it.control1 = 'Lh Pin'; it.control2 = 'Rh Chain'; }
        else if (ctl.includes('lh') && ctl.includes('chain')) { it.control1 = 'Lh Chain'; it.control2 = 'Rh Pin'; }
        else if (ctl.includes('motor')) { it.control1 = raw['Controls']; it.control2 = ''; }
        else { it.control1 = raw['Controls'] || ''; }
        { const cd = biqNorm(raw['Control Drop'] || '');
          it.controlDrop = biqComputeControlDropV2(mappings, /^\d/.test(cd) ? cd : '', it.drop, it.blindType, it.range);
          it._cdAuto = !/^\d/.test(cd); }
        it.variants = biqTemplateFor2(mappings, it.blindType || 'roller');
        const mv = (src, key) => { const v = cleanVal(raw[src]); if (v) biqSetVar(it.variants, key, v); };
        mv('H/ware Colour', 'Mech Colour');
        mv('Bottom Bar', 'Bottom Bar');
        mv('Roll Type', 'Roll Type');
        if (/steel/i.test(raw['Chain'] || '')) biqSetVar(it.variants, 'Steel Ball Chain', 'Yes');
        if (/yes/i.test(raw['Cord Tidy'] || '')) biqSetVar(it.variants, 'Chain Tidy', 'Yes');
        mv('Cassette', 'Sys 40 70mm Cassette');
        mv('Fabric Insert 70mm Cassette', 'Fabric Insert for 70mm Cassette');
        mv('Side Channels', 'Side Channels');
        if (cleanVal(raw['Bracket Covers'])) biqSetVar(it.variants, 'Remove Bracket Covers', cleanVal(raw['Bracket Covers']));
        mv('System Change', 'System Change');
        o.items.push(it);
    });
    return o;
}

// ---------- Blind Designs fillable form PDF (fields = {name: value} from pdf.js annotations) ----------
export function biqParseBDFields(fields) {
    if (!('Company Name' in fields) && !('Order Number' in fields)) return null;
    const meta = {
        customerName: biqNorm(fields['Company Name']), contact: biqNorm(fields['Contact Name']),
        orderNumber: biqNorm(fields['Order Number']), orderDate: biqNorm(fields['Date']),
        requiredDate: biqNorm(fields['Required Date']), deliveryMethod: biqNorm(fields['Delivery Method']),
        deliveryAddress: String(fields['Delivery Address'] || '').replace(/\r\n?/g, '\n').trim(),
        phone: biqNorm(fields['Phone']), email: biqNorm(fields['Email']), notes: biqNorm(fields['Order Notes']),
        express: !isOff(fields['Express'])
    };
    const bases = ['Blind Type', 'Control Drop', 'Valance Return', 'Valance Size', 'Val Type', 'Cut Left', 'Cut Right', 'Wire Guides', 'Quantity', 'Location', 'Range', 'Colour', 'Width', 'Drop', 'Control', 'Fixing', 'Hardware'];
    const rows = {};
    for (const [name, val] of Object.entries(fields)) {
        if (isOff(val)) continue;
        if (/^Option\s+[A-O]\d+$/.test(name)) continue; // handled via the decoded option grid
        for (const b of bases) {
            if (name === b || name.startsWith(b)) {
                let rest = name.slice(b.length).replace(/\s+/g, ' ').trim();
                if (b === 'Control' && /^Drop/.test(rest)) continue;
                const mm = rest.match(/^([A-O])?\s*(\d+)?$/); if (!mm) break;
                const rowKey = mm[2] ? mm[2] : (mm[1] || 'A');
                (rows[rowKey] = rows[rowKey] || {})[b] = biqNorm(val);
                break;
            }
        }
    }
    const ordered = Object.keys(rows).sort((a, b) => {
        const an = /^\d+$/.test(a), bn = /^\d+$/.test(b);
        if (an && bn) return a - b; if (an) return 1; if (bn) return -1; return a.localeCompare(b);
    });
    const items = [];
    ordered.forEach(k => {
        const r = rows[k];
        if (r['Width'] || r['Drop'] || r['Range'] || r['Colour'] || r['Location'] || r['Quantity']) items.push(Object.assign({ row: k }, r));
    });
    return { meta, items };
}
const BD_ROW_SEQUENCE = ['A','B','C','D','E','F','G','8','9','10','11','12','13','14','15'];
export function biqNormalizeBDForm(mappings, p, gridByRow) {
    const o = biqBlankOrder();
    o.source = 'bdform'; o.sourceDesc = 'Blind Designs order form';
    o.customer = p.meta.customerName; o.orderNumber = p.meta.orderNumber;
    o.client = p.meta.contact ? (p.meta.contact + (p.meta.phone ? ' ' + p.meta.phone : '')) : '';
    o.orderDate = biqParseDate(p.meta.orderDate); o.requiredDate = biqParseDate(p.meta.requiredDate);
    o.deliveryMethod = p.meta.deliveryMethod; o.address = p.meta.deliveryAddress; o.notes = p.meta.notes;
    if (p.meta.express) o.notes = (o.notes ? o.notes + ' | ' : '') + 'EXPRESS (3 day delivery) +10%';
    let idx = 0;
    p.items.forEach(raw => {
        const it = biqBlankItem(String.fromCharCode(97 + (idx++)));
        it.qty = raw['Quantity'] || '1'; it.location = raw['Location'] || '';
        it.blindType = raw['Blind Type'] || ''; it.range = raw['Range'] || ''; it.colour = raw['Colour'] || '';
        it.width = raw['Width'] || ''; it.drop = raw['Drop'] || '';
        it.fix = raw['Fixing'] || '';
        const side = biqLc(raw['Control'] || '');
        const isVen = /venetian|wood|cellular/.test(biqLc(it.blindType));
        if (isVen) { it.control1 = raw['Control'] || ''; }
        else if (side === 'left') { it.control1 = 'Lh Chain'; it.control2 = 'Rh Pin'; }
        else if (side === 'right') { it.control1 = 'Lh Pin'; it.control2 = 'Rh Chain'; }
        else { it.control1 = raw['Control'] || ''; }
        { const cd = biqNorm(raw['Control Drop'] || '');
          it.controlDrop = biqComputeControlDropV2(mappings, /^\d/.test(cd) ? cd : '', it.drop, it.blindType, it.range);
          it._cdAuto = !/^\d/.test(cd); }
        it.variants = biqTemplateFor2(mappings, it.blindType);
        if (cleanVal(raw['Hardware'])) biqSetVar(it.variants, isVen ? 'Hardware' : 'Mech Colour', cleanVal(raw['Hardware']));
        if (cleanVal(raw['Valance Size'])) biqSetVar(it.variants, 'Val Size', cleanVal(raw['Valance Size']));
        if (cleanVal(raw['Valance Return'])) biqSetVar(it.variants, 'Val Returns', cleanVal(raw['Valance Return']));
        if (cleanVal(raw['Val Type'])) biqSetVar(it.variants, 'Val Type', cleanVal(raw['Val Type']));
        if (cleanVal(raw['Cut Left'])) biqSetVar(it.variants, 'Cut Out LH', cleanVal(raw['Cut Left']));
        if (cleanVal(raw['Cut Right'])) biqSetVar(it.variants, 'Cut Out RH', cleanVal(raw['Cut Right']));
        if (cleanVal(raw['Wire Guides'])) biqSetVar(it.variants, 'Wire Side Guides', cleanVal(raw['Wire Guides']));
        (raw.options || []).forEach(opt => { const [k, v] = opt.split('='); biqSetVar(it.variants, k, v || 'Yes'); });
        if (gridByRow) {
            const pos = BD_ROW_SEQUENCE.indexOf(String(raw.row));
            const letter = pos >= 0 ? 'ABCDEFGHIJKLMNO'[pos] : String(raw.row);
            (gridByRow[letter] || []).forEach(([k, v]) => biqSetVar(it.variants, k, v));
        }
        o.items.push(it);
    });
    return o;
}

// ---------- text-PDF helpers (group pdf.js text items into lines) ----------
function biqGroupLines(textItems) {
    const items = (textItems || []).filter(i => i.s && i.s.trim());
    const map = {};
    items.forEach(i => { const k = Math.round(i.y / 3) * 3; (map[k] = map[k] || []).push({ s: i.s, x: i.x }); });
    return Object.keys(map).map(Number).sort((a, b) => b - a).map(y => ({ y, parts: map[y].sort((a, b) => a.x - b.x) }));
}

// ---------- Lifestyle Blinds PDF (uniform table; product/colour encoded in Description) ----------
export function biqParseLifestyle(textItems) {
    const lines = biqGroupLines(textItems);
    const full = lines.map(l => l.parts.map(p => p.s).join(' ')).join('\n');
    if (!/lifestyleblinds/i.test(full) && !(/PURCHASE ORDER/i.test(full) && /AUTONEER/i.test(full))) return null;
    const meta = {};
    let m = full.match(/Number:\s*([A-Z]{0,4}\s?\d{3,})/i); if (m) meta.orderNumber = biqNorm(m[1]);
    m = full.match(/Date:\s*(\d{4}\/\d{2}\/\d{2})/); if (m) meta.orderDate = m[1];
    const hl = lines.find(l => { const t = l.parts.map(p => biqLc(p.s)); return t.includes('description') && t.some(s => /qty/.test(s)) && t.some(s => /location/.test(s)); });
    if (!hl) return null;
    const cx = {};
    hl.parts.forEach(p => { const n = biqLc(p.s); if (/description/.test(n)) cx.qty0 = p.x; if (/qty/.test(n)) cx.qty = p.x; else if (/mount/.test(n)) cx.mount = p.x; else if (/width/.test(n)) cx.width = p.x; else if (/drop/.test(n)) cx.drop = p.x; else if (n === 'c') cx.c = p.x; else if (/location/.test(n)) cx.location = p.x; else if (/cost/.test(n)) cx.cost = p.x; });
    const cols = [['qty', cx.qty], ['mount', cx.mount], ['width', cx.width], ['drop', cx.drop], ['c', cx.c], ['location', cx.location], ['cost', cx.cost]].filter(c => c[1] != null);
    const descMax = cx.qty - 20;
    const rows = [];
    for (let li = lines.indexOf(hl) + 1; li < lines.length; li++) {
        const joined = lines[li].parts.map(p => p.s).join(' ');
        if (/Total Incl|Terms and Conditions|hereby accept|Designed by|Call\s+relevant/i.test(joined)) break;
        const row = { desc: '' };
        lines[li].parts.forEach(p => {
            if (p.x < descMax) { row.desc = (row.desc ? row.desc + ' ' : '') + p.s; return; }
            let best = null, bd = 1e9; cols.forEach(([n, x]) => { const d = Math.abs(p.x - x); if (d < bd) { bd = d; best = n; } });
            if (best) row[best] = (row[best] ? row[best] + ' ' : '') + biqNorm(p.s);
        });
        row.desc = biqNorm(row.desc);
        if (row.desc) rows.push(row);
    }
    return { meta, rows };
}
// "ELEMENT ROLLER 5 SCREEN - DUNE GREY" -> {blindType, range, colour}
export function biqLifestyleDesc(desc) {
    const segs = desc.split(/\s+-\s*|\s-(?=[A-Za-z])/).map(s => biqNorm(s)).filter(Boolean);
    let colour = '', pr = desc;
    if (segs.length >= 2) { colour = segs[segs.length - 1]; pr = segs.slice(0, -1).join(' - '); }
    const prl = biqLc(pr);
    let blindType = '', range = '';
    if (/vertical/.test(prl)) { blindType = 'Vertical Blind'; range = biqNorm(pr.replace(/\d+\s*mm/i, '').replace(/vertical/i, '').replace(/-/g, ' ')); }
    else if (/venetian|wood/.test(prl)) { blindType = 'Element Wood'; range = biqNorm(pr.replace(/^\d+\s*mm\s*/i, '')); }
    else if (/roller|screen|filter|block|chatsworth/.test(prl)) { blindType = 'Element Roller Sys 40'; range = biqNorm(pr.replace(/^(bd\s*-?\s*)?(element\s+)?roller\s*/i, '')); }
    else { blindType = pr; }
    return { blindType, range, colour };
}
export function biqNormalizeLifestyle(mappings, p) {
    const o = biqBlankOrder();
    o.source = 'lifestyle'; o.sourceDesc = 'Lifestyle Blinds order';
    o.customer = 'Lifestyle Blinds'; o.orderNumber = p.meta.orderNumber || ''; o.orderDate = biqParseDate(p.meta.orderDate);
    let express = false, n = 0;
    p.rows.forEach(r => {
        const dl = biqLc(r.desc);
        const hasDim = /\d{3,}/.test((r.width || '') + ' ' + (r.drop || ''));
        if (/^express/.test(dl)) { express = true; return; }
        // valances, brackets, cut-out specs and any dimensionless free-text are not blinds -> notes
        if (/valance|specification|cut\s*out|bracket/.test(dl) || !hasDim) { o.notes = (o.notes ? o.notes + ' | ' : '') + r.desc; return; }
        const it = biqBlankItem(String(++n));
        it.qty = r.qty || '1'; it.location = r.location || ''; it.width = r.width || ''; it.drop = r.drop || '';
        it.fix = r.mount || '';
        const cs = biqLc(r.c || '');
        if (cs === 'l') { it.control1 = 'Lh Chain'; it.control2 = 'Rh Pin'; }
        else if (cs === 'r') { it.control1 = 'Lh Pin'; it.control2 = 'Rh Chain'; }
        const d = biqLifestyleDesc(r.desc);
        it.blindType = d.blindType; it.range = d.range; it.colour = d.colour;
        it.controlDrop = biqComputeControlDropV2(mappings, '', it.drop, it.blindType, it.range); it._cdAuto = true;
        it.variants = biqTemplateFor2(mappings, it.blindType || 'roller');
        o.items.push(it);
    });
    if (express) o.notes = (o.notes ? o.notes + ' | ' : '') + 'EXPRESS ORDER (5 working days)';
    return o;
}

// ---------- Curtain & Blind Workshop PDF (per-product column table) ----------
const BIQ_CNBW_COLS = {
    roller: [['numloc', 60], ['qnty', 158], ['window', 200], ['width', 225], ['dropctl', 248], ['chain', 335], ['fixing', 383], ['fabric', 433], ['colour', 517]],
    outdoor: [['numloc', 55], ['qnty', 115], ['window', 159], ['width', 178], ['dropctl', 206], ['fixing', 295], ['motor', 344], ['fabric', 424], ['colour', 579]],
    shutter: [['numloc', 71], ['qnty', 186], ['window', 231], ['width', 283], ['dropctl', 312], ['fixing', 426], ['shutter', 479], ['colour', 600], ['frame', 651]]
};
export function biqParseCnbw(textItems) {
    const lines = biqGroupLines(textItems);
    const full = lines.map(l => l.parts.map(p => p.s).join(' ')).join('\n');
    if (!/curtain and blind workshop|cnbw\.co\.za|goldcut/i.test(full)) return null;
    const meta = {};
    let m = full.match(/Order number:?\s*([^\n]+?)(?:\s{2,}|Date|Phone|Email|$)/i); if (m) meta.orderNumber = biqNorm(m[1]);
    m = full.match(/Date:?\s*(\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4})/i); if (m) meta.orderDate = biqNorm(m[1]);
    const hl = lines.find(l => { const t = l.parts.map(p => biqLc(p.s)); return t.includes('num') && t.some(s => /location/.test(s)) && t.some(s => /width/.test(s)); });
    if (!hl) return null;
    const heads = hl.parts.map(p => biqLc(p.s));
    let product = 'roller';
    if (heads.some(h => /shutter/.test(h))) product = 'shutter';
    else if (heads.some(h => /motorised/.test(h))) product = 'outdoor';
    const cols = BIQ_CNBW_COLS[product];
    const rows = [];
    for (let li = lines.indexOf(hl) + 1; li < lines.length; li++) {
        const parts = lines[li].parts; const joined = parts.map(p => p.s).join(' ');
        if (/Notes:|Sign:|Please tick|Special instructions/i.test(joined)) break;
        if (!parts.length || !/^\d/.test(biqNorm(parts[0].s))) continue;        // data rows start with a number
        const row = {};
        const put = (k, v) => { v = biqNorm(v); if (v) row[k] = row[k] ? row[k] + ' ' + v : v; };
        parts.forEach(p => {
            let best = null, bd = 1e9; cols.forEach(([n, x]) => { const d = Math.abs(p.x - x); if (d < bd) { bd = d; best = n; } });
            put(best, p.s);
        });
        // split the two merged fragments
        if (row.numloc) { const mm = row.numloc.match(/^(\S+)\s+(.+)$/); if (mm) { row.num = mm[1]; row.location = mm[2]; } else row.num = row.numloc; }
        if (row.dropctl) { const mm = row.dropctl.match(/^(\d+)\s+(.+)$/); if (mm) { row.drop = mm[1]; row.control = mm[2]; } else row.drop = row.dropctl; }
        rows.push(row);
    }
    return { meta, product, rows };
}
export function biqNormalizeCnbw(mappings, p) {
    const o = biqBlankOrder();
    o.source = 'cnbw'; o.sourceDesc = 'Curtain & Blind Workshop order (' + p.product + ')';
    o.customer = 'Curtain and Blind Workshop'; o.orderNumber = p.meta.orderNumber || ''; o.orderDate = biqParseDate(p.meta.orderDate);
    let n = 0;
    p.rows.forEach(r => {
        const it = biqBlankItem(String(++n));
        it.qty = r.qnty || '1'; it.location = r.location || ''; it.width = r.width || ''; it.drop = r.drop || '';
        it.fix = r.fixing || '';
        const ctl = biqLc(r.control || '');                                     // "left control" / "right motor" / "left"/"right"
        const side = /left/.test(ctl) ? 'L' : (/right/.test(ctl) ? 'R' : '');
        const drive = /motor/.test(ctl) ? 'Motor' : 'Chain';
        if (side === 'L') { it.control1 = 'Lh ' + drive; it.control2 = 'Rh Pin'; }
        else if (side === 'R') { it.control1 = 'Lh Pin'; it.control2 = 'Rh ' + drive; }
        if (p.product === 'shutter') {
            it.blindType = 'Urban Hinged Shutter';
            it.colour = r.colour || '';
            const pan = (r.shutter || '').match(/(\d+)\s*panel/i);
            if (pan) it.range = pan[1] + ' Panel Hinged';
            it.controlDrop = '0';
            it.variants = biqTemplateFor2(mappings, it.blindType);
            if (cleanVal(r.frame)) it.notes = (it.notes ? it.notes + ' | ' : '') + 'Frame: ' + cleanVal(r.frame);
        } else {
            it.blindType = p.product === 'outdoor' ? 'Outdoor Free Hang' : 'Element Roller Sys 40';
            const fab = biqNorm((r.fabric || '').replace(/\b(outdoor\s+)?blind\b/ig, ''));
            const f = biqSplitFabric(mappings, fab + (r.colour ? ' ' + r.colour : ''), it.blindType);
            if (f.range && f.colour) { it.range = f.range; it.colour = f.colour; }
            else { it.range = fab; it.colour = r.colour || ''; }
            it._origFabric = fab;
            it.controlDrop = biqComputeControlDropV2(mappings, '', it.drop, it.blindType, it.range); it._cdAuto = true;
            it.variants = biqTemplateFor2(mappings, it.blindType);
            if (p.product === 'outdoor' && cleanVal(r.motor)) biqAddMotorSundry(mappings, o, cleanVal(r.motor), +it.qty || 1);
            if (p.product === 'roller' && /standard|waterfall/i.test(r.chain || '')) biqSetVar(it.variants, 'Roll Type', biqNorm(r.chain));
        }
        o.items.push(it);
    });
    return o;
}

// Sanity-check a deterministic CnBW parse. Their templates vary (column order, merged cells);
// if a layout doesn't map cleanly we'd rather hand it to AI than emit confident-but-wrong data.
// Coherent = most items have a real width and a fix that resolves (reveal/face, incl. aliases).
export function biqCnbwCoherent(mappings, order) {
    if (!order || !order.items.length) return false;
    let good = 0;
    order.items.forEach(it => {
        const w = parseInt(it.width, 10) || 0;
        const fixOk = it.fix && biqResolve(mappings, 'fixes', it.fix).known;
        if (w > 0 && fixOk) good++;
    });
    return good >= Math.ceil(order.items.length / 2);
}

// ---------- Total Blind Designs ordering software PDF ----------
// TBD licence this software to dealers, so the letterhead varies (Total Blind Design,
// Galaxy Blinds, ...) and the heading is "<X> ORDER" (BLINDS / OUTDOOR). Detection therefore
// keys off the layout signature — the Item/Location/Qty/Description column header plus the
// "Options:" lines — and never off the company name.
// The software already emits BlindIQ-shaped "Key=Value | Key=Value" options, so options pass
// through almost 1:1; only the TBD-only keys (Left End / Right End / Joined To) are consumed
// here, into controls and the shared-bracket pairing.
const BIQ_TBD_TYPES = [
    [/^free\s*hang/i, 'Outdoor Free Hang'], [/^channel\s*x/i, 'Outdoor Channel X'],
    [/^wire\s*x/i, 'Outdoor Wire X'], [/^zip\s*x/i, 'Outdoor Zip X'],
    [/^widescreen/i, 'Outdoor Widescreen'], [/^double\s*roller/i, 'Element Double Roller'],
    [/^roller\s*40/i, 'Element Roller Sys 40'], [/^roller\s*45/i, 'Roller System 45'],
    [/^roller\s*55/i, 'Roller System 55'], [/^romashade/i, 'RomaShade'],
    [/^perfect\s*fit\s*roller/i, 'Perfect Fit Roller Blind'],
    [/^perfect\s*fit\s*cellular/i, 'Perfect Fit Cellular Blind'],
    [/^perfect\s*fit\s*vision/i, 'Perfect Fit Vision Blind'],
    [/^vision/i, 'Element Vision'], [/^wood\s*alloy/i, 'Element Wood'],
    [/^wood\s*venetian/i, 'Element Wood'], [/^35\s*mm\s*alum/i, 'Element 35mm Aluminium'],
    [/^cellular/i, 'Cellular Free Hang'], [/^(90\s*mm\s*)?vertical/i, '90mm Vertical Blind'],
    [/^allusion/i, 'Allusion Blind'], [/^(urban\s*hinged|shutter)/i, 'Urban Hinged Shutter']
];
// TBD prints some products under their exact BlindIQ name (Retro Venetian, Roman Panel,
// Sliding Panel, Element Valance, Allusion Blind...) — those need no alias and pass through.
// "50mm Wood" / "50mm Wood Alloy" are slat descriptions, not BlindIQ ranges.
const BIQ_TBD_WOOD_RANGES = [[/woodgrain/i, 'Wood Alloy Woodgrain Classic'], [/alloy/i, 'Wood Alloy Std Classic'], [/wood/i, 'Classic']];
const BIQ_TBD_DRIVE = [[/mtr|motor/i, 'Motor'], [/crank/i, 'Crank'], [/spring/i, 'Spring'],
[/coupl/i, 'Coupled'], [/\bint/i, 'Intermediate'], [/chain/i, 'Chain'], [/pin/i, 'Pin'],
[/wand/i, 'Wand'], [/cord/i, 'Cord']];
function biqTbdDrive(s) { const t = biqLc(s || ''); for (const [re, v] of BIQ_TBD_DRIVE) if (re.test(t)) return v; return ''; }

export function biqParseTbd(textItems) {
    const lines = biqGroupLines(textItems);
    const full = lines.map(l => l.parts.map(p => p.s).join(' ')).join('\n');
    if (!/\bORDER\b/i.test(full) || !/Options:/i.test(full)) return null;
    const isHeader = l => {
        const t = l.parts.map(p => biqLc(p.s));
        return t.includes('item') && t.includes('location') && t.includes('qty') && t.includes('description');
    };
    const hl = lines.find(isHeader);
    if (!hl) return null;
    const cx = {};
    hl.parts.forEach(p => {
        const n = biqLc(p.s);
        if (n === 'item') cx.item = p.x; else if (/location/.test(n)) cx.location = p.x;
        else if (/qty/.test(n)) cx.qty = p.x; else if (/description/.test(n)) cx.desc = p.x;
        // pdf.js emits this header as one item ("W × D"); other extractors split it into W / × / D
        else if (/colou?r/.test(n)) cx.colour = p.x; else if (/^w(\s*[×x]\s*d)?$/.test(n)) cx.dim = p.x;
        else if (/^fix/.test(n)) cx.fix = p.x; else if (/control/.test(n)) cx.ctl = p.x;
        else if (/price/.test(n)) cx.price = p.x;
    });
    if (cx.item == null || cx.desc == null || cx.dim == null) return null;
    // x-bands from the header anchors (midpoints), so a value never lands in the wrong column
    const order = ['item', 'location', 'qty', 'desc', 'colour', 'dim', 'fix', 'ctl', 'price']
        .filter(k => cx[k] != null).map(k => [k, cx[k]]).sort((a, b) => a[1] - b[1]);
    const bandOf = x => {
        for (let i = 0; i < order.length; i++) {
            const next = order[i + 1];
            if (!next || x < (order[i][1] + next[1]) / 2) return order[i][0];
        }
        return order[order.length - 1][0];
    };
    // Diagonal watermarks ("FINAL MEASURED"). pdf.js — which is what the app uses — delivers
    // these as one whole string, so match the phrase. Word-level extractors instead scatter them
    // as lone capitals; those are only discarded when far from EVERY column, because real cell
    // text always aligns to a column and the "X" of "Channel X" is a lone capital too.
    const nearestCol = x => Math.min.apply(null, order.map(c => Math.abs(x - c[1])));
    const BIQ_TBD_WM = /^(final\s*measured?|sample|draft|copy|provisional|not\s*final|duplicate)$/i;
    const isWm = p => {
        const t = biqNorm(p.s);
        return BIQ_TBD_WM.test(t) || (/^[A-Z]$/.test(t) && nearestCol(p.x) > 60);
    };

    const meta = {};
    let m = full.match(/^[ \t]*Name:\s*(.*)$/mi);
    if (m) {                                                            // Name and Project share a line
        meta.client = biqNorm(m[1].replace(/\s*Project:.*$/i, ''));
        const pm = m[1].match(/Project:\s*(.*)$/i);
        if (pm) meta.project = biqNorm(pm[1]);
    }
    m = full.match(/Date:\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4})/i); if (m) meta.orderDate = m[1];
    m = full.match(/Rep:\s*(\S+@\S+)/i); if (m) meta.rep = m[1];
    const hIdx = lines.findIndex(l => /^[A-Z][A-Z ]*ORDER$/.test(biqNorm(l.parts.map(p => p.s).join(' '))));
    if (hIdx >= 0) {
        meta.docType = biqNorm(lines[hIdx].parts.map(p => p.s).join(' '));
        if (lines[hIdx + 1]) meta.company = biqNorm(lines[hIdx + 1].parts.map(p => p.s).join(' '));
    }

    const rows = [];
    let cur = null, mode = '';
    for (let li = lines.indexOf(hl) + 1; li < lines.length; li++) {
        const L = lines[li];
        if (isHeader(L)) { mode = ''; continue; }                       // header repeats on later pages
        const parts = L.parts.filter(p => !isWm(p));
        if (!parts.length) continue;
        const joined = biqNorm(parts.map(p => p.s).join(' '));
        if (/^(sub\s*total|vat\b|total\b)/i.test(joined)) { cur = null; mode = ''; continue; }
        if (/^Options:/i.test(joined)) {
            if (cur) { cur.options = biqNorm(joined.replace(/^Options:\s*/i, '')); mode = 'opt'; }
            continue;
        }
        const first = parts[0];
        const isItem = /^[A-Z]$/.test(biqNorm(first.s)) && Math.abs(first.x - cx.item) <= 20
            && parts.some(p => /\d/.test(p.s) && Math.abs(p.x - cx.dim) < 80);
        if (isItem) {
            cur = { code: biqNorm(first.s), desc: [], options: '' };
            const bag = {};
            parts.slice(1).forEach(p => {
                let b = bandOf(p.x);
                // the dimension cell only ever holds "NNNN × NNNN"; free text landing there is a
                // colour overflowing its column ("White /Dune Grey" pushes past the boundary)
                const t = biqNorm(p.s);
                // the dimension cell is either a whole "1455 × 1210" (pdf.js) or its separate
                // pieces; anything else landing there is a colour overflowing its column
                if (b === 'dim' && !/^\d+(\s*[×xX]\s*\d+)?$|^[×xX]$/.test(t)) b = 'colour';
                (bag[b] = bag[b] || []).push(p.s);
            });
            Object.keys(bag).forEach(k => { cur[k] = biqNorm(bag[k].join(' ')); });
            if (cur.desc) { cur.desc = [cur.desc]; } else cur.desc = [];
            // the dimension cell is unmistakable — take it from the row text so a tight
            // column boundary can never split "1455 × 1210" across dim/fix
            const dm = joined.match(/(\d{2,5})\s*[×xX]\s*(\d{2,5})/);
            if (dm) { cur.width = dm[1]; cur.drop = dm[2]; }
            rows.push(cur); mode = 'row';
            continue;
        }
        if (!cur) continue;
        if (mode === 'opt') { cur.options = biqNorm(cur.options + ' ' + joined); continue; }
        const dp = parts.filter(p => bandOf(p.x) === 'desc');           // 2nd description line = range
        if (dp.length) cur.desc.push(biqNorm(dp.map(p => p.s).join(' ')));
    }
    if (!rows.length) return null;
    return { meta, rows };
}

// "Options: A=1 | B=2" -> [[A,1],[B,2]]. Values may contain bare pipes ("(1.1|2|3Nm)"),
// so split only on a pipe with whitespace either side. Repeated keys (Accessory=) are kept.
export function biqTbdOptions(s) {
    return biqNorm(s).split(/\s+\|\s+/).map(seg => {
        const i = seg.indexOf('=');
        if (i < 1) return null;
        return [biqNorm(seg.slice(0, i)), biqNorm(seg.slice(i + 1))];
    }).filter(Boolean);
}

export function biqNormalizeTbd(mappings, p) {
    const o = biqBlankOrder();
    o.source = 'tbd';
    o.sourceDesc = (p.meta.docType || 'BLINDS ORDER') + ' — ' + (p.meta.company || 'Total Blind Designs software');
    o.customer = p.meta.company || 'Total Blind Designs';
    o.client = p.meta.client || '';
    o.orderDate = biqParseDate(p.meta.orderDate);
    if (p.meta.project) o.notes = 'Project: ' + p.meta.project;
    let n = 0;
    p.rows.forEach(r => {
        const it = biqBlankItem(String(++n));
        it.qty = r.qty || '1'; it.location = r.location || '';
        it.width = r.width || ''; it.drop = r.drop || ''; it.fix = r.fix || '';
        // description is two lines — product and range — but their order can invert in the
        // text layer, so identify the product by name and treat whatever is left as the range.
        const frags = (r.desc || []).map(biqNorm).filter(Boolean);
        let prod = '', rest = [];
        frags.forEach(f => {
            if (!prod && BIQ_TBD_TYPES.some(([re]) => re.test(f))) prod = f; else rest.push(f);
        });
        if (!prod && frags.length) { prod = frags[0]; rest = frags.slice(1); }
        const hit = BIQ_TBD_TYPES.find(([re]) => re.test(prod));
        it.blindType = hit ? hit[1] : prod;
        it.range = biqNorm(rest.join(' '));
        it._tbdProduct = prod;
        if (it.blindType === 'Element Wood') {
            const w = BIQ_TBD_WOOD_RANGES.find(([re]) => re.test(it.range || prod));
            if (w) it.range = w[1];
        }
        // Double roller prints two fabrics ("Blockout + 5 Screen"); BlindIQ carries one combined
        // range ("blockout/duo block/surface block/any screen"). Only accept it when exactly one
        // scoped range covers the front fabric — otherwise leave it to be flagged.
        if (it.blindType === 'Element Double Roller' && /\+/.test(it.range)) {
            const front = biqLc(it.range.split('+')[0]);
            const bt = biqResolve(mappings, 'blindTypes', it.blindType);
            if (bt.known && front) {
                const pre = bt.id + '|';
                const cands = Object.keys(mappings.rangesScoped || {})
                    .filter(k => k.indexOf(pre) === 0).map(k => k.slice(pre.length))
                    .filter(rn => rn.split('/').some(a => biqLc(a) === front));
                if (cands.length === 1) { it._origRange = it.range; it.range = cands[0]; }
            }
        }
        // double roller carries two fabrics and two colours ("Blockout + 5 Screen", "White /Dune Grey")
        const col = biqNorm(r.colour || '');
        if (/\//.test(col) && it.blindType === 'Element Double Roller') {
            const cs = col.split('/').map(biqNorm).filter(Boolean);
            it.colour = cs[0]; it._colour2 = cs[1] || '';
            it.notes = (it.notes ? it.notes + ' | ' : '') + 'Fabrics: ' + it.range + ' / colours: ' + cs.join(' + ');
        } else it.colour = col;

        const opts = biqTbdOptions(r.options || '');
        it.variants = biqTemplateFor2(mappings, it.blindType || 'roller');
        let leftEnd = '', rightEnd = '', joined = '';
        const seen = {}, extra = [];
        opts.forEach(([k, v]) => {
            const kl = biqLc(k);
            if (kl === 'left end') { leftEnd = v; return; }
            if (kl === 'right end') { rightEnd = v; return; }
            if (kl === 'joined to') { joined = v; return; }
            // TBD repeats keys (Accessory=A | Accessory=B). A variant holds one value, so keep
            // the first and carry the rest into notes rather than silently dropping them.
            if (seen[kl] !== undefined && seen[kl] !== v) { extra.push(k + '=' + v); return; }
            seen[kl] = v;
            biqSetVar(it.variants, k, v);                               // already BlindIQ-shaped
        });
        if (extra.length) it.notes = (it.notes ? it.notes + ' | ' : '') + 'Also: ' + extra.join(' | ');
        // Controls: prefer the explicit Left End / Right End options; fall back to the
        // Controls cell ("LHC", "RHM", "LH Crank", "L:Mtr R:Int").
        let c1 = biqTbdDrive(leftEnd), c2 = biqTbdDrive(rightEnd);
        if (!c1 && !c2) {
            const ctl = biqNorm(r.ctl || '');
            const lm = ctl.match(/L\s*:\s*([A-Za-z]+)/i), rm = ctl.match(/R\s*:\s*([A-Za-z]+)/i);
            if (lm || rm) { c1 = biqTbdDrive(lm && lm[1]); c2 = biqTbdDrive(rm && rm[1]); }
            else if (/^(LH|RH)/i.test(ctl)) {
                const d = biqTbdDrive(ctl.replace(/^(LH|RH)C?M?/i, '')) || (/C$/i.test(ctl) ? 'Chain' : /M$/i.test(ctl) ? 'Motor' : '');
                if (/^LH/i.test(ctl)) { c1 = d; c2 = 'Pin'; } else { c1 = 'Pin'; c2 = d; }
            }
        }
        if (c1) it.control1 = 'Lh ' + c1;
        if (c2) it.control2 = 'Rh ' + c2;
        if (c1 && !c2) it.control2 = 'Rh Pin';
        if (c2 && !c1) it.control1 = 'Lh Pin';
        // "Joined To=Blind 2 (Intermediate)" -> pair with the next line via the shared-bracket
        // engine. Only consecutive pairs are auto-applied; anything else is left for the capturer.
        if (joined) {
            const jm = joined.match(/(\d+)/);
            const kind = /coupl/i.test(joined) ? 'coupled' : 'intermediate';
            const target = jm ? parseInt(jm[1], 10) : 0;
            if (target === n + 1) it._bracketWith = kind;
            else if (target && target !== n - 1) it.notes = (it.notes ? it.notes + ' | ' : '') + 'Joined to blind ' + target + ' (' + kind + ') — not consecutive, check pairing';
        }
        it.controlDrop = biqComputeControlDropV2(mappings, '', it.drop, it.blindType, it.range); it._cdAuto = true;
        o.items.push(it);
    });
    return o;
}

// Sanity-check a deterministic TBD parse before trusting it over the AI path.
// Coherent = most items resolved to a real blind type and carry a real width.
export function biqTbdCoherent(mappings, order) {
    if (!order || !order.items.length) return false;
    let good = 0;
    order.items.forEach(it => {
        const w = parseInt(it.width, 10) || 0;
        const typeOk = it.blindType && biqResolve(mappings, 'blindTypes', it.blindType).known;
        if (w > 0 && typeOk) good++;
    });
    return good >= Math.ceil(order.items.length * 0.6);
}

// =============================================================================
// AI EXTRACTION — universal path for any document type (via the Gemini proxy)
// =============================================================================

// Gemini responseSchema: a single customer order extracted from one document.
export const BIQ_EXTRACTION_SCHEMA = {
    type: "OBJECT",
    properties: {
        "customerCompany": { type: "STRING", description: "The dealer/company placing the order (the document's letterhead/system owner), not the end client." },
        "orderNumber": { type: "STRING", description: "The order number / PO number / reference." },
        "endClient": { type: "STRING", description: "End client or job name if shown, else empty." },
        "orderDate": { type: "STRING", description: "Order date as printed." },
        "requiredDate": { type: "STRING", description: "Required/delivery date if shown, else empty." },
        "deliveryMethod": { type: "STRING" },
        "deliveryAddress": { type: "STRING", description: "Multi-line delivery address if shown." },
        "orderNotes": { type: "STRING" },
        "lineItems": {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    "itemCode": { type: "STRING", description: "Line identifier (a, b, 1, 2, 0001...)" },
                    "qty": { type: "STRING" },
                    "location": { type: "STRING", description: "Room / window location" },
                    "blindType": { type: "STRING", description: "Product/blind type as written (e.g. Roller Blind, System 40, Element Wood)" },
                    "range": { type: "STRING", description: "Fabric range/collection name ONLY (not the colour)" },
                    "colour": { type: "STRING", description: "Colour name ONLY" },
                    "width": { type: "STRING", description: "Finished width in mm, digits only" },
                    "drop": { type: "STRING", description: "Finished drop/height in mm, digits only" },
                    "fix": { type: "STRING", description: "Face or Reveal" },
                    "controlLeft": { type: "STRING", description: "Left-hand control (e.g. Lh Chain, Lh Pin, LH Motor). Empty if not stated." },
                    "controlRight": { type: "STRING", description: "Right-hand control (e.g. Rh Chain, Rh Pin, RH Motor). Empty if not stated." },
                    "controlDrop": { type: "STRING", description: "Control/chain drop in mm, or 'Std' if standard" },
                    "options": {
                        type: "ARRAY", description: "Every other specification as Key=Value (e.g. Mech Colour=White, Roll Type=Waterfall, Motor=One Touch 1.1nm)",
                        items: { type: "STRING" }
                    },
                    "notes": { type: "STRING" }
                },
                required: ["itemCode", "qty", "location", "blindType", "range", "colour", "width", "drop", "fix", "controlLeft", "controlRight", "controlDrop", "options", "notes"]
            }
        },
        "sundries": {
            type: "ARRAY", description: "Standalone accessory/component lines (motors, remotes, brackets ordered as separate lines)",
            items: {
                type: "OBJECT",
                properties: { "description": { type: "STRING" }, "qty": { type: "STRING" } },
                required: ["description", "qty"]
            }
        }
    },
    required: ["customerCompany", "orderNumber", "lineItems"]
};

export function biqBuildExtractionPrompt(knownRanges, knownBlindTypes) {
    return `You are extracting a window-blind customer order from the attached document(s) for import into Blind Designs' manufacturing system (BlindIQ).

RULES:
- Extract EVERY line item. One output line item per physical blind.
- Measurements: millimetres, digits only. South African number formats. Width is horizontal, drop/height vertical.
- "range" is the fabric collection name; "colour" is the colour name. NEVER combine them: if the document shows "5 Screen Charcoal Grey", range="5 Screen", colour="Charcoal Grey".${knownRanges && knownRanges.length ? `
- Known fabric ranges (use EXACTLY these spellings when the document matches one): ${knownRanges.join(', ')}.` : ''}${knownBlindTypes && knownBlindTypes.length ? `
- Known blind types: ${knownBlindTypes.join(', ')}.` : ''}
- Controls: chain/pin/motor and which side. A control written as just "Left" on a roller blind means chain on the left (controlLeft="Lh Chain", controlRight="Rh Pin"); "Right" means chain right (controlLeft="Lh Pin", controlRight="Rh Chain").
- Put every other specification (mechanism/hardware colour, bottom bar, roll type, cassette, motor, remotes, valance, ladder tape, etc.) into "options" as "Key=Value" strings.
- The "Hardware Colour" (a.k.a. Mechanism/Mech Colour) column is the colour of the blind's mechanism/brackets (e.g. White, Black, Grey, Beige, Anthracite) — read it from its own column and output it as "Mech Colour=<value>". Do NOT confuse it with the fabric "colour". Never default it to White: if it is blank or illegible leave it out entirely rather than guessing.
- Handwriting: transcribe carefully; prefer plausible mm dimensions (300–4000). If a value is illegible, use an empty string — NEVER guess silently.
- Do not invent line items for spacer/blank/total rows.
- CUSTOMER vs SUPPLIER: some orders (e.g. Windovert) print the dealer/branch under the order title and a "Supplier" field naming the manufacturer ("Blind Design" / "Blind Designs"). The customerCompany is the DEALER/BRANCH (e.g. "Windovert Johannesburg"), NEVER the Supplier. The "Rep" is the dealer's salesperson, not a control or operator.
- Product names may be prefixed "BD " (e.g. "BD Element Roller 40", "BD Element Vision", "BD Element Wood Alloy", "BD Outdoor Blinds - Free Hang", "BD Cellular Skylight"); use the product name as the blindType (the "BD " prefix is just the manufacturer tag).
- "Mk" is the item/mark number; the "No." column is the quantity. "Fab / Slat" is the fabric range; map it to "range".
- Fix abbreviations: "F/F" = Face; "I/R" = Reveal. "Rev L" / "Rev R" = Reveal with the control on the Left / Right respectively — set fix="Reveal" AND, if controls aren't otherwise stated, set the control side from L/R ("Left" → controlLeft="Lh Chain", controlRight="Rh Pin"; "Right" → controlLeft="Lh Pin", controlRight="Rh Chain"; for crank/motor products use the matching side, e.g. LH Crank / RH Crank).
- Map the dealer's column wording to BlindIQ options in "options": Comp / Comp Col → Mech Colour; Bott Bar Col → Bottom Bar; Cass Col → the cassette colour option; Steel Chain=Yes or Chain Type=Steel → Steel Ball Chain=Yes; Roll → Roll Type; Int Bracket → Intermediate Bracket; Tilt Cord → the tilt control side; Cord Ht / Chain Height → controlDrop; Br col → Bracket Colour; Alum col → Powder Coat Colour; Add H/D → Hold Downs; Twist Lock Pole / Skylight Pole → the pole option; Crank + Crank length + Crank col → the crank handle/control. Put true accessories (motor Type, Charger, Remote, crank handle as a separate part) into "sundries" when they are charged components.`;
}

// Convert the AI's JSON into the converter order model.
export function biqAiResultToOrder(mappings, ai) {
    const o = biqBlankOrder();
    o.source = 'ai'; o.sourceDesc = 'AI-extracted (verify against document)';
    o.customer = biqNorm(ai.customerCompany); o.orderNumber = biqNorm(ai.orderNumber);
    o.client = biqNorm(ai.endClient);
    o.orderDate = biqParseDate(ai.orderDate); o.requiredDate = biqParseDate(ai.requiredDate);
    o.deliveryMethod = biqNorm(ai.deliveryMethod); o.address = String(ai.deliveryAddress || '').trim();
    o.notes = biqNorm(ai.orderNotes);
    (ai.lineItems || []).forEach((li, idx) => {
        const it = biqBlankItem(biqNorm(li.itemCode) || String.fromCharCode(97 + idx));
        it.qty = biqNorm(li.qty) || '1'; it.location = biqNorm(li.location);
        it.blindType = biqNorm(li.blindType);
        it.range = biqNorm(li.range); it.colour = biqNorm(li.colour);
        // safety: if AI left colour empty but range looks combined, run the splitter
        if (!it.colour && it.range) { const f = biqSplitFabric(mappings, it.range, it.blindType); it.range = f.range; it.colour = f.colour; it._origFabric = biqNorm(li.range); }
        it.width = (String(li.width || '').match(/\d+/) || [''])[0];
        it.drop = (String(li.drop || '').match(/\d+/) || [''])[0];
        it.fix = biqNorm(li.fix);
        it.control1 = biqNorm(li.controlLeft); it.control2 = biqNorm(li.controlRight);
        { const cd = biqNorm(li.controlDrop || '');
          it.controlDrop = biqComputeControlDropV2(mappings, /^\d/.test(cd) ? cd : '', it.drop, it.blindType, it.range);
          it._cdAuto = !/^\d/.test(cd); }
        it.variants = biqTemplateFor2(mappings, it.blindType);
        (li.options || []).forEach(opt => {
            const i = String(opt).indexOf('=');
            if (i > 0) biqSetVar(it.variants, biqNorm(opt.slice(0, i)), biqNorm(opt.slice(i + 1)));
            else if (biqNorm(opt)) biqSetVar(it.variants, biqNorm(opt), 'Yes');
        });
        it.notes = biqNorm(li.notes);
        o.items.push(it);
    });
    (ai.sundries || []).forEach(s => {
        o.sundries.push({ code: '', qty: biqNorm(s.qty) || '1', type: '', sundry: '', notes: biqNorm(s.description) });
    });
    return o;
}

// =============================================================================
// VALIDATION + XML GENERATION
// =============================================================================
// Customers: one name per account. Dealer phrasings are stored as pointer
// aliases ({alias: canonicalKey}) and resolve to the canonical BlindIQ record;
// the order's customer name is rewritten to the canonical name.
// Letterheads print trading names ("Galaxy Blinds", "Total Blind Design") while BlindIQ stores
// registered ones ("Galaxy Blinds (Pty) Ltd", "Total Blind Designs"). Strip legal suffixes and
// singular/plural before comparing — but only accept a match that is UNIQUE, so we can never
// silently pick between two real customers (e.g. Galaxy Blinds vs Galaxy Curtain).
function biqCustKey(s, dePlural) {
    let k = biqLc(s).replace(/\(pty\)\s*ltd|\bpty\s*ltd\b|\(pty\)|\bltd\b|\bcc\b|\binc\b|\bt\/a\b.*$/g, ' ')
        .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (dePlural) k = k.split(' ').map(w => w.length > 3 ? w.replace(/s$/, '') : w).join(' ');
    return k;
}
// Deliberately does NOT auto-match near misses: the customer ID decides who is billed, so an
// unmatched name stays unmatched and gets flagged. biqSuggestCustomer offers the likely match
// for the capturer to confirm once — after which the alias is saved and resolves exactly.
export function biqResolveCustomer(mappings, name) {
    const key = biqLc(name);
    if (!key) return { known: false };
    let entry = (mappings.customers || {})[key];
    let canonicalKey = key;
    if (entry && entry.alias) { canonicalKey = biqLc(entry.alias); entry = (mappings.customers || {})[canonicalKey]; }
    if (!entry || entry.customer == null) return { known: false };
    return { known: true, entry, canonicalKey };
}
// "Galaxy Blinds" (letterhead) -> "galaxy blinds (pty) ltd" (BlindIQ). Suggestion only, and only
// when the normalised name maps to exactly ONE customer — never a guess between two real ones
// (Galaxy Blinds vs Galaxy Curtain both normalise differently, so they stay distinct).
export function biqSuggestCustomer(mappings, name) {
    const key = biqLc(name);
    const all = mappings.customers || {};
    if (!key || all[key]) return null;
    if (!mappings._custIdx) {
        const idx = { a: {}, b: {} };
        Object.keys(all).forEach(k => {
            if (!all[k] || (all[k].customer == null && !all[k].alias)) return;
            [['a', biqCustKey(k, false)], ['b', biqCustKey(k, true)]].forEach(([b, nk]) => {
                if (!nk) return;
                if (idx[b][nk] === undefined) idx[b][nk] = k; else if (idx[b][nk] !== k) idx[b][nk] = null;
            });
        });
        try { Object.defineProperty(mappings, '_custIdx', { value: idx, enumerable: false }); }
        catch (e) { mappings._custIdx = idx; }
    }
    const hit = mappings._custIdx.a[biqCustKey(key, false)] || mappings._custIdx.b[biqCustKey(key, true)];
    return (hit && biqResolveCustomer(mappings, hit).known) ? hit : null;
}
export function biqCanonicalCustomerName(mappings, name) {
    const r = biqResolveCustomer(mappings, name);
    if (!r.known) return null;
    return r.canonicalKey.replace(/\b[a-z]/g, ch => ch.toUpperCase()).replace(/\bT\/a\b/g, 'T/A');
}

// When the customer record carries default delivery method / packing type
// (from BlindIQ's Customer Address table), fill empty header fields with them.
export function biqApplyCustomerDefaults(mappings, order) {
    const r = biqResolveCustomer(mappings, order.customer);
    if (!r.known) return;
    // alias -> rewrite to the one true BlindIQ account name before export
    if (biqLc(order.customer) !== r.canonicalKey) order.customer = biqCanonicalCustomerName(mappings, order.customer);
    const e = r.entry;
    if (!order.deliveryMethod && e.dm) order.deliveryMethod = e.dm;
    if (!order.packingType && e.pt) order.packingType = e.pt;
}
export function biqCollectProblems(mappings, order) {
    const probs = [];
    const custR = biqResolveCustomer(mappings, order.customer);
    if (!order.customer) probs.push({ t: 'Customer (dealer) name is empty.' });
    else if (!custR.known) probs.push({ t: 'Customer "' + order.customer + '" has no BlindIQ IDs (customer / address / operator).', cat: 'customers', name: order.customer });
    else { const e = custR.entry;
        // operator intentionally optional — BlindIQ doesn't use it on import; -1 is emitted when unset
        if (e && (e.address === '' || e.address == null)) probs.push({ t: 'Customer "' + order.customer + '" has no delivery address ID.', cat: 'customers', name: order.customer });
    }
    // Required date intentionally optional — the operator sets it in BlindIQ after import.
    if (!order.orderNumber) probs.push({ t: 'Customer order number / reference is empty.' });
    const dm = biqResolve(mappings, 'deliveryMethods', order.deliveryMethod);
    if (order.deliveryMethod && !dm.known) probs.push({ t: 'Delivery method "' + order.deliveryMethod + '" not mapped.', cat: 'deliveryMethods', name: order.deliveryMethod });
    if (!order.deliveryMethod) probs.push({ t: 'Delivery method is empty (CO_DeliveryMethod_Link is mandatory).' });
    const pk = biqResolve(mappings, 'packingTypes', order.packingType);
    if (order.packingType && !pk.known) probs.push({ t: 'Packing type "' + order.packingType + '" not mapped.', cat: 'packingTypes', name: order.packingType });
    if (!order.packingType) probs.push({ t: 'Packing type is empty — BlindIQ\'s importer needs a number here (e.g. Boxed / Standard).' });
    if (!order.items.length && !order.sundries.length) probs.push({ t: 'Order has no items and no sundries.' });
    order.items.forEach((it, i) => {
        const w = 'Item ' + (it.code || i + 1) + ': ';
        if (!biqResolve(mappings, 'blindTypes', it.blindType).known) probs.push({ t: w + 'blind type "' + (it.blindType || '?') + '" not mapped.', cat: 'blindTypes', name: it.blindType });
        if (biqNeedsSplit(mappings, it)) probs.push({ t: w + 'fabric "' + it.range + '" needs splitting into range + colour.', split: i });
        else if (!biqResolveRange(mappings, it.blindType, it.range).known) probs.push({ t: w + 'range "' + (it.range || '?') + '" not mapped' + (biqResolve(mappings, 'blindTypes', it.blindType).known ? ' for blind type "' + it.blindType + '"' : '') + '.', cat: 'ranges', name: it.range, blindType: it.blindType });
        const rc = biqResolveColour(mappings, it.range, it.colour);
        if (!rc.known && biqLc(it.colour)) probs.push({ t: w + 'colour "' + it.colour + '" (range ' + (it.range || '?') + ') not mapped.', cat: 'colours', name: it.range + '|' + it.colour });
        if (!biqLc(it.colour) && !/curtain/i.test(it.blindType)) probs.push({ t: w + 'colour is empty.' });
        if (!biqResolve(mappings, 'fixes', it.fix).known && biqLc(it.fix)) probs.push({ t: w + 'fix "' + it.fix + '" not mapped.', cat: 'fixes', name: it.fix });
        if (!biqResolve(mappings, 'control1', it.control1).known && biqLc(it.control1)) probs.push({ t: w + 'control "' + it.control1 + '" not mapped.', cat: 'control1', name: it.control1 });
        if (!biqResolve(mappings, 'control2', it.control2).known && biqLc(it.control2)) probs.push({ t: w + 'control "' + it.control2 + '" not mapped.', cat: 'control2', name: it.control2 });
        if (biqRequiresDualControl(mappings, it.blindType) && (!biqLc(it.control1) || !biqLc(it.control2)))
            probs.push({ t: w + 'both control sides (Control L and Control R) must be set for ' + (it.blindType || 'this blind') + '.' });
        if (it._bracketOdd) probs.push({ t: w + 'flagged as ' + it._bracketOdd + ' bracket but has no matching pair — couple it with its partner line (or clear the flag).' });
        const spec = biqVariantSpec(mappings, it.blindType);
        if (spec) spec.forEach(o => {
            if (o.req) { const f = it.variants.find(v => biqLc(v[0]) === biqLc(o.k));
                if (!f || !biqNorm(f[1])) probs.push({ t: w + 'option "' + o.k + '" is required for ' + it.blindType + (o.values && o.values.length ? ' (' + o.values.slice(0, 4).join(' / ') + (o.values.length > 4 ? ' …' : '') + ')' : '') + '.' }); }
        });
        if (!(+it.width > 0)) probs.push({ t: w + 'width missing/invalid.' });
        if (!(+it.drop > 0)) probs.push({ t: w + 'drop missing/invalid.' });
        if (!(+it.qty > 0)) probs.push({ t: w + 'qty missing/invalid.' });
    });
    order.sundries.forEach((s, i) => {
        const w = 'Sundry ' + (s.code || i + 1) + ': ';
        if (!/^\d+$/.test(biqNorm(s.type))) probs.push({ t: w + 'SundryType_Link must be a number.' });
        if (!/^\d+$/.test(biqNorm(s.sundry))) probs.push({ t: w + 'Sundry_Link must be a number.' });
        if (!(+s.qty > 0)) probs.push({ t: w + 'qty missing/invalid.' });
    });
    return probs;
}

// Sundry lines need a line code (COS_ItemCode) — the real 20112 export codes its
// sundries 'B' after item 'A'; BlindIQ's importer silently drops code-less lines.
// Continue the item sequence: numeric items -> next numbers (0005…), else letters.
export function biqAssignSundryCodes(order) {
    const blanks = order.sundries.filter(su => !biqNorm(su.code));
    if (!blanks.length) return;
    const itemCodes = order.items.map(it => biqNorm(it.code)).filter(Boolean);
    const numeric = itemCodes.length && itemCodes.every(c => /^\d+$/.test(c));
    if (numeric) {
        const width = Math.max(...itemCodes.map(c => c.length));
        let n = Math.max(0, ...itemCodes.map(c => +c), ...order.sundries.map(su => +su.code || 0));
        blanks.forEach(su => { n += 1; su.code = String(n).padStart(width, '0'); });
    } else {
        const used = new Set([...itemCodes, ...order.sundries.map(su => biqLc(su.code))].map(biqLc));
        let i = 0;
        blanks.forEach(su => {
            while (i < 26 && used.has(String.fromCharCode(97 + i))) i++;
            su.code = String.fromCharCode(97 + Math.min(i, 25)); used.add(su.code); i++;
        });
    }
}

const XSI = ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
function tag(name, val, opts) {
    opts = opts || {};
    if (val == null || val === '') {
        if (opts.nil) return '<' + name + ' xsi:nil="true" />';
        return '<' + name + ' />';
    }
    return '<' + name + '>' + esc(val) + '</' + name + '>';
}
export function biqGenerateXML(mappings, order) {
    biqAssignSundryCodes(order);
    biqApplyCustomerDefaults(mappings, order);
    const cust = biqResolveCustomer(mappings, order.customer);
    const c = cust.known ? cust.entry : { customer: '', address: '', operator: '' };
    const dm = biqResolve(mappings, 'deliveryMethods', order.deliveryMethod);
    const pk = biqResolve(mappings, 'packingTypes', order.packingType);
    const idOr = res => res.known ? res.id : '';
    let x = '<BlindIQExport_CO>';
    x += '<CustomerOrders' + XSI + '>';
    x += tag('CustomerOrderID', order.orderId || '0');
    x += tag('CO_Customer_Link', c.customer);
    x += tag('CO_Customer_Order_Number', order.orderNumber);
    x += tag('CO_Required_Date', order.requiredDate ? order.requiredDate + 'T00:00:00' : '');
    x += tag('CO_DeliveryAddress_Link', c.address);
    x += tag('CO_DeliveryMethod_Link', idOr(dm));
    x += tag('CO_PackingType_Link', (order.packingType && pk.known) ? pk.id : '');  // empty -> caught by the import-safety scan
    x += order.address ? '<CO_Delivery_Address>' + esc(order.address.replace(/\r\n?/g, '\n')) + '\n</CO_Delivery_Address>' : '<CO_Delivery_Address />';
    x += tag('CO_Notes', order.notes);
    x += tag('CO_CustomerOperator_Link', (c.operator === '' || c.operator == null) ? (cust.known ? -1 : '') : c.operator);
    x += '</CustomerOrders>';
    order.items.forEach(it => {
        const rt = biqResolve(mappings, 'blindTypes', it.blindType), rr = biqResolveRange(mappings, it.blindType, it.range),
            rc = biqResolveColour(mappings, it.range, it.colour), rf = biqResolve(mappings, 'fixes', it.fix),
            r1 = biqResolve(mappings, 'control1', it.control1), r2 = biqResolve(mappings, 'control2', it.control2);
        x += '<CustomerOrderItems' + XSI + '>';
        x += tag('COI_ItemCode', it.code);
        x += tag('COI_Qty', it.qty);
        x += tag('COI_Location', it.location);
        x += tag('COI_Supplier_Link', '1');
        x += tag('COI_BlindType_Link', idOr(rt));
        x += tag('COI_BlindRange_Link', idOr(rr));
        x += tag('COI_Colour_Link', biqLc(it.colour) ? idOr(rc) : '-1');
        x += tag('COI_Width', it.width);
        x += tag('COI_Drop', it.drop);
        x += tag('COI_Fix_Link', biqLc(it.fix) ? idOr(rf) : '-1');
        x += tag('COI_Control1_Link', biqLc(it.control1) ? idOr(r1) : '-1');
        x += tag('COI_Control2_Link', biqLc(it.control2) ? idOr(r2) : '-1');
        x += tag('COI_ControlDrop', it.controlDrop || '0');
        const clean = t => biqNorm(t).replace(/\|/g, '/');
        const vs = biqEmittedVariants(mappings, it).map(v => clean(v[0]) + '=' + clean(v[1])).filter(Boolean).join('|');
        x += vs ? '<COI_VariantOptions>' + esc(vs + '|') + '</COI_VariantOptions>' : '<COI_VariantOptions />';
        x += '<COI_VariantOptions_Display xsi:nil="true" />';
        x += tag('COI_Order_Notes', it.notes);
        x += '</CustomerOrderItems>';
    });
    order.sundries.forEach(s => {
        x += '<CustomerOrderSundries' + XSI + '>';
        x += tag('COS_ItemCode', s.code);
        x += tag('COS_Qty', (+s.qty || 0).toFixed(3));
        x += tag('COS_Supplier_Link', '1');
        x += tag('COS_SundryType_Link', s.type);
        x += tag('COS_Sundry_Link', s.sundry);
        x += tag('COS_Sundry_Notes', s.notes);
        x += '</CustomerOrderSundries>';
    });
    x += '</BlindIQExport_CO>';
    return x;
}
// Scan generated XML for numeric fields BlindIQ's importer will CLng(): every
// *_Link and CustomerOrderID node must contain digits. Returns offending tags.
export function biqImportSafetyScan(xml) {
    const bad = [];
    const re = /<([A-Za-z0-9_]*_Link|CustomerOrderID)( xsi:nil="true")?\s*\/>|<([A-Za-z0-9_]*_Link|CustomerOrderID)>([^<]*)<\/\3>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
        if (m[1] !== undefined) bad.push(m[1] + ' (empty/nil)');
        else if (!/^-?\d+$/.test(String(m[4]).trim())) bad.push(m[3] + ' ("' + String(m[4]).trim() + '")');
    }
    return [...new Set(bad)];
}
export function biqPrettyXML(x) {
    return x.replace(/></g, '>\n<').replace(/(<CustomerOrderItems |<CustomerOrderSundries |<\/BlindIQExport_CO)/g, '\n$1');
}

// =============================================================================
// ORDERBOT BRIDGE — converted order -> comparison shape for runPostAIValidations
// =============================================================================
// Wraps each converter item as {field:{blindIQValue}} line items and synthesises
// sundries from Motor / Remotes / Accessory variant options, so the existing
// torque, fabric-width, colour, control, chain-ratio and motor-dependency checks
// run unchanged on a converted (or AI-extracted) order.
export function biqToComparisonShape(order) {
    const wrap = v => ({ blindIQValue: String(v == null ? '' : v), customerValue: String(v == null ? '' : v), result: 'MATCH' });
    const lineItems = order.items.map(it => {
        const varGet = key => { const f = it.variants.find(v => biqLc(v[0]) === biqLc(key)); return f ? biqNorm(f[1]) : ''; };
        return {
            item: wrap(it.code), location: wrap(it.location), qty: wrap(it.qty),
            blindType: wrap(it.blindType), range: wrap(it.range), colour: wrap(it.colour),
            width: wrap(it.width), drop: wrap(it.drop), fix: wrap(it.fix),
            control1: wrap(it.control1), control2: wrap(it.control2),
            specifications: it.variants.filter(v => biqNorm(v[1])).map(v => ({ specName: v[0], specComparison: { blindIQValue: v[1], customerValue: v[1], result: 'MATCH', confidence: 1 } })),
            _motorOption: varGet('Motor') || varGet('Motor Type'), _converterIndex: order.items.indexOf(it)
        };
    });
    const sundries = [];
    order.items.forEach(it => {
        const varGet = key => { const f = it.variants.find(v => biqLc(v[0]) === biqLc(key)); return f ? biqNorm(f[1]) : ''; };
        const motor = varGet('Motor'); const remotes = varGet('Remotes'); const accessory = varGet('Accessory') || varGet('Accessories');
        if (motor) sundries.push({ item: { blindIQValue: 'Motor ' + motor, customerValue: motor, result: 'MATCH' }, quantity: +it.qty || 1 });
        if (remotes) sundries.push({ item: { blindIQValue: 'Remote ' + remotes, customerValue: remotes, result: 'MATCH' }, quantity: 1 });
        if (accessory) sundries.push({ item: { blindIQValue: accessory, customerValue: accessory, result: 'MATCH' }, quantity: +it.qty || 1 });
    });
    order.sundries.forEach(s => {
        if (biqNorm(s.notes)) sundries.push({ item: { blindIQValue: s.notes, customerValue: s.notes, result: 'MATCH' }, quantity: +s.qty || 1 });
    });
    return { lineItems, sundries, bdoOrderNumber: order.orderNumber, customerOrderNumber: { customerValue: order.orderNumber, blindIQValue: order.orderNumber } };
}

// Pull validation flags computed by runPostAIValidations back onto converter items.
export function biqExtractCheckResults(comparisonData) {
    const out = [];
    (comparisonData.lineItems || []).forEach(li => {
        const flags = [];
        ['fabricValidation', 'colourValidation', 'controlValidation', 'chainValidation', 'torqueValidation', 'minWidthValidation'].forEach(k => {
            if (li[k]) flags.push({ kind: k, type: li[k].type || 'error', message: li[k].message });
        });
        if (Array.isArray(li.motorValidation)) li.motorValidation.forEach(m => flags.push({ kind: 'motorValidation', type: 'error', message: m }));
        out.push({ index: li._converterIndex, blindWeight: li.blindWeight, requiredTorque: li.requiredTorque, requiredTorqueSafety: li.requiredTorqueSafety, flags });
    });
    return { items: out, global: comparisonData.motorValidation ? comparisonData.motorValidation.global : null };
}

// =============================================================================
// AI DISCERNMENT (OrderBot only) — match a customer's product wording to the
// BlindIQ catalogue. Pure helpers here build grounded candidate shortlists and
// apply the AI's confidence-scored picks; the Gemini call itself lives in the UI.
// Scope: product attributes ONLY (blind type / range / colour / control / fix).
// The customer/dealer account is deliberately NOT AI-matched.
// =============================================================================

// token overlap score between a free name and a candidate key
function biqTokenScore(query, cand) {
    const qt = biqLc(query).split(/[^a-z0-9.]+/).filter(Boolean);
    const ct = biqLc(cand).split(/[^a-z0-9.]+/).filter(Boolean);
    if (!qt.length || !ct.length) return 0;
    let hit = 0;
    qt.forEach(t => { if (ct.some(c => c === t || c.startsWith(t) || t.startsWith(c))) hit++; });
    let s = hit / qt.length;
    if (biqLc(cand).startsWith(biqLc(query))) s += 0.3;
    return s;
}
function biqShortlist(names, query, n) {
    return names.map(nm => [nm, biqTokenScore(query, nm)])
        .sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]);
}

// All candidate display names for a product field, scoped where it matters.
export function biqCandidatesFor(mappings, field, ctx) {
    ctx = ctx || {};
    const title = s => String(s).replace(/\b[a-z]/g, c => c.toUpperCase());
    if (field === 'blindType') return Object.keys(mappings.blindTypes || {}).map(title);
    if (field === 'fix') return Object.keys(mappings.fixes || {}).filter(k => k !== 'none').map(title);
    if (field === 'control1' || field === 'control2') return Object.keys(mappings[field] || {}).filter(k => k !== 'none').map(title);
    if (field === 'range') return biqRangeNamesFor(mappings, ctx.blindType).map(title);
    if (field === 'colour') return Object.keys(mappings.colours || {}).map(k => (k.startsWith('|') ? k.slice(1) : k.split('|').pop())).map(title);
    return [];
}

// Collect every unresolved product slot in an order, each with a grounded shortlist.
export function biqBuildDiscernment(mappings, order, shortlistN) {
    const N = shortlistN || 12;
    const slots = [];
    order.items.forEach((it, i) => {
        const add = (field, raw, ctx) => {
            if (!biqLc(raw)) return;
            const cands = biqShortlist(biqCandidatesFor(mappings, field, ctx), raw, N);
            if (cands.length) slots.push({ id: 'i' + i + '.' + field, idx: i, field, raw: biqNorm(raw), candidates: cands });
        };
        if (!biqResolve(mappings, 'blindTypes', it.blindType).known) add('blindType', it.blindType);
        if (!biqNeedsSplit(mappings, it) && !biqResolveRange(mappings, it.blindType, it.range).known) add('range', it.range, { blindType: it.blindType });
        if (!biqResolveColour(mappings, it.range, it.colour).known) add('colour', it.colour, { range: it.range });
        if (!biqResolve(mappings, 'control1', it.control1).known) add('control1', it.control1);
        if (!biqResolve(mappings, 'control2', it.control2).known) add('control2', it.control2);
        if (!biqResolve(mappings, 'fixes', it.fix).known) add('fix', it.fix);
    });
    return slots;
}

// Gemini responseSchema for the discernment call.
export const BIQ_DISCERN_SCHEMA = {
    type: 'OBJECT',
    properties: {
        matches: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    id: { type: 'STRING' },
                    match: { type: 'STRING', description: 'EXACT text of the chosen candidate, or empty string if none fit' },
                    confidence: { type: 'NUMBER', description: '0.0 to 1.0' }
                },
                required: ['id', 'match', 'confidence']
            }
        }
    },
    required: ['matches']
};
export function biqBuildDiscernPrompt(slots) {
    const lines = slots.map(s =>
        `- id "${s.id}" (${s.field}): customer wrote "${s.raw}". Candidates: ${s.candidates.map(c => '"' + c + '"').join(', ')}`);
    return `You map a window-blind customer's wording to a manufacturer's catalogue.
For each id below, choose the ONE candidate that means the same product attribute as what the customer wrote, or return an empty match if none genuinely fit.
Rules:
- "match" must be copied EXACTLY from that id's candidate list (or empty).
- Judge by product meaning: e.g. "Roller Blind" = "Element Roller Sys 40"; "blockout"/"block" fabrics map to block ranges; abbreviations and word-order differences are fine.
- confidence: 0.9+ only when you are sure; 0.6-0.9 if plausible; below 0.5 if guessing.
- Never invent a candidate that is not listed.

${lines.join('\n')}`;
}

// Apply AI matches by confidence. "both by confidence":
//   >= autoAt  -> auto-apply (marked _ai='auto', amber, must be verified)
//   >= suggestAt -> suggestion only (_ai='suggest', not applied)
//   else        -> ignored (stays unresolved / red)
// Returns a per-slot report for the UI.
export function biqApplyDiscernment(mappings, order, matches, opts) {
    opts = opts || {};
    const autoAt = opts.autoAt != null ? opts.autoAt : 0.85;
    const suggestAt = opts.suggestAt != null ? opts.suggestAt : 0.5;
    const byId = {}; (matches || []).forEach(m => { byId[m.id] = m; });
    const report = [];
    order.items.forEach((it, i) => {
        ['blindType', 'range', 'colour', 'control1', 'control2', 'fix'].forEach(field => {
            const m = byId['i' + i + '.' + field];
            if (!m || !biqNorm(m.match)) return;
            const conf = +m.confidence || 0;
            it._ai = it._ai || {};
            if (conf >= autoAt) {
                it._aiOrig = it._aiOrig || {};
                if (it._aiOrig[field] === undefined) it._aiOrig[field] = it[field];
                it[field] = biqNorm(m.match);
                it._ai[field] = { mode: 'auto', from: it._aiOrig[field], to: biqNorm(m.match), confidence: conf };
                report.push({ idx: i, field, mode: 'auto', raw: it._aiOrig[field], match: biqNorm(m.match), confidence: conf });
            } else if (conf >= suggestAt) {
                it._ai[field] = { mode: 'suggest', from: it[field], to: biqNorm(m.match), confidence: conf };
                report.push({ idx: i, field, mode: 'suggest', raw: it[field], match: biqNorm(m.match), confidence: conf });
            }
        });
    });
    return report;
}
// Accept a pending suggestion (capturer clicked it).
export function biqAcceptSuggestion(order, idx, field) {
    const it = order.items[idx]; if (!it || !it._ai || !it._ai[field]) return;
    it._aiOrig = it._aiOrig || {}; if (it._aiOrig[field] === undefined) it._aiOrig[field] = it[field];
    it[field] = it._ai[field].to;
    it._ai[field].mode = 'auto';
}
// Persist confirmed AI picks as learned aliases so they resolve deterministically next time.
// Call on download (capturer endorsed the order). Returns [{cat,key,...}] saved.
export function biqLearnFromAI(mappings, order) {
    const learned = [];
    order.items.forEach(it => {
        if (!it._ai || !it._aiOrig) return;
        const rec = (cat, key, id) => { if (id != null && mappings[cat] && mappings[cat][key] == null) { mappings[cat][key] = id; learned.push({ cat, key, id }); } };
        Object.keys(it._ai).forEach(field => {
            if (it._ai[field].mode !== 'auto') return;         // only confirmed/auto, not pending suggestions
            const orig = it._aiOrig[field]; if (!biqLc(orig)) return;
            if (field === 'blindType') { const r = biqResolve(mappings, 'blindTypes', it.blindType); rec('blindTypes', biqLc(orig), r.id); }
            else if (field === 'fix') { const r = biqResolve(mappings, 'fixes', it.fix); rec('fixes', biqLc(orig), r.id); }
            else if (field === 'control1') { const r = biqResolve(mappings, 'control1', it.control1); rec('control1', biqLc(orig), r.id); }
            else if (field === 'control2') { const r = biqResolve(mappings, 'control2', it.control2); rec('control2', biqLc(orig), r.id); }
            else if (field === 'range') { const r = biqResolveRange(mappings, it.blindType, it.range); if (r.known) { const bt = biqResolve(mappings, 'blindTypes', it.blindType); if (bt.known) { const k = bt.id + '|' + biqLc(orig); if (mappings.rangesScoped[k] == null) { mappings.rangesScoped[k] = r.id; learned.push({ cat: 'rangesScoped', key: k, id: r.id }); } } } }
            else if (field === 'colour') { const r = biqResolveColour(mappings, it.range, it.colour); if (r.known) rec('colours', '|' + biqLc(orig), r.id); }
        });
    });
    return learned;
}

// =============================================================================
// SHUTTER CONFIGURATION + OPTION DEFAULTS
// Config string encodes panels (L=left hinge, R=right hinge) interleaved with
// T-posts (T): "LTLTRTR" = 4 panels (L,L,R,R) split by T-posts. Adjacent same-
// side letters (LL/RR, no T) = a double-hinge; adjacent different-side (LR/RL,
// no T) = a fold; panels split by T = independent hinged panels.
// =============================================================================
const BIQ_SHUTTER_TYPES = new Set(['urban hinged shutter', 'altra hinged shutter', 'altra fold shutter']);

export function biqDecodeShutterConfig(raw) {
    const s = String(raw || '').toUpperCase().replace(/[^LRT]/g, '');
    if (!s || !/[LR]/.test(s)) return null;
    const panels = (s.match(/[LR]/g) || []).length;
    const doubleHinge = /LL|RR/.test(s);
    let fold = false;
    for (let i = 0; i < s.length - 1; i++) {
        const a = s[i], b = s[i + 1];
        if (/[LR]/.test(a) && /[LR]/.test(b) && a !== b) fold = true;  // LR/RL adjacency, no T
    }
    const type = doubleHinge ? 'Double Hinged' : (fold ? 'Fold' : 'Hinged');
    return { panels, type, doubleHinge, fold, raw: s };
}

// Pick the best BlindIQ range name for a decoded config under a given blind type,
// trying the config's type first, then falling back to whatever that blind type
// actually offers (Urban only has "N Panel Hinged", so a double-hinge there still
// maps to the hinged range and keeps the double-hinge as a detail).
export function biqShutterRangeFromConfig(mappings, blindType, d, tier) {
    if (!d) return null;
    const bt = biqResolve(mappings, 'blindTypes', blindType);
    if (!bt.known) return null;
    const suffix = tier ? ' Tier on Tier' : '';
    const candidates = [
        d.panels + ' Panel ' + d.type + suffix,
        d.panels + ' Panel Hinged' + suffix,
        d.panels + ' Panel ' + d.type,
        d.panels + ' Panel Hinged',
        d.panels + ' Panel Fold'
    ];
    // SCOPED-only: a range must exist under THIS blind type (Urban has no Double Hinged/Fold,
    // so those names must NOT be borrowed from Altra via the global fallback).
    for (const c of candidates) if ((mappings.rangesScoped || {})[bt.id + '|' + biqLc(c)] != null) return c;
    return null;
}

// Auto-derive shutter range + layout details from a configuration string found in
// the range field (e.g. "LTLTRTR") or a "Configuration" option.
export function biqApplyShutterConfig(mappings, order) {
    (order ? order.items : []).forEach(it => {
        if (!BIQ_SHUTTER_TYPES.has(biqLc(it.blindType))) return;
        let cfg = '';
        const cv = it.variants.find(v => /^config/i.test(v[0]));
        if (cv && biqNorm(cv[1])) cfg = cv[1];
        else if (/^[lrt\s]+$/i.test(biqNorm(it.range)) && /[lr]/i.test(it.range)) cfg = it.range;
        if (!cfg) return;
        const d = biqDecodeShutterConfig(cfg);
        if (!d) return;
        const tier = /tier/i.test(it.notes || '') || it.variants.some(v => /tier on tier/i.test(v[0]) && /yes/i.test(v[1]));
        const rn = biqShutterRangeFromConfig(mappings, it.blindType, d, tier);
        if (rn) it.range = rn;                      // resolves; otherwise leave (flags for review)
        // Layout detail is NOT a BlindIQ option — record it in the item notes (a valid free-text field).
        const note = 'Config ' + d.raw + (d.doubleHinge ? ' (double hinge)' : (d.fold ? ' (fold)' : ''));
        if (!biqLc(it.notes).includes('config ' + biqLc(d.raw))) it.notes = it.notes ? it.notes + ' | ' + note : note;
        it._cfgPanels = d.panels;
    });
}

// Some dealers spell the same physical option differently. Fold those synonyms onto
// BlindIQ's canonical option key BEFORE defaults run, so the customer's explicit value
// (e.g. Hardware Colour = Grey) populates the real option (Mech Colour) and wins over the
// template default (White). The duplicate alias row is removed. Explicit value always wins:
// an explicitly-set canonical value is kept; otherwise the alias value fills it.
// Map dealer wording onto BlindIQ's real option keys before defaults run. Two rule kinds:
//   • rename  ({aliases,to})            — alias key folds onto canonical key, value preserved, explicit canonical wins.
//   • value-coded ({aliases,to,value}) — alias asserts a fixed canonical value (e.g. a "centre bracket"
//                                         note means Intermediate Bracket = Yes). Optional whenValue gates on
//                                         the alias's own value; fromNotes also scans the item notes.
// Value-coded rules fill the canonical option when it is empty OR currently holds a value that isn't in the
// catalogue's allowed list (e.g. a seeded "No" on a Yes-only toggle), but never override a valid explicit value.
const BIQ_OPTION_REMAPS = [
    { aliases: ['hardware colour', 'hardware color', 'h/ware colour', 'hware colour', 'hardware col', 'mechanism colour', 'mechanism color', 'mech color', 'hardware', 'comp', 'comp col', 'comp colour', 'component colour'], to: 'Mech Colour' },
    { aliases: ['bott bar col', 'bottom bar col', 'bottom bar colour', 'bott bar colour'], to: 'Bottom Bar' },
    { aliases: ['roll'], to: 'Roll Type' },
    { aliases: ['int bracket'], to: 'Intermediate Bracket' },
    { aliases: ['chain type', 'steel chain'], to: 'Steel Ball Chain', value: 'Yes', whenValue: /steel|yes/i }
    // NOTE: centre/intermediate/coupled brackets are handled by biqApplyBracketPairs (they pair two
    // lines and set controls + Yes/No), not as a per-line option remap.
];
export function biqFoldOptionSynonyms(mappings, order) {
    (order ? order.items : []).forEach(it => {
        const spec = biqVariantSpec(mappings, it.blindType);
        const specKeys = spec ? new Set(spec.map(o => biqLc(o.k))) : null;
        BIQ_OPTION_REMAPS.forEach(rule => {
            const toLc = biqLc(rule.to);
            const canonValid = !specKeys || specKeys.has(toLc);     // canonical is a real option here
            const specOpt = spec ? spec.find(o => biqLc(o.k) === toLc) : null;
            const canonKey = specOpt ? specOpt.k : rule.to;
            const allowed = specOpt && specOpt.values ? specOpt.values.map(biqLc) : null;
            const setCanon = val => {
                if (!canonValid) return;
                const cv = it.variants.find(v => biqLc(v[0]) === toLc);
                if (!cv) { it.variants.push([canonKey, val]); return; }
                const cur = biqNorm(cv[1]);
                const curValid = !cur ? false : (!allowed || allowed.length === 0 || allowed.includes(biqLc(cur)));
                if (!cur || !curValid) cv[1] = val;                  // fill blank or replace an invalid seed; valid explicit wins
            };
            // alias option rows
            for (let idx = it.variants.length - 1; idx >= 0; idx--) {
                if (!rule.aliases.includes(biqLc(it.variants[idx][0]))) continue;
                const aliasVal = biqNorm(it.variants[idx][1]);
                if (rule.value) {
                    if (!rule.whenValue || rule.whenValue.test(aliasVal)) setCanon(rule.value);
                } else if (aliasVal && canonValid) {                  // rename, preserve value, explicit wins
                    const cv = it.variants.find(v => biqLc(v[0]) === toLc);
                    if (!cv) it.variants.push([canonKey, it.variants[idx][1]]);
                    else if (!biqNorm(cv[1])) cv[1] = it.variants[idx][1];
                }
                it.variants.splice(idx, 1);                           // always drop the alias/phantom row
            }
            // notes-derived enable (value-coded only)
            if (rule.fromNotes && rule.value && biqNorm(it.notes)) {
                const nl = biqLc(it.notes);
                if (rule.aliases.some(a => nl.includes(a))) setCanon(rule.value);
            }
        });
    });
}

// Fill omitted options with sensible defaults so the capturer sees the real standard:
//  - REQUIRED: matrix default if present; Yes/No-type (or free-text like "Split Tier on Tier") -> "No";
//              genuine multi-choice with no default (Frame, Rail Size, Louvre, Closure) -> left to flag.
//  - OPTIONAL Yes/No toggles (Steel Ball Chain, SmartRail, Intermediate Bracket, ...): default "No"
//    unless stipulated. (On export, "No" toggles collapse to nothing — absence = No in BlindIQ.)
export function biqApplyOptionDefaults(mappings, order) {
    (order ? order.items : []).forEach(it => {
        const spec = biqVariantSpec(mappings, it.blindType);
        if (!spec) return;
        spec.forEach(o => {
            const f = it.variants.find(v => biqLc(v[0]) === biqLc(o.k));
            if (f && biqNorm(f[1])) return;            // already set
            const vals = (o.values || []).map(biqLc);
            const isToggle = vals.length > 0 && vals.every(v => v === 'yes' || v === 'no');
            const isColour = /colou?r/i.test(o.k);     // colour is order-specific — never silently default it
            if (o.req) {
                if (isColour) return;                  // leave blank so collectProblems flags it for the capturer
                let def = '';
                if (o.def && biqNorm(o.def)) def = o.def;
                else if (vals.length === 0) def = 'No';     // free-text required (e.g. Split Tier on Tier) -> No
                else if (isToggle) def = 'No';
                if (def) { biqSetVar(it.variants, o.k, def); it._optDefaulted = true; }
            } else if (isToggle) {
                biqSetVar(it.variants, o.k, 'No');         // optional toggle, not stipulated -> No
                it._optDefaulted = true;
            }
        });
    });
}

// Copy the set variant options from one line to chosen others. overwrite=false fills
// only blanks on the targets; overwrite=true replaces. Returns count of values written.
export function biqCopyOptions(order, srcIdx, targetIdxs, opts) {
    opts = opts || {};
    const src = order.items[srcIdx]; if (!src) return 0;
    const srcVars = src.variants.filter(v => biqNorm(v[1]));
    let n = 0;
    (targetIdxs || []).forEach(ti => {
        const t = order.items[ti]; if (!t || t === src) return;
        srcVars.forEach(([k, val]) => {
            const f = t.variants.find(v => biqLc(v[0]) === biqLc(k));
            if (f) { if (opts.overwrite || !biqNorm(f[1])) { f[1] = val; n++; } }
            else { t.variants.push([k, val]); n++; }
        });
    });
    return n;
}

// =============================================================================
// CONTROL INFERENCE + DUAL-CONTROL REQUIREMENT
// Roller/vision-type blinds drive on one side and idle (pin) on the other. If the
// order states one side's drive (chain/motor) and leaves the other blank, infer the
// opposite side as a Pin — UNLESS the blind is coupled / has an intermediate bracket
// (then the idle side is an intermediate, which the capturer must specify).
// =============================================================================
export function biqRequiresDualControl(mappings, blindType) {
    const bt = biqResolve(mappings, 'blindTypes', blindType);
    if (!bt.known) return /roller|vision/.test(biqLc(blindType)) && !/valance/.test(biqLc(blindType));
    for (const [k, v] of Object.entries(mappings.blindTypes || {}))
        if (v === bt.id && /roller|vision/.test(k) && !/valance/.test(k)) return true;
    return false;
}
export function biqInferControls(mappings, order) {
    (order ? order.items : []).forEach(it => {
        if (!biqRequiresDualControl(mappings, it.blindType)) return;
        const c1 = biqLc(it.control1), c2 = biqLc(it.control2);
        if (/intermediate|coupled/.test(c1) || /intermediate|coupled/.test(c2)) return;   // already a coupled/intermediate config
        const blocked = it.variants.some(v => /intermediate bracket|coupled bracket/i.test(v[0]) && /yes/i.test(biqNorm(v[1])));
        if (blocked) return;
        const drive = s => /chain|motor|crank|wand|cord|spring/.test(s);
        if (drive(c2) && !c1) { it.control1 = 'Lh Pin'; it._ctlInferred = true; }
        else if (drive(c1) && !c2) { it.control2 = 'Rh Pin'; it._ctlInferred = true; }
    });
}

// ---------- shared brackets (intermediate / coupled) ----------
// Which side carries the drive (chain/motor/etc.): 'L', 'R', 'B' (both) or null (none).
function biqDriveSide(it) {
    const drive = s => /chain|motor|crank|wand|cord|spring/i.test(biqLc(s));
    const l = drive(it.control1), r = drive(it.control2);
    if (r && !l) return 'R';
    if (l && !r) return 'L';
    if (l && r) return 'B';
    return null;
}
// Re-label a control onto a given side, preserving the drive type (Chain, Motor, …).
function biqReSide(ctrlText, side) {
    const t = biqNorm(ctrlText).replace(/^(lh|rh)\s+/i, '').trim() || 'Chain';
    return (side === 'L' ? 'Lh ' : 'Rh ') + t;
}
// INTERMEDIATE bracket: two blinds share a bracket but operate independently (two drives).
// Each blind keeps its own drive; its non-drive (inner/shared) side becomes "[side] Intermediate".
// Bracket is costed once: Intermediate Bracket = Yes on the first line, No on the second.
export function biqApplyIntermediatePair(order, i, j) {
    [i, j].forEach(idx => {
        const it = order.items[idx]; if (!it) return;
        const s = biqDriveSide(it);
        if (s === 'R') it.control1 = 'Lh Intermediate';            // drive right -> left is shared
        else if (s === 'L') it.control2 = 'Rh Intermediate';       // drive left  -> right is shared
        else if (s === 'B') { /* two drives, no free side — leave for the capturer */ }
        else if (/pin/i.test(it.control1)) it.control1 = 'Lh Intermediate';
        else if (/pin/i.test(it.control2)) it.control2 = 'Rh Intermediate';
        else it.control1 = 'Lh Intermediate';
    });
    biqSetVar(order.items[i].variants, 'Intermediate Bracket', 'Yes');
    biqSetVar(order.items[j].variants, 'Intermediate Bracket', 'No');
    order.items[i]._bracketRole = 'intermediate-1'; order.items[j]._bracketRole = 'intermediate-2';
}
// COUPLED bracket: two blinds joined, operated by ONE drive on one outer end. The two inner sides
// are "Coupled"; the operating blind's outer side keeps its drive (chain/motor); the partner's
// outer side is a Pin. i = first/left line, j = second/right line. Coupled Bracket Yes on i, No on j.
export function biqApplyCoupledPair(order, i, j) {
    const a = order.items[i], b = order.items[j]; if (!a || !b) return;
    const sa = biqDriveSide(a), sb = biqDriveSide(b);
    let opIsA = (sa && sa !== 'B');
    if (!(sa && sa !== 'B') && (sb && sb !== 'B')) opIsA = false;
    const driveOf = (it, s) => (s === 'L') ? it.control1 : (s === 'R') ? it.control2
        : (/chain|motor/i.test(biqLc(it.control1)) ? it.control1 : it.control2);
    a.control2 = 'Rh Coupled';                                     // a inner (right)
    b.control1 = 'Lh Coupled';                                     // b inner (left)
    if (opIsA) {
        a.control1 = biqReSide(driveOf(a, sa) || 'Chain', 'L');    // a outer left = drive
        b.control2 = 'Rh Pin';                                     // b outer right = pin
    } else {
        b.control2 = biqReSide(driveOf(b, sb) || 'Chain', 'R');    // b outer right = drive
        a.control1 = 'Lh Pin';                                     // a outer left = pin
    }
    biqSetVar(a.variants, 'Coupled Bracket', 'Yes');
    biqSetVar(b.variants, 'Coupled Bracket', 'No');
    a._bracketRole = 'coupled-1'; b._bracketRole = 'coupled-2';
}
// Detect/apply shared brackets across the order. Manual "couple with next line" (it._bracketWith)
// wins; otherwise consecutive lines flagged (notes or an explicit Yes) are paired two-by-two.
// A flagged line with no pair is marked (_bracketOdd) so collectProblems can surface it.
export function biqApplyBracketPairs(mappings, order) {
    const items = (order && order.items) || [];
    items.forEach(it => { delete it._bracketOdd; delete it._bracketRole; });
    const consumed = new Set();
    const flag = it => {
        const optYes = key => it.variants.some(v => biqLc(v[0]) === key && biqLc(v[1]) === 'yes');
        const note = biqNorm(it.notes);
        if (/\bcoupl/i.test(note) || optYes('coupled bracket')) return 'coupled';
        if (/\b(centre|center|middle|intermediate)\s+brackets?\b/i.test(note) || optYes('intermediate bracket')
            || it.variants.some(v => /\b(centre|center|middle)\s+brackets?\b/i.test(biqLc(v[0])))) return 'intermediate';
        return null;
    };
    for (let i = 0; i < items.length; i++) {                       // manual: couple with next line
        const m = items[i]._bracketWith;
        if (m && i + 1 < items.length && !consumed.has(i) && !consumed.has(i + 1)) {
            if (m === 'coupled') biqApplyCoupledPair(order, i, i + 1); else biqApplyIntermediatePair(order, i, i + 1);
            consumed.add(i); consumed.add(i + 1);
        }
    }
    let i = 0;                                                     // auto: pair consecutive flagged lines
    while (i < items.length) {
        if (consumed.has(i) || !flag(items[i])) { i++; continue; }
        const f = flag(items[i]); const run = []; let j = i;
        while (j < items.length && !consumed.has(j) && flag(items[j]) === f) { run.push(j); j++; }
        let k = 0;
        for (; k + 1 < run.length; k += 2) {
            if (f === 'coupled') biqApplyCoupledPair(order, run[k], run[k + 1]); else biqApplyIntermediatePair(order, run[k], run[k + 1]);
            consumed.add(run[k]); consumed.add(run[k + 1]);
        }
        if (k < run.length) { items[run[k]]._bracketOdd = f; consumed.add(run[k]); }
        i = j;
    }
    // signal now lives in controls + the Intermediate/Coupled Bracket options — drop any phantom key
    items.forEach(it => { it.variants = it.variants.filter(v => !/\b(centre|center|middle)\s+brackets?\b/i.test(biqLc(v[0]))); });
}

// ---------- per-customer FORMAT PROFILES (the format learner) ----------
// Each customer submits orders in their own consistent house style. We learn, per customer,
// the dealer-wording -> BlindIQ-value mappings that the global catalogue/aliases DON'T already
// cover (i.e. the corrections a capturer makes), plus their usual delivery/packing defaults and
// source type. On the next order we use that memory to fill ONLY values that don't already
// resolve — never overriding a value that resolves or one a person set. Profiles are keyed by
// the canonical BlindIQ customer account, so one branch's quirks never leak into another's.
const BIQ_FMT_FIELDS = [['blindType', 'blindTypes'], ['fix', 'fixes'], ['control1', 'control1'], ['control2', 'control2']];
export function biqProfileKey(mappings, customerName) {
    const canon = biqCanonicalCustomerName ? biqCanonicalCustomerName(mappings, customerName) : customerName;
    return biqLc(canon || customerName);
}
// Snapshot the raw dealer wording once, before any resolution/canonicalisation rewrites it.
export function biqStampOriginals(order) {
    (order ? order.items : []).forEach(it => {
        if (!it._orig) it._orig = { blindType: it.blindType, range: it.range, colour: it.colour, control1: it.control1, control2: it.control2, fix: it.fix };
    });
}
export function biqGetProfile(profiles, key) { return (profiles && profiles[key]) || null; }
// Apply a customer's learned format. Only fills fields that DON'T currently resolve, and only
// with a learned value that itself resolves in the live catalogue. Returns what it filled.
export function biqApplyFormatProfile(mappings, profiles, order) {
    if (!order || !order.customer) return [];
    const p = biqGetProfile(profiles, biqProfileKey(mappings, order.customer));
    if (!p || !p.vocab) return [];
    const applied = [];
    order.items.forEach((it, i) => {
        BIQ_FMT_FIELDS.forEach(([f, cat]) => {
            const cur = it[f];
            if (cur && biqResolve(mappings, cat, cur).known) return;          // already resolves — leave it
            const term = biqLc(cur || (it._orig && it._orig[f]) || '');
            if (!term) return;
            const e = p.vocab[cat] && p.vocab[cat][term];
            if (e && e.n >= 1 && biqResolve(mappings, cat, e.value).known) { it[f] = e.value; applied.push({ i, field: f, from: cur, to: e.value }); }
        });
        // colour is scoped by range
        if (!biqResolveColour(mappings, it.range, it.colour).known) {
            const term = biqLc((it._orig && it._orig.colour) || it.colour || '');
            const e = term && p.vocab.colours && p.vocab.colours[biqLc(it.range) + '|' + term];
            if (e && e.n >= 1 && biqResolveColour(mappings, it.range, e.value).known) { it.colour = e.value; applied.push({ i, field: 'colour', from: it.colour, to: e.value }); }
        }
    });
    if (!order.deliveryMethod && p.defaults && p.defaults.deliveryMethod) order.deliveryMethod = p.defaults.deliveryMethod;
    if (!order.packingType && p.defaults && p.defaults.packingType) order.packingType = p.defaults.packingType;
    return applied;
}
// Learn from a finished order: capture dealer-term -> canonical for fields that resolved but whose
// original wording the global catalogue does NOT already handle (i.e. the human's corrections).
// Returns { profile, learned:[], drift:bool }.
// Fields whose movement between columns we watch (the capturer-moved-it-elsewhere signal).
const BIQ_MOVE_FIELDS = ['blindType', 'range', 'colour', 'control1', 'control2', 'fix'];
export function biqLearnFormat(mappings, profiles, order) {
    if (!order || !order.customer) return null;
    const key = biqProfileKey(mappings, order.customer);
    const p = profiles[key] || (profiles[key] = { customer: order.customer, sourceType: '', orders: 0, vocab: { blindTypes: {}, colours: {}, control1: {}, control2: {}, fixes: {} }, defaults: {}, log: [], updatedAt: '' });
    if (!p.log) p.log = [];
    const learned = [], moves = [];
    const drift = !!(p.sourceType && order.source && p.sourceType !== order.source);
    p.orders++; if (order.source) p.sourceType = order.source; p.updatedAt = new Date().toISOString();
    const ts = p.updatedAt;
    const src = biqLc(order._sourceText || '');
    // ATTRIBUTION: a value is only a genuine conversion miss if it was actually on the customer document.
    // If we have the source text and the term isn't in it, the capturer sourced it (e.g. phoned the customer) -> don't learn it as a rule.
    const onDoc = term => !src || src.includes(biqLc(term));
    const logPush = e => { p.log.push(e); if (p.log.length > 150) p.log.shift(); };   // bounded ledger of real corrections
    const rec = (cat, term, value) => {
        term = biqLc(term); if (!term || !value) return;
        const present = onDoc(term);
        logPush({ field: cat, term, value, onDoc: present, t: ts });
        if (!present) return;                                                  // not on the document -> don't learn as a conversion rule
        const slot = p.vocab[cat] || (p.vocab[cat] = {});
        const e = slot[term];
        if (e && biqLc(e.value) === biqLc(value)) e.n++; else slot[term] = { value, n: 1 };
        learned.push({ cat, term, value });
    };
    order.items.forEach(it => {
        const o = it._orig || {};
        BIQ_FMT_FIELDS.forEach(([f, cat]) => {
            const term = (o[f] != null ? o[f] : it[f]), val = it[f];
            if (!term || !val || biqLc(term) === biqLc(val)) return;            // nothing to learn
            if (biqResolve(mappings, cat, term).known) return;                   // global already handles this wording
            if (biqResolve(mappings, cat, val).known) rec(cat, term, val);       // learn dealer term -> canonical
        });
        const cterm = (o.colour != null ? o.colour : it.colour), cval = it.colour;
        if (cterm && cval && biqLc(cterm) !== biqLc(cval)
            && !biqResolveColour(mappings, it.range, cterm).known
            && biqResolveColour(mappings, it.range, cval).known) rec('colours', biqLc(it.range) + '|' + cterm, cval);
        // FIELD-MOVE detection (data only — recorded, never auto-applied): a value the converter put
        // in field A that the capturer moved to field B. Reveals where this customer's format misplaces things.
        BIQ_MOVE_FIELDS.forEach(A => {
            const av = biqNorm(o[A] || ''); if (!av || biqLc(av) === biqLc(it[A] || '')) return;
            BIQ_MOVE_FIELDS.forEach(B => {
                if (B === A) return;
                const bv = biqLc(it[B] || '');
                if (bv && bv.includes(biqLc(av)) && biqLc(o[B] || '') !== bv) {
                    moves.push({ from: A, to: B, value: av });
                    logPush({ move: A + '->' + B, term: biqLc(av), onDoc: onDoc(av), t: ts });
                }
            });
        });
    });
    if (order.deliveryMethod) p.defaults.deliveryMethod = order.deliveryMethod;
    if (order.packingType) p.defaults.packingType = order.packingType;
    return { profile: p, learned, moves, drift };
}

// BlindIQ mappings are the source of truth: once a field resolves to an ID, replace the
// dealer's wording with BlindIQ's canonical name. Unresolved fields are left as-is so the
// capturer still sees what was on the order. Idempotent.
export function biqCanonicalize(mappings, order) {
    const N = mappings;
    (order ? order.items : []).forEach(it => {
        const bt = biqResolve(N, 'blindTypes', it.blindType); if (bt.known && N.blindTypeNames && N.blindTypeNames[bt.id]) it.blindType = N.blindTypeNames[bt.id];
        const rr = biqResolveRange(N, it.blindType, it.range); if (rr.known && N.rangeNames && N.rangeNames[rr.id]) it.range = N.rangeNames[rr.id];
        const rc = biqResolveColour(N, it.range, it.colour); if (rc.known && N.colourNames && N.colourNames[rc.id]) it.colour = N.colourNames[rc.id];
        const r1 = biqResolve(N, 'control1', it.control1); if (r1.known && r1.id != null && N.controlNames && N.controlNames[r1.id]) it.control1 = N.controlNames[r1.id];
        const r2 = biqResolve(N, 'control2', it.control2); if (r2.known && r2.id != null && N.controlNames && N.controlNames[r2.id]) it.control2 = N.controlNames[r2.id];
        const rf = biqResolve(N, 'fixes', it.fix); if (rf.known && rf.id != null && N.fixNames && N.fixNames[rf.id]) it.fix = N.fixNames[rf.id];
    });
}
