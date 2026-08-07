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
    fabricSplits: {}, rangesScoped: {}, rangeFormulas: {}, sundries: {}, sundryTypes: {}, variantTemplates: {},
    // Per-blind-type availability matrices (from BlindIQ's own linkage tables, via SQL export).
    // controlsScoped: { "<blindTypeId>": [controlId,...] } or { "<id>": {c1:[...], c2:[...]} }.
    // Empty until the matrix is imported — all checks stay silent with no data.
    controlsScoped: {}, fixesScoped: {}
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
    variantTemplates: { label: 'Variant option templates (blindTypeId -> options)', xml: 'COI_VariantOptions' },
    variantSheetIndex: { label: 'Per-range option sheet index (blindTypeId|rangeId -> sheet)', xml: 'COI_VariantOptions' },
    variantTemplateSheets: { label: 'Per-range option sheets (BlindIQ Matrix tables)', xml: 'COI_VariantOptions' }
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
        'rev': 'reveal', 'rev l': 'reveal', 'rev r': 'reveal', 'reveal l': 'reveal', 'reveal r': 'reveal',
        'side fix': 'side', 'top fix': 'top'                        // TBD software wording (catalogue: side=6, top=7)
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
    // Exact key, and exact key + " #" — the catalogue carries "#"-marked entries
    // ("Motors Lift Assisting Spring L #", "Motors System 55 Motor Pack White
    // (55 Bracket) #") whose names dealers copy WITHOUT the marker.
    const exact = biqResolveSundry(mappings, text) || biqResolveSundry(mappings, text + ' #');
    if (exact) return Object.assign({ desc: biqLc(text), exact: true }, exact);
    const stop = new Set(['for', 'the', 'and', 'with', 'x']);
    // Single-character tokens are kept: digits distinguish real parts ("smoove
    // origin 4" vs "origin 2", "ysia 1" vs "ysia 5"), letters distinguish sides
    // ("lift assisting spring L" vs "R"). They match on word boundaries (not
    // substring), so "4" can never match inside "40" nor "l" inside "lift".
    const tokens = biqLc(text).split(/[^a-z0-9.:]+/).filter(t => (t.length > 1 || /^[a-z0-9]$/.test(t)) && !stop.has(t));
    if (!tokens.length) return null;
    const tokMatch = (k, t) => t.length > 1 ? k.includes(t)
        : /^\d$/.test(t) ? new RegExp('(^|[^0-9.])' + t + '($|[^0-9.])').test(k)
        : new RegExp('(^|[^a-z0-9])' + t + '($|[^a-z0-9])').test(k);
    // Minimal-superset tiebreak: when several entries match, and exactly one of
    // them adds NO tokens beyond what the others also carry ("Mercure 3nm/30"
    // vs "Wood Ven Mercure 3nm/30 Ext Receiver"), the plain entry is what the
    // dealer named — pick it. Colour-only families (base/white/black adaptor
    // kits) are deliberately left ambiguous so the white-default rule decides.
    const tokensOfKey = k => k.split(/[^a-z0-9.:]+/).filter(t => (t.length > 1 || /^[a-z0-9]$/.test(t)) && !stop.has(t));
    const COLOUR_TOKENS = ['white', 'black', 'grey', 'gray', 'beige', 'anthracite', 'silver', 'cream', 'charcoal', 'bronze', 'natural'];
    const pickMinimal = (hitKeys, tokOf) => {
        const sets = hitKeys.map(k => ({ k, s: new Set(tokOf(k)) }));
        const minimal = sets.filter(a => sets.every(b => b === a || [...a.s].every(t => b.s.has(t))));
        if (minimal.length !== 1) return null;
        const m = minimal[0];
        const colourOnly = sets.every(b => b === m || [...b.s].filter(t => !m.s.has(t)).every(t => COLOUR_TOKENS.includes(t)));
        return colourOnly ? null : m.k;
    };
    // Alias dedupe: several catalogue keys can name the SAME item ("Sonesse
    // 30/28 Mag Charger" and "... Magnetic Adpater Charger USB-C" share one id)
    // — matching more than one alias of a single item is not ambiguity.
    const oneId = ks => { const ids = new Set(ks.map(k => String(mappings.sundries[k].sundry))); return ids.size === 1 ? ks[0] : null; };
    const hits = Object.keys(mappings.sundries || {}).filter(k => tokens.every(t => tokMatch(k, t)));
    if (hits.length === 1) { const e = mappings.sundries[hits[0]]; return { sundry: e.sundry, type: e.type, desc: hits[0], exact: false }; }
    if (hits.length > 1) {
        const mk = oneId(hits) || pickMinimal(hits, tokensOfKey);
        if (mk) { const e = mappings.sundries[mk]; return { sundry: e.sundry, type: e.type, desc: mk, exact: false }; }
        return { ambiguous: hits.length };
    }
    // second pass: gentle spelling synonyms (li-ion <-> lithium ion, "2.0nm" <-> "2nm")
    // "adaptor" family: BlindIQ itself carries typo'd entries ("Sys 55 Motor
    // Adpator Kit...", "... Adpater Kit ...") — normalize all spellings on both
    // sides so correctly-spelled dealer text can still find them.
    // Torque/speed ratios: "15Nm/17" <-> "15/17" (BlindIQ's motors entries write
    // the ratio bare, its duplicate type-23 entries write Nm; dealers use either).
    const canon = str => str.replace(/li-ion/g, 'lithiumion').replace(/lithium\s+ion/g, 'lithiumion').replace(/(\d)\.0\s*nm/g, '$1nm').replace(/\s+nm/g, 'nm').replace(/(\d)\s*nm\s*\//g, '$1/').replace(/\badp?at[oe]r\b|\badapt[oe]r\b/g, 'adaptor');
    // Same token rules as pass 1 (single digits/letters kept, boundary-matched):
    // dropping them here made "Sonesse 40 RTS 3Nm/30" collide with the
    // "40/30/28" charger once the Nm canon stripped the ratio marker.
    const ctokens = canon(biqLc(text)).split(/[^a-z0-9.:]+/).filter(t => (t.length > 1 || /^[a-z0-9]$/.test(t)) && !stop.has(t));
    const chits = Object.keys(mappings.sundries || {}).filter(k => { const ck = canon(k); return ctokens.every(t => tokMatch(ck, t)); });
    if (chits.length === 1) { const e = mappings.sundries[chits[0]]; return { sundry: e.sundry, type: e.type, desc: chits[0], exact: false }; }
    if (chits.length > 1) {
        const mk = oneId(chits) || pickMinimal(chits, k => tokensOfKey(canon(k)));
        if (mk) { const e = mappings.sundries[mk]; return { sundry: e.sundry, type: e.type, desc: mk, exact: false }; }
        return { ambiguous: chits.length };
    }
    return null;
}
// BlindIQ motor orders: the capturer first picks the sundry TYPE, then the item
// linked to it. Motor/remote/accessory sundries must therefore resolve to items
// under the seven motor sundry types below (Russel 2026-08-07). The "Motors …"
// entries under type 13 "components motor" are factory component records, NOT
// orderable motor sundries — excluded from motor resolution entirely.
export const BIQ_MOTOR_ORDER_TYPES = ['motors somfy rts', 'motors motion', 'motors one touch +',
    'motors one touch dual', 'motors somfy zigbee', 'motors somfy io', 'motors shawsmart'];
// Filtered mappings view holding only motor-order-type sundries. Falls back to
// the full view when sundryTypes hasn't loaded (seeds/offline) so nothing breaks.
export function biqMotorSundryView(mappings) {
    const ids = new Set(BIQ_MOTOR_ORDER_TYPES.map(n => String((mappings.sundryTypes || {})[n])).filter(s => s && s !== 'undefined'));
    if (!ids.size) return mappings;
    const sundries = {};
    for (const [k, e] of Object.entries(mappings.sundries || {})) if (ids.has(String(e.type))) sundries[k] = e;
    return Object.keys(sundries).length ? { sundries } : mappings;
}
// Turn motorisation text (motor / remote / adapter) into an order sundry line,
// aggregating duplicates by description.
export function biqAddMotorSundry(mappings, order, text, qty, motorContext) {
    const t = biqNorm(text); if (!t) return;
    const existing = order.sundries.find(su => biqLc(su.notes) === biqLc(t) || (su._src && biqLc(su._src) === biqLc(t)));
    if (existing) { existing.qty = String((+existing.qty || 0) + (+qty || 1)); return; }
    // motorContext restricts resolution to the seven BlindIQ motor sundry types,
    // which also removes the old type-13 "Motors <name>" duplicate ambiguity.
    // The variant ladder bridges dealer shorthand to catalogue phrasing WITHOUT loosening the
    // unique-match rule: "16ch" -> "16 channel" (one touch remotes), "4ch" -> "4" (smoove origin),
    // and a parenthetical-stripped form ("Tahoma Switch Pro (ZB)" -> "Tahoma Switch Pro").
    // First variant that yields a unique hit wins; anything still unmatched stays blank + flagged.
    const view = motorContext ? biqMotorSundryView(mappings) : mappings;
    const variants = [];
    // Dealer sheets append marketing tails the catalogue never carries —
    // "... (max width 4000mm) Available in white, black and grey" (Blind Guys
    // accessory column). Parentheticals were already stripped; also cut a
    // trailing "Available in ..." clause so the part name alone can match.
    const noTail = biqNorm(t.replace(/\([^)]*\)/g, ' ').replace(/\bavailable in\b.*$/i, ' '));
    const bases = [t, biqNorm(t.replace(/\([^)]*\)/g, ' ')), noTail];
    // Dealer sheets prefix the brand ("Somfy Situo 5 RTS Pure") where the catalogue mostly
    // doesn't — try each base with a leading "Somfy" stripped too (Mathéo, Russel 2026-08-07).
    bases.slice().forEach(b => { const s = biqNorm(b.replace(/^somfy\s+/i, '')); if (s && s !== b && !bases.includes(s)) bases.push(s); });
    for (const base of bases) {
        for (const v of [base, base.replace(/(\d+)\s*ch\b/gi, '$1 channel'), base.replace(/(\d+)\s*ch\b/gi, '$1')]) {
            const n = biqNorm(v);
            if (n && !variants.includes(n)) variants.push(n);
        }
    }
    // Last resort, ZIGBEE ONLY: drop the Sonesse size qualifier — TBD prints "Sonesse 30/28 ZB
    // Solar Panel" while the catalogue's Zigbee accessories are size-less ("motors sonesse zigbee
    // solar panel li-ion"). Deliberately NOT applied to RTS/other lines: there the size picks
    // between real parts, and dropping it once mis-resolved a 30/28 charger to the RTS-30 one.
    if (/zigbee/i.test(t)) {
        for (const v of variants.slice()) {
            const n = biqNorm(v.replace(/\b40\/30\/28\b|\b30\/28\b/g, ' '));
            if (n && n !== v && !variants.includes(n)) variants.push(n);
        }
    }
    let hit = null;
    for (const v of variants) {
        const h = biqFuzzySundry(view, v);
        if (h && h.sundry != null) { hit = h; break; }
    }
    // Colour-variant parts (adaptor kits etc.) with NO colour in the order text:
    // default to the WHITE variant (Russel 2026-08-07) — retry with " white"
    // appended and accept only a unique hit, recorded as an assumption in the
    // notes. An explicit colour in the text (incl. one with no catalogue
    // variant, e.g. grey) never gets overridden — those stay flagged.
    let whiteAssumed = false;
    if (!hit && !/\b(white|black|grey|gray|beige|anthracite|silver|cream|charcoal|bronze|natural)\b/i.test(noTail)) {
        for (const v of variants) {
            const h = biqFuzzySundry(view, v + ' white');
            if (h && h.sundry != null) { hit = h; whiteAssumed = true; break; }
        }
    }
    const su = { code: '', qty: String(+qty || 1), type: '', sundry: '', notes: t, _src: t };
    if (hit && hit.sundry != null) {
        su.type = String(hit.type); su.sundry = String(hit.sundry);
        su.notes = whiteAssumed ? (t + ' — WHITE assumed (no colour on order)') : t;
    }
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
// Options are per type+range in BlindIQ (MatrixTriggers -> Matrix_Price_NN sheets, pass-2
// extract 2026-08-07). When the range is known and a per-range sheet is mapped, use it —
// this is what stops a Linear valance being asked for Finials (Deco Rod's sheet) or
// Fabric Insert (70mm Cassette's sheet). Fallback: the per-type union template.
// Data: variantSheetIndex {'<typeId>|<rangeId>': matrixId} + variantTemplateSheets {matrixId: [...]}.
export function biqVariantSpec(mappings, blindTypeName, rangeName) {
    const bt = biqResolve(mappings, 'blindTypes', blindTypeName);
    if (!bt.known) return null;
    if (rangeName) {
        const rr = biqResolveRange(mappings, blindTypeName, rangeName);
        if (rr.known) {
            const mid = (mappings.variantSheetIndex || {})[bt.id + '|' + rr.id];
            const sh = mid != null ? (mappings.variantTemplateSheets || {})[String(mid)] : null;
            if (sh && sh.length) return sh;
        }
    }
    const t = (mappings.variantTemplates || {})[String(bt.id)];
    return (t && t.length) ? t : null;
}
// Template as [key, default] pairs — DB spec when available, legacy heuristics otherwise.
export function biqTemplateFor2(mappings, blindTypeName, rangeName) {
    const spec = biqVariantSpec(mappings, blindTypeName, rangeName);
    if (spec) return spec.map(o => [o.k, o.def || '']);
    return biqTemplateFor(blindTypeName);
}
// Add any template keys missing from an item's variants (keeps existing values + order).
export function biqMergeTemplate(mappings, it) {
    const spec = biqVariantSpec(mappings, it.blindType, it.range);
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
    const spec = biqVariantSpec(mappings, it.blindType, it.range);
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
// Companion to biqEmittedVariants: everything the emit gate will WITHHOLD from BlindIQ, and why.
// July 2026 lesson (order BDO665087): cassettes, fabric inserts, a valance and a smart plug were
// silently discarded here and never produced. Anything on this list must be shown to the user —
// problems panel, red in the items table and the PDF preview — never silently lost.
// "No"/"None"/empty values are not losses (absence = default in BlindIQ), nor are known optional
// keys sitting at their default.
export function biqDroppedVariants(mappings, it) {
    const spec = biqVariantSpec(mappings, it.blindType, it.range);
    if (!spec) return [];
    const out = [];
    it.variants.forEach(v => {
        const val = biqNorm(v[1]);
        if (!biqNorm(v[0]) || !val || /^(no|none|false)$/i.test(val)) return;
        const o = spec.find(s => biqLc(s.k) === biqLc(v[0]));
        if (!o) { out.push({ k: v[0], v: v[1], why: 'not a ' + (it.blindType || 'known') + ' option in BlindIQ' }); return; }
        const allowed = (o.values || []).map(biqLc);
        if (allowed.length && !allowed.includes(biqLc(val)))
            out.push({ k: o.k, v: v[1], why: 'value not in BlindIQ\'s list (' + (o.values || []).slice(0, 5).join(' / ') + ((o.values || []).length > 5 ? ' …' : '') + ')' });
    });
    return out;
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
    it.variants = biqTemplateFor2(mappings, doubleRoller ? (product || 'Double Roller Blinds') : it.blindType, it.range);
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
    // preferMotors=true (like the TBD path): the catalogue holds most parts twice
    // ("Motors Sonesse 40 RTS 3/30" type 13 AND "Sonesse 40 Rts 3nm/30" type 23);
    // without it the fuzzy match sees both and stays ambiguous -> blank sundry ->
    // BlindIQ asks the capturer for a part number on every motorised line
    // (Sharon's Blind Guys motors report, Paul 2026-08-07).
    if (motorTxt) biqAddMotorSundry(mappings, o, motorTxt, +it.qty || 1, true);
    if (remoteTxt) biqAddMotorSundry(mappings, o, remoteTxt, 1, true);
    if (accTxt) biqAddMotorSundry(mappings, o, accTxt, +it.qty || 1, true);
    if (!motorTxt && cleanVal(raw['Motor Type'])) it.notes = (it.notes ? it.notes + ' | ' : '') + 'Motor type: ' + cleanVal(raw['Motor Type']);
    // The sheet's valance column group can't ride on a roller line — BlindIQ orders a valance
    // as its own line (Linear / Half Round under the Valance products). Stage the whole group
    // for biqExpandValances; cleanVal already drops None/No cells so an unused group vanishes.
    // (End Cap Colour / LH Side / RH Side are the valance end-cap columns on this sheet.)
    const valCols = [['Valance Type', 'Type'], ['Valance Colour', 'Colour'], ['Custom Valance Width', 'Custom Width'],
        ['Valance Width', 'Width'], ['Valance Fix', 'Fix'], ['Valance Returns', 'Returns'],
        ['Top Board (for Face Fix):', 'Top Board'], ['Top Board (for Face Fix)', 'Top Board'],
        ['Mitre Valance LH', 'Mitre LH'], ['Mitre Valance RH', 'Mitre RH'],
        ['End Cap Colour', 'End Cap Colour'], ['LH Side', 'End Cap LH'], ['RH Side', 'End Cap RH']];
    const vstage = [];
    valCols.forEach(([col, kk]) => { const v = cleanVal(raw[col]); if (v && !vstage.some(s => s.startsWith('Valance ' + kk + '='))) vstage.push('Valance ' + kk + '=' + v); });
    if (vstage.some(s => /^Valance (Type|Colour|Width|Custom Width)=/i.test(s))) it._valance = vstage;
    // A valance-ONLY row: no blind type, no fabric, no drop — the row IS the valance
    // ("Spare Bathroom Valance only", Breed order J0000509-4). biqExpandValances
    // rebuilds this line in place as the valance product instead of leaving a
    // phantom roller plus a separate valance line with the wrong width.
    if (vstage.length && !cleanVal(raw['Type']) && !cleanVal(raw['Fabric']) && !cleanVal(raw['Finished Height'])) {
        it._valanceOnlyRow = true;
        it._valance = vstage;
    }
    const skip = new Set(['Item #', 'Location', 'Finished Width', 'Finished Height', 'Qty', 'Type', 'LH Control', 'RH Control', 'Control Length', 'Mechanism Colour', 'Bottom Bar Colour', 'Fabric', 'Fixing', 'Roll', 'Line Notes', 'Express', 'Front Blind Fabric', 'Back Blind Fabric', 'Configuration Front Blind', 'Configuration Back Blind', 'Cassette Colour', 'Fabric Insert Cassette', 'Roll Type Front', 'Roll Type Back', 'Steel Ball Chain', 'Remove Bracket Covers', 'Plastic Bottom Bar', 'Chain Tidy', 'Wired Side Guides', 'Fabric Only', 'Fabric Insert', 'System 40 70mm Cassette', 'Closed Cassette', 'Motor', 'Motor Type', 'Remotes', 'Accessory', 'Accessories', 'Valance Type', 'Valance Colour', 'Valance Width', 'Custom Valance Width', 'Valance Fix', 'Valance Returns', 'Top Board (for Face Fix):', 'Top Board (for Face Fix)', 'Mitre Valance LH', 'Mitre Valance RH', 'End Cap Colour', 'LH Side', 'RH Side']);
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
    it.variants = biqTemplateFor2(mappings, it.blindType, it.range);
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
    it.variants = biqTemplateFor2(mappings, it.blindType, it.range);
    const spec = biqVariantSpec(mappings, it.blindType, it.range) || [];
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
    biqStageInlineValances(mappings, o);
    biqExpandValances(mappings, o);
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
    // Same-line header words closer than a real column gap are one title — the outdoor sheet
    // prints "Roll Type" as two words ~16px apart while true columns sit ≥30px apart (J6966).
    const cols = [];
    hl.parts.forEach(p => {
        const prev = cols[cols.length - 1];
        if (prev && (p.x - prev._lx) < 22) { prev.name = biqNorm(prev.name + ' ' + p.s); prev._lx = p.x; }
        else cols.push({ name: biqNorm(p.s), x: p.x, _lx: p.x });
    });
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
    // Repeating page furniture must never be absorbed into an open row — on multi-page
    // orders the page-2/3 header ("Blind Designs / Supplier Name : / Purchase Order …")
    // followed the last item of the previous page and garbled it (Mathéo J7117 items 6+13,
    // Russel 2026-08-07). Match by content: these lines repeat identically on every page.
    const isFurniture = t => /supplier name|purchase order|quote #|consultant\s*:|adderss|math.o|blinds\s*\.\s*curtains|^blind designs\b|^bd [a-z ]+blind$|tel\s*:|email\s*:|^date\s*:|name\s*:|job #|page \d+\s*\/|shop \d+|kyalami|ivanseth|johannesburg \d+|witpoort|midrand|^abn\b/i.test(biqLc(biqNorm(t)));
    for (let li = hi + 1; li < lines.length; li++) {
        const l = lines[li]; const first = l.parts[0]; const joined = l.parts.map(p => p.s).join(' ');
        if (/Sub Total|Grand Total|Discount|Vat\(|Rounding|Page \d/i.test(joined)) { if (/Sub Total|Grand Total/i.test(joined)) break; else continue; }
        if (isFurniture(joined)) continue;
        // Priced accessory blocks ("#. Accessory" / "1. Wire Side Guides - Floor fix  745.0  1  745.00")
        // belong to the item ABOVE, not to its option columns (Russel 2026-08-07: accessory ->
        // option on the blind where the sheet has it, price ignored — BlindIQ prices itself).
        if (/^#?\.?\s*accessory/i.test(biqNorm(joined))) { if (cur) cur._accBlock = true; continue; }
        if (cur && cur._accBlock) {
            const am = biqNorm(joined).match(/^\d+\.\s*(.+?)(?:\s+[\d.,]+\s+(\d+)\s+[\d.,]+)?\s*$/);
            if (am) { (cur._accessories = cur._accessories || []).push({ name: biqNorm(am[1]), qty: am[2] || '1' }); continue; }
            if (/^(price|qty|total)\b/i.test(biqNorm(joined))) continue;
            cur._accBlock = false;                                   // block ended — fall through
        }
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
        const rhS = /\brh\b|\bright\b/.test(ctl), lhS = /\blh\b|\bleft\b/.test(ctl);
        if (ctl.includes('chain') && rhS) { it.control1 = 'Lh Pin'; it.control2 = 'Rh Chain'; }
        else if (ctl.includes('chain') && lhS) { it.control1 = 'Lh Chain'; it.control2 = 'Rh Pin'; }
        // "RH Motor" = motor on the RIGHT -> it belongs on Control R, with the idle pin on the
        // left (Russel 2026-08-07, Mathéo outdoor J6966). Mirrored for LH. A motor with no side
        // stays on Control 1 unresolved so it flags rather than guessing.
        else if (ctl.includes('motor') && rhS) { it.control1 = 'Lh Pin'; it.control2 = 'Rh Motor'; }
        else if (ctl.includes('motor') && lhS) { it.control1 = 'Lh Motor'; it.control2 = 'Rh Pin'; }
        else if (ctl.includes('motor')) { it.control1 = raw['Controls']; it.control2 = ''; }
        else { it.control1 = raw['Controls'] || ''; }
        { const cd = biqNorm(raw['Control Drop'] || '');
          it.controlDrop = biqComputeControlDropV2(mappings, /^\d/.test(cd) ? cd : '', it.drop, it.blindType, it.range);
          it._cdAuto = !/^\d/.test(cd); }
        it.variants = biqTemplateFor2(mappings, it.blindType || 'roller', it.range);
        const mv = (src, key) => { const v = cleanVal(raw[src]); if (v) biqSetVar(it.variants, key, v); };
        mv('H/ware Colour', 'Mech Colour');
        // "Covered Aluminium" = an aluminium bar matching the hardware colour (Russel 2026-08-07).
        // Hardware colours with no aluminium bar in BlindIQ (e.g. Beige) get a WHITE aluminium
        // bar — factory practice confirmed by Russel 2026-08-07 — with the substitution noted.
        {
            const bb = cleanVal(raw['Bottom Bar']);
            if (/covered/i.test(bb)) {
                const hw = biqNorm(cleanVal(raw['H/ware Colour']).replace(/\([^)]*\)/g, ' '));
                const spec = biqVariantSpec(mappings, it.blindType, it.range) || [];
                const bbo = spec.find(s => /^bottom\s*bar$/i.test(s.k));
                const vals = (bbo && bbo.values) || [];
                const exact = hw && vals.find(x => biqLc(x) === biqLc(hw + ' Aluminium'));
                const white = vals.find(x => biqLc(x) === 'white aluminium');
                const real = exact || white;
                if (real) {
                    biqSetVar(it.variants, 'Bottom Bar', real);
                    it.notes = (it.notes ? it.notes + ' | ' : '') + 'Bottom Bar "' + bb + '" read as ' + real
                        + (exact ? '' : ' (no ' + (hw || 'matching') + ' aluminium bar — white fitted as standard)');
                } else biqSetVar(it.variants, 'Bottom Bar', bb);
            } else if (bb) biqSetVar(it.variants, 'Bottom Bar', bb);
        }
        mv('Roll Type', 'Roll Type');
        if (/steel/i.test(raw['Chain'] || '')) biqSetVar(it.variants, 'Steel Ball Chain', 'Yes');
        if (/yes/i.test(raw['Cord Tidy'] || '')) biqSetVar(it.variants, 'Chain Tidy', 'Yes');
        mv('Cassette', 'Sys 40 70mm Cassette');
        mv('Fabric Insert 70mm Cassette', 'Fabric Insert for 70mm Cassette');
        mv('Side Channels', 'Side Channels');
        mv('Powder Coat Colour', 'Powder Coat Colour');
        mv('Hold Downs', 'Hold Downs');
        mv('Crank Handle', 'Crank Handle');
        // Outdoor: "Brackets: Black" is the bracket COLOUR (Russel 2026-08-07, J6966). Folded
        // only where the sheet actually has a Bracket Colour option, so other sheets are untouched.
        {
            const br = cleanVal(raw['Brackets']);
            const spec = biqVariantSpec(mappings, it.blindType, it.range) || [];
            const bco = spec.find(s => /^bracket\s*colou?r$/i.test(s.k));
            if (br && bco) biqSetVar(it.variants, bco.k, br);
        }
        // The sheet's own "Control" option (crank colour / Motor) mirrors the Controls column:
        // exact value match first, else a motorised blind is the sheet's 'Motor'. A motorised
        // blind also gets Crank Handle 'None' — there is no crank to pick (Russel 2026-08-07, J6966).
        {
            const spec = biqVariantSpec(mappings, it.blindType, it.range) || [];
            const gv2 = k => { const f = it.variants.find(v => biqLc(v[0]) === biqLc(k)); return f ? biqNorm(f[1]) : ''; };
            const co = spec.find(s => /^control$/i.test(s.k));
            if (co && !gv2(co.k)) {
                const cval = (co.values || []).find(x => biqLc(x) === ctl)
                    || (ctl.includes('motor') ? (co.values || []).find(x => /^motor$/i.test(x)) : null);
                if (cval) biqSetVar(it.variants, co.k, cval);
            }
            const ch = spec.find(s => /^crank\s*handle$/i.test(s.k));
            const chNone = ch ? (ch.values || []).find(x => /^none$/i.test(x)) : null;
            if (ctl.includes('motor') && ch && chNone && !gv2(ch.k)) biqSetVar(it.variants, ch.k, chNone);
        }
        // Mathéo "Bracket Covers = Std" means covers fitted as standard -> nothing to remove
        // (Russel 2026-08-07). Any other explicit value rides through for the emit gate to judge.
        {
            const bc = cleanVal(raw['Bracket Covers']);
            if (/^std\.?$|^standard$/i.test(bc)) biqSetVar(it.variants, 'Remove Bracket Covers', 'No');
            else if (bc) biqSetVar(it.variants, 'Remove Bracket Covers', bc);
        }
        mv('System Change', 'System Change');
        // Priced accessory rows under the blind: map onto the sheet's own option where one
        // exists (wire side guides), otherwise they are BlindIQ SUNDRY lines — motors, remotes,
        // adapter kits, touch-up paint (Russel 2026-08-07, J6966). Unmatched sundries stay
        // blank + flagged for mapping. The dealer price is ignored — BlindIQ prices for itself.
        (raw._accessories || []).forEach(a => {
            const acc = (a && a.name) || String(a || ''); if (!acc) return;
            const qty = (a && a.qty) || '1';
            const spec = biqVariantSpec(mappings, it.blindType, it.range) || [];
            const wsg = spec.find(s => /wire\s*side\s*guide/i.test(s.k));
            if (/wire\s*side\s*guide/i.test(acc) && wsg) biqSetVar(it.variants, wsg.k, 'Yes');
            else biqAddMotorSundry(mappings, o, acc, qty,
                /motor|\brts\b|remote|adapter|adaptor|situo|maestria|sonesse|smoove|tahoma|telis|glydea|zigbee|\bio\b/i.test(acc));
            it.notes = (it.notes ? it.notes + ' | ' : '') + 'Accessory: ' + acc;
        });
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
        it.variants = biqTemplateFor2(mappings, it.blindType, it.range);
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
    // Val Type / Valance Size / Valance Return above are real options on venetians;
    // on any product whose template doesn't carry them they become a split valance line.
    biqStageInlineValances(mappings, o);
    biqExpandValances(mappings, o);
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
        // A valance row WITH a usable width becomes a real Valance line (Russel 2026-08-07);
        // range from the Linear / Half Round wording, colour from the trailing desc segment.
        if (/valance/.test(dl)) {
            const wm = String(r.width || '').match(/\d{3,}/);
            if (wm) {
                const it = biqBlankItem(String(++n));
                it.qty = r.qty || '1'; it.location = r.location || '';
                it.blindType = 'Valance'; it.width = wm[0];
                it.range = /half\s*round/.test(dl) ? 'Half Round Valance' : /linear/.test(dl) ? 'Linear Valance' : '';
                const dv = biqLifestyleDesc(r.desc);
                it.colour = dv.colour || '';
                it.controlDrop = '0';
                it.variants = biqTemplateFor2(mappings, it.blindType, it.range);
                it.notes = 'From doc: ' + r.desc;
                o.items.push(it);
                return;
            }
            o.notes = (o.notes ? o.notes + ' | ' : '') + r.desc; return;
        }
        // brackets, cut-out specs and any dimensionless free-text are not blinds -> notes
        if (/specification|cut\s*out|bracket/.test(dl) || !hasDim) { o.notes = (o.notes ? o.notes + ' | ' : '') + r.desc; return; }
        const it = biqBlankItem(String(++n));
        it.qty = r.qty || '1'; it.location = r.location || ''; it.width = r.width || ''; it.drop = r.drop || '';
        it.fix = r.mount || '';
        const cs = biqLc(r.c || '');
        if (cs === 'l') { it.control1 = 'Lh Chain'; it.control2 = 'Rh Pin'; }
        else if (cs === 'r') { it.control1 = 'Lh Pin'; it.control2 = 'Rh Chain'; }
        const d = biqLifestyleDesc(r.desc);
        it.blindType = d.blindType; it.range = d.range; it.colour = d.colour;
        it.controlDrop = biqComputeControlDropV2(mappings, '', it.drop, it.blindType, it.range); it._cdAuto = true;
        it.variants = biqTemplateFor2(mappings, it.blindType || 'roller', it.range);
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
            it.variants = biqTemplateFor2(mappings, it.blindType, it.range);
            if (cleanVal(r.frame)) it.notes = (it.notes ? it.notes + ' | ' : '') + 'Frame: ' + cleanVal(r.frame);
        } else {
            it.blindType = p.product === 'outdoor' ? 'Outdoor Free Hang' : 'Element Roller Sys 40';
            const fab = biqNorm((r.fabric || '').replace(/\b(outdoor\s+)?blind\b/ig, ''));
            const f = biqSplitFabric(mappings, fab + (r.colour ? ' ' + r.colour : ''), it.blindType);
            if (f.range && f.colour) { it.range = f.range; it.colour = f.colour; }
            else { it.range = fab; it.colour = r.colour || ''; }
            it._origFabric = fab;
            it.controlDrop = biqComputeControlDropV2(mappings, '', it.drop, it.blindType, it.range); it._cdAuto = true;
            it.variants = biqTemplateFor2(mappings, it.blindType, it.range);
            if (p.product === 'outdoor' && cleanVal(r.motor)) biqAddMotorSundry(mappings, o, cleanVal(r.motor), +it.qty || 1, true);
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
[/coupl/i, 'Coupled'], [/\bint/i, 'Intermediate'], [/chain/i, 'Chain'],
// TBD prints the manual drive side as "Control"/"Ctrl"; every product it emits drives by chain
// (woods/verticals arrive as LHC/RHC), so Control = Chain.
[/\bctrl\b|\bcontrol\b/i, 'Chain'], [/pin/i, 'Pin'],
[/wand/i, 'Wand'], [/cord/i, 'Cord']];
function biqTbdDrive(s) { const t = biqLc(s || ''); for (const [re, v] of BIQ_TBD_DRIVE) if (re.test(t)) return v; return ''; }
// TBD prints motorisation hardware as options, but BlindIQ carries it as sundry LINES.
// Hold Downs stays an option; the rest become lines. Every one becomes a line so nothing is
// lost — the sundry ID is filled in when the name resolves confidently and left blank (and so
// flagged for the capturer) when it doesn't, rather than guessed onto the wrong part.
const BIQ_TBD_SUNDRY_KEYS = /^(motor|adaptor|adapter|charger|remote|wall\s*switch|smart\s*hub|smart\s*plug\b.*|wind\s*sensor|crank\s*handle|pull\s*pole|accessory)$/i;
// TBD shorthand -> the catalogue's long-form vocabulary (each mapping evidence-backed against
// the sundries DB): 1TD = One Touch Dual, ZB = Zigbee, M&T = Matter (the smart-home protocol —
// DB: "one touch dual matter motor 220v ac 2nm"), WF = Wire Free.
export function biqTbdExpand(s) {
    return biqNorm(String(s == null ? '' : s)
        .replace(/\b1TD\b/gi, 'One Touch Dual')
        .replace(/\bZB\b/gi, 'Zigbee')
        .replace(/\bM&T\b/gi, 'Matter')
        .replace(/\bWF\b/gi, 'Wire Free'));
}

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
        // Letterhead repeats on every page ("BLINDS ORDER", company, footer). Without this check a
        // page break in the middle of a wrapped Options line concatenates the next page's title
        // into the option text ("Hub=Tahoma Switch Pro (ZB) BLINDS ORDER").
        if (/^[A-Z][A-Z &]*ORDER$/.test(joined)
            || (meta.company && (joined === meta.company || joined.indexOf(meta.company + ' |') === 0))
            || /@|www\./.test(joined) || /^Rep:/.test(joined) || /^Name:/.test(joined)) continue;
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
            // a wide drop value can overflow the dimension band into Fix ("1400 Side Fix")
            if (cur.fix && dm) cur.fix = biqNorm(cur.fix.replace(new RegExp('^' + dm[2] + '\\s+'), ''));
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

// TBD/Galaxy documents print no quote or order number anywhere, so BlindIQ's customer order
// reference has to come from what the document DOES identify itself by. Galaxy's job number lives
// in the file name ("L17084 Rob.pdf" -> L17084); TBD names files without one, so those fall back to
// the document's own "Name:" job field. Never invents a reference — with neither, it stays blank
// and collectProblems keeps flagging it.
// Deliberately narrow: a job number is a letter-prefixed serial at the START of the file name
// (L17084, JOB2231, BD-4457). A bare date or a word is not a job number.
export function biqJobNumberFromFileName(fileName) {
    const base = biqNorm(String(fileName || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' '));
    const m = base.match(/^([A-Za-z]{1,4}-?\d{4,8})\b/);
    return m ? m[1].toUpperCase() : '';
}
export function biqNormalizeTbd(mappings, p, fileName) {
    const o = biqBlankOrder();
    o.source = 'tbd';
    o.sourceDesc = (p.meta.docType || 'BLINDS ORDER') + ' — ' + (p.meta.company || 'Total Blind Designs software');
    o.customer = p.meta.company || 'Total Blind Designs';
    o.client = p.meta.client || '';
    o.orderNumber = biqJobNumberFromFileName(fileName) || biqNorm(p.meta.client) || '';
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
        it.variants = biqTemplateFor2(mappings, it.blindType || 'roller', it.range);
        let leftEnd = '', rightEnd = '', joined = '';
        const seen = {}, extra = [], hardware = [], valance = [];
        opts.forEach(([k, v]) => {
            const kl = biqLc(k);
            if (kl === 'left end') { leftEnd = v; return; }
            if (kl === 'right end') { rightEnd = v; return; }
            if (kl === 'joined to') { joined = v; return; }
            // A valance can't ride on a roller line — BlindIQ orders it as its own valance line.
            // Collect the whole block, carry it in the item notes (travels in COI_Order_Notes)
            // and let collectProblems flag it for the capturer. (July test: a Linear 150mm
            // valance died silently here and never got produced.)
            if (/^valance\b/.test(kl)) { valance.push(k + '=' + v); return; }
            // motorisation hardware -> its own sundry line, not a variant option. A Yes/No
            // toggle (Pull Pole=Yes, Smart Plug ZB=Yes) names the part in its KEY; the rest
            // name it in the value.
            if (BIQ_TBD_SUNDRY_KEYS.test(kl)) {
                const txt = biqTbdExpand(/^(yes|true)$/i.test(biqNorm(v)) ? k : v);
                if (txt && !/^(no|false|none)$/i.test(txt)) hardware.push(txt);
                return;
            }
            // TBD repeats keys (Accessory=A | Accessory=B). A variant holds one value, so keep
            // the first and carry the rest into notes rather than silently dropping them.
            if (seen[kl] !== undefined && seen[kl] !== v) { extra.push(k + '=' + v); return; }
            seen[kl] = v;
            biqSetVar(it.variants, k, v);                               // already BlindIQ-shaped
        });
        if (extra.length) it.notes = (it.notes ? it.notes + ' | ' : '') + 'Also: ' + extra.join(' | ');
        if (valance.length) {
            it.notes = (it.notes ? it.notes + ' | ' : '') + 'VALANCE (capture as its own line): ' + valance.join(' | ');
            it._valance = valance.slice();
        }
        // aggregates duplicates across lines, so two blinds on the same motor give qty 2
        hardware.forEach(txt => biqAddMotorSundry(mappings, o, txt, +it.qty || 1, true));
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
    biqExpandValances(mappings, o);
    return o;
}

// Inline valance data on a blind line: OPTION or SPLIT? BlindIQ's own variant
// template decides (Russel 2026-08-07, comprehensive attached-items resolution).
// A valance key the product's options tab carries (wood venetian Val Size /
// Val Returns / Mitre, retro Valance and Bottom Type) is a real option and stays.
// Any other valance data can't ride on the line — it is moved to _valance
// staging (normalized keys) and biqExpandValances orders it as its own valance
// line. Cassette keys are NOT staged here — biqFoldCassette folds them onto the
// product's own cassette options (roller 70mm open cassette stays an option).
// Items whose blind type is unknown are left untouched (flagging handles them).
const BIQ_INLINE_VALANCE_RE = /^(val(ance)?\s*(type|colou?r|width|size|returns?|fix|length)|custom\s*val(ance)?\s*width|mitre\s*val(ance)?\s*(lh|rh)|top\s*board\b.*)$/i;
export function biqStageInlineValances(mappings, order) {
    (order ? order.items : []).forEach(it => {
        if (/valance|allusion/.test(biqLc(it.blindType))) return;      // is a valance product
        if (it._valance && it._valance.length) return;                 // already staged (TBD, Blind Guys)
        const spec = biqVariantSpec(mappings, it.blindType, it.range);
        if (!spec) return;                                             // unknown type: leave for flags
        const specKeys = new Set(spec.map(o => biqLc(o.k)));
        const canonKey = k => {
            const l = biqLc(k);
            if (/custom/.test(l)) return 'Custom Width';
            if (/type/.test(l)) return 'Type';
            if (/colou?r/.test(l)) return 'Colour';
            if (/width/.test(l)) return 'Width';
            if (/size|length/.test(l)) return 'Size';
            if (/return/.test(l)) return 'Returns';
            if (/fix/.test(l)) return 'Fix';
            if (/mitre.*lh/.test(l)) return 'Mitre LH';
            if (/mitre.*rh/.test(l)) return 'Mitre RH';
            if (/top\s*board/.test(l)) return 'Top Board';
            return biqNorm(k);
        };
        const staged = [], dropIdx = [];
        it.variants.forEach((v, idx) => {
            const k = biqNorm(v[0]);
            if (!BIQ_INLINE_VALANCE_RE.test(k)) return;
            if (specKeys.has(biqLc(k))) return;                        // legitimate option here
            dropIdx.push(idx);
            const val = cleanVal(v[1]);
            if (val) staged.push('Valance ' + canonKey(k) + '=' + val);
        });
        dropIdx.sort((a, b) => b - a).forEach(i => it.variants.splice(i, 1));
        // meaningful only when something identifies an actual valance request
        if (staged.some(s => /^Valance (Type|Colour|Width|Custom Width|Size)=/i.test(s))) it._valance = staged;
    });
}
// A valance block on a blind row becomes its OWN order line (that is how BlindIQ carries it).
// Product family follows the parent blind (Element Roller -> Element Valance; otherwise Valance),
// then switches to the sibling valance product when the requested range only exists there
// ("Half Round" is a generic-Valance range, not an Element Valance one); the doc's
// Range/Colour/Width/Fix land on the line; Returns / Mitres / Top Board / End Cap details are
// mapped onto the valance type's own option keys where its template has them, and anything
// unmappable rides in the line notes. Drop comes from the range name's profile size
// ("Linear 150mm" -> 150) or a stated Valance Size. Width uses the doc's stated valance width;
// when none is usable it is auto-sized to the blind width + 15mm (Russel 2026-08-07) and noted.
// If the DB has no valance blind type at all, the line is NOT invented — the parent keeps its
// _valance flag for the capturer (never silently wrong).
// Valance sheets' "Type of Blind" vocabulary, keyed by the PARENT blind type's BlindIQ id —
// covers dealer wordings the name regex can't ("System 40" is a roller; Breed item 7).
const BIQ_TYPE_OF_BLIND_BY_ID = {
    25: 'Roller Blind', 12: 'Roller Blind', 5: 'Roller Blind', 11: 'Roller Blind',
    28: 'Double Roller Blind', 24: 'Wood Venetian', 1: 'Wood Venetian',
    26: 'Retro Venetian', 4: 'Retro Venetian', 30: 'Vision Blind', 23: 'Vision Blind',
    22: 'Visage Blind', 9: 'Roll-up Bamboo', 10: 'Roman Bamboo', 2: 'Roman Panel',
    3: 'Sliding Panel', 6: '90mm Vertical', 29: 'Allusion Blind',
    13: 'Curtain', 17: 'Curtain', 18: 'Curtain', 20: 'Curtain'
};
export function biqExpandValances(mappings, order) {
    (order ? order.items.slice() : []).forEach(src => {
        if (!src._valance || !src._valance.length || src._valanceLine) return;
        const kv = {};
        src._valance.forEach(s => {
            const i = s.indexOf('=');
            if (i > 0) kv[biqLc(biqNorm(s.slice(0, i)).replace(/^valance\s+/i, ''))] = biqNorm(s.slice(i + 1));
        });
        // "Type" (Linear / Half Round — Blind Guys, BD form, AI) doubles as the
        // range when the doc gave no explicit range.
        if (!kv['range'] && kv['type']) kv['range'] = kv['type'];
        const fam = /^element\b/i.test(src.blindType || '') ? 'Element Valance' : 'Valance';
        const alt = fam === 'Element Valance' ? 'Valance' : 'Element Valance';
        let use = biqResolve(mappings, 'blindTypes', fam).known ? fam
            : (biqResolve(mappings, 'blindTypes', alt).known ? alt : '');
        if (!use) return;
        // "Linear 150mm" is TBD's name; BlindIQ's range is e.g. "linear valance" — exact name
        // first, else accept the scoped range only when the first word pins it to exactly ONE
        // candidate (same rule as the double-roller composite ranges). Returns the resolved
        // range name, or null when this product can't carry the requested range.
        const rangeOn = (btName, rangeStr) => {
            if (!rangeStr) return null;
            if (biqResolveRange(mappings, btName, rangeStr).known) return rangeStr;
            const bt = biqResolve(mappings, 'blindTypes', btName);
            const tok = biqLc(rangeStr).split(/\s+/)[0];
            if (!bt.known || !tok) return null;
            const pre = bt.id + '|';
            const cands = Object.keys(mappings.rangesScoped || {})
                .filter(k => k.indexOf(pre) === 0).map(k => k.slice(pre.length))
                .filter(rn => rn.split(/\s+/).includes(tok));
            return cands.length === 1 ? cands[0] : null;
        };
        const wantRange = kv['range'] || '';
        let resolvedRange = rangeOn(use, wantRange);
        // the requested range only exists on the sibling valance product -> order it there
        if (wantRange && !resolvedRange) {
            const sib = use === fam ? alt : fam;
            if (biqResolve(mappings, 'blindTypes', sib).known) {
                const r2 = rangeOn(sib, wantRange);
                if (r2) { use = sib; resolvedRange = r2; }
            }
        }
        const it = biqBlankItem(String(order.items.length + 1));
        it.blindType = use;
        it.qty = src.qty || '1'; it.location = src.location || '';
        it.range = wantRange;
        if (resolvedRange && biqLc(resolvedRange) !== biqLc(wantRange)) { it._origRange = wantRange; it.range = resolvedRange; }
        else if (resolvedRange) it.range = resolvedRange;
        it.colour = kv['colour'] || '';
        // A usable width is a PURE number (with optional mm) — Blind Guys' Valance Width
        // dropdown can say "Standard (15mm wider than blind width)", and stripping the
        // words out of that once produced a 15mm-wide valance (Breed order J0000509-4).
        const numOnly = s => { const m = String(s || '').match(/^\s*(\d{2,5})\s*(?:mm)?\s*$/i); return m ? m[1] : ''; };
        it.width = numOnly(kv['custom width']) || numOnly(kv['width']);
        if (!it.width) {
            const bw = parseInt(src.width, 10);
            if (bw) { it.width = String(bw + 15); it._autoWidth = true; }   // blind + 15mm (Russel 2026-08-07; matches the sheet's own "Standard (15mm wider)")
        }
        const dm = (kv['range'] || '').match(/(\d{2,4})\s*mm/i)
            || (kv['size'] || '').match(/(\d{2,4})\s*mm/i) || (kv['size'] || '').match(/^(\d{2,4})$/);
        it.drop = dm ? dm[1] : '0';   // valances have no drop — 0 imports, factory sizes the profile (Russel 2026-08-07)
        it.fix = kv['fix'] || src.fix || '';
        // No legacy fallback to roller-shaped keys. But "Element Valance" (27) carries no option
        // template in the mappings extract while the generic "Valance" (14) does, and BlindIQ uses
        // the same vocabulary for both — proven by order BDO665443, where Type of Blind / Val
        // Returns / End Cap Colour / LH Side / RH Side were accepted verbatim. So borrow the
        // sibling valance template when the chosen type has none of its own; otherwise the
        // capturer's returns and end caps are silently lost (which is exactly what happened).
        const spec = biqVariantSpec(mappings, it.blindType, it.range)
            || biqVariantSpec(mappings, use === 'Element Valance' ? 'Valance' : 'Element Valance') || [];
        it.variants = spec.map(s => [s.k, s.def || '']);
        const used = new Set(['range', 'colour', 'fix', 'size']);
        // width wording is consumed when numeric or the known "Standard (+15)" dropdown;
        // any OTHER text (unexpected sizing wording) flows to the notes for the capturer
        ['custom width', 'width'].forEach(k => {
            if (kv[k] == null || numOnly(kv[k]) || /standard/i.test(kv[k])) used.add(k);
        });
        if (kv['type'] && kv['range'] === kv['type']) used.add('type');
        const matchVal = (v, o) => {
            const vals = o.values || [];
            const hit = vals.find(x => biqLc(x) === biqLc(v));
            if (hit) return hit;
            const syn = BIQ_VALUE_SYNONYMS.find(([re]) => re.test(biqNorm(v)));
            return (syn && vals.find(x => biqLc(x) === biqLc(syn[1]))) || v;   // unmatched -> flagged, not dropped
        };
        const put = (docKey, specRe) => {
            if (kv[docKey] == null) return;
            const o = spec.find(s => specRe.test(s.k));
            if (!o) return;
            biqSetVar(it.variants, o.k, matchVal(kv[docKey], o));
            used.add(docKey);
        };
        put('returns', /^val\s*returns$/i);
        put('end cap colour', /^end\s*cap\s*colou?r$/i);
        put('end cap lh', /^lh\s*side$/i);
        put('end cap rh', /^rh\s*side$/i);
        put('mitre lh', /^mitre\s*val\s*lh$/i);
        put('mitre rh', /^mitre\s*val\s*rh$/i);
        put('top board', /^top\s*board/i);
        // "Type of Blind" comes from the blind the valance was ordered WITH — resolve the
        // parent's type ID and map it to the valance sheet's vocabulary. The old regex on the
        // raw name missed dealer wordings like "System 40" (Breed item 7, Russel 2026-08-07).
        const tob = spec.find(s => /^type\s*of\s*blind$/i.test(s.k));
        if (tob && !biqNorm((it.variants.find(v => biqLc(v[0]) === biqLc(tob.k)) || [])[1])) {
            const pbt = biqResolve(mappings, 'blindTypes', src.blindType);
            const want = (pbt.known && BIQ_TYPE_OF_BLIND_BY_ID[pbt.id])
                || (/roller/i.test(src.blindType) ? 'Roller Blind'
                    : /wood|venetian/i.test(src.blindType) ? 'Wood Venetian' : '');
            const real = want && (tob.values || []).find(x => biqLc(x) === biqLc(want));
            if (real) biqSetVar(it.variants, tob.k, real);
        }
        // "Return: Black" style line notes name the end cap colour (Breed 0006, Russel
        // 2026-08-07) — fill the sheet's End Cap Colour when it is empty and the colour is
        // a real catalogue value. Sheets without the option keep the note as-is.
        const autoNotes = [];
        const ecc = spec.find(s => /^end\s*cap\s*colou?r$/i.test(s.k));
        if (ecc && !biqNorm((it.variants.find(v => biqLc(v[0]) === biqLc(ecc.k)) || [])[1])) {
            const m = String(src.notes || it.notes || '').match(/\breturns?\s*[:\-]\s*([A-Za-z][A-Za-z ]{2,18})/i);
            const val = m && (ecc.values || []).find(x => biqLc(x) === biqLc(m[1].trim()));
            if (val) { biqSetVar(it.variants, ecc.k, val); autoNotes.push('End Cap Colour ' + val + ' taken from line note'); }
        }
        // LH/RH Side follow Val Returns on sheets that carry them (Aluminium valance):
        // a return on that side is a Return End Cap, otherwise a plain End Cap — the
        // dominant real-order pattern (pass-3 stored strings). Only fills empty fields.
        if (spec.some(s => /^lh\s*side$/i.test(s.k))) {
            const ret = biqLc((it.variants.find(v => /^val\s*returns$/i.test(v[0])) || [])[1] || '');
            const hasRet = ret && !/^(none|no)$/.test(ret);
            const fillSide = (reKey, mine) => {
                const o = spec.find(s => reKey.test(s.k)); if (!o) return;
                const cur = it.variants.find(v => biqLc(v[0]) === biqLc(o.k));
                if (cur && biqNorm(cur[1])) return;
                const v = (hasRet && mine) ? 'Return End Cap' : 'End Cap';
                if ((o.values || []).some(x => biqLc(x) === biqLc(v))) biqSetVar(it.variants, o.k, v);
            };
            fillSide(/^lh\s*side$/i, /\blh\b|left|&|and|both/.test(ret));
            fillSide(/^rh\s*side$/i, /\brh\b|right|&|and|both/.test(ret));
            if (hasRet) autoNotes.push('End caps derived from Val Returns — confirm');
        }
        const leftovers = Object.keys(kv).filter(k => !used.has(k)).map(k => k + '=' + kv[k]);
        if (src._valanceOnlyRow) {
            // The ROW is the valance ("... Valance only" lines): rebuild it in place.
            // Its own Finished Width IS the valance width — a conflicting Valance Width
            // cell is noted for confirmation, never silently preferred (Breed 0006:
            // Finished Width 665 vs Valance Width 650 -> 665 with a confirm note).
            const rowW = String(parseInt(src.width, 10) || '');
            const docW = it._autoWidth ? '' : it.width;
            const conflict = (rowW && docW && docW !== rowW) ? 'doc Valance Width=' + docW + ' — confirm' : '';
            src.blindType = it.blindType;
            src.range = it.range; if (it._origRange) src._origRange = it._origRange;
            src.colour = it.colour;
            src.width = rowW || it.width;
            src.drop = it.drop; src.fix = it.fix || src.fix;
            src.variants = it.variants; src.controlDrop = '0';
            src.control1 = ''; src.control2 = '';
            src.notes = [biqNorm(src.notes || ''), 'Valance-only line',
                it._origRange ? 'doc range: ' + it._origRange : '',
                conflict, autoNotes.join(' | '), leftovers.join(' | ')].filter(Boolean).join(' | ');
            src._valanceLine = src.code;                       // consumed — never re-expanded
            return;
        }
        it.notes = 'Valance for blind ' + (src.location || src.code)
            + (it._origRange ? ' | doc range: ' + it._origRange : '')
            + (it._autoWidth ? ' | width auto-sized: blind +15mm — confirm' : '')
            + (autoNotes.length ? ' | ' + autoNotes.join(' | ') : '')
            + (leftovers.length ? ' | ' + leftovers.join(' | ') : '');
        order.items.push(it);
        src._valanceLine = it.code;
        // Point the parent's note AT the new line instead of repeating the spec on it. Leaving the
        // full valance detail on the blind is what made a capturer type those options onto the
        // roller (BDO665443 item 4) while the real valance line went out blank.
        const cut = biqNorm(src.notes).indexOf('VALANCE (capture as its own line)');
        if (cut >= 0) src.notes = biqNorm(src.notes.slice(0, cut).replace(/\s*\|\s*$/, ''));
        src.notes = (src.notes ? src.notes + ' | ' : '') + 'Valance for this blind is line ' + it.code + ' (do not add it here).';
    });
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

// ---------- printable order preview (PDF via the browser's print dialog) ----------
// Mirrors BlindIQ's own "Online Purchase Order" preview (reference: BlindIQ_ExportedCO_116888.pdf):
// From/To company blocks, an order-meta panel, a Blinds table with the pipe-separated options
// line under each item, then Sundries. Pure function -> full standalone HTML document string;
// the UI opens it in a window and calls print() so the capturer saves it as a PDF.
// Unresolved names print in red — the PDF doubles as a checking document.
export function biqOrderPreviewHtml(mappings, order) {
    const H = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const cust = biqResolveCustomer(mappings, order.customer);
    const ce = cust.known ? cust.entry : {};
    const opName = (() => {
        if (!cust.known || !ce.ops || ce.operator == null || ce.operator === '') return '';
        const hit = (ce.ops || []).find(o => String(o[0]) === String(ce.operator));
        return hit ? hit[1] : '';
    })();
    const mark = (name, res) => res.known
        ? H(name)
        : '<span class="bad">' + (H(name) || '—') + '</span>';
    const rows = order.items.map((it, i) => {
        const rt = biqResolve(mappings, 'blindTypes', it.blindType), rr = biqResolveRange(mappings, it.blindType, it.range),
            rc = biqResolveColour(mappings, it.range, it.colour), rf = biqResolve(mappings, 'fixes', it.fix),
            r1 = biqResolve(mappings, 'control1', it.control1), r2 = biqResolve(mappings, 'control2', it.control2);
        const emitted = biqEmittedVariants(mappings, it).map(v => H(v[0]) + '=' + H(v[1]));
        const withheld = biqDroppedVariants(mappings, it).map(d => '<span class="bad">✗ ' + H(d.k) + '=' + H(d.v) + '</span>');
        const opts = emitted.concat(withheld).join(' | ');
        return `<tr class="item">
  <td>${H(it.code || String.fromCharCode(97 + (i % 26)))}</td><td>${H(it.qty)}</td><td>${H(it.location)}</td>
  <td>${mark(it.blindType, rt)}</td><td>${mark(it.range, rr)}</td><td>${mark(it.colour, rc)}</td>
  <td class="num">${H(it.width)}</td><td class="num">${H(it.drop)}</td><td class="num">${H(it.controlDrop)}</td>
  <td>${mark(it.control1, r1)}</td><td>${mark(it.control2, r2)}</td><td>${mark(it.fix, rf)}</td>
</tr>` + (opts || it.notes ? `<tr class="opts"><td></td><td colspan="11">${opts ? opts : ''}${it.notes ? (opts ? '<br>' : '') + '<i>Note: ' + H(it.notes) + '</i>' : ''}</td></tr>` : '');
    }).join('\n');
    const sunRows = (order.sundries || []).map(s => `<tr>
  <td>${H(s.code)}</td><td>${H(s.qty)}</td><td class="num">${H(s.type)}</td><td class="num">${s.sundry ? H(s.sundry) : '<span class="bad">—</span>'}</td><td>${H(s.notes)}</td>
</tr>`).join('\n');
    const meta = [
        ['Order No', order.orderNumber], ['Order Date', order.orderDate], ['Required Date', order.requiredDate],
        ['Delivery Method', order.deliveryMethod], ['Packing Type', order.packingType],
        ['BlindIQ Order ID', order.orderId || '0'], ['Source', order.sourceDesc]
    ].map(([k, v]) => `<tr><th>${H(k)}</th><td>${H(v) || '—'}</td></tr>`).join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Order ${H(order.orderNumber || 'preview')} — ${H(order.customer)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font: 9.5pt/1.35 "Segoe UI", Arial, sans-serif; color: #1a1a1a; margin: 0; }
  h1 { font-size: 14pt; margin: 0 0 2mm; } h2 { font-size: 11pt; margin: 5mm 0 1.5mm; }
  .head { display: flex; gap: 6mm; align-items: flex-start; border-bottom: 2px solid #333; padding-bottom: 3mm; }
  .blk { flex: 1; } .blk h3 { font-size: 8.5pt; text-transform: uppercase; color: #666; margin: 0 0 1mm; }
  .blk p { margin: 0; font-size: 9pt; }
  table.meta { border-collapse: collapse; font-size: 8.5pt; }
  table.meta th { text-align: left; color: #666; font-weight: 600; padding: .4mm 3mm .4mm 0; white-space: nowrap; }
  table.meta td { padding: .4mm 0; }
  table.items { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-top: 1mm; }
  table.items th { background: #eee; text-align: left; padding: 1.2mm 1.5mm; border-bottom: 1.2px solid #333; font-size: 7.5pt; text-transform: uppercase; }
  table.items td { padding: 1mm 1.5mm; border-bottom: .3px solid #ccc; vertical-align: top; }
  tr.item td { border-bottom: none; }
  tr.opts td { font-size: 7.5pt; color: #444; padding-top: 0; border-bottom: .3px solid #bbb; }
  td.num { text-align: right; }
  .bad { color: #b91c1c; font-weight: 600; }
  .foot { margin-top: 5mm; font-size: 7.5pt; color: #777; display: flex; justify-content: space-between; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
</style></head><body>
<div class="head">
  <div class="blk"><h3>From</h3>
    <p><b>Blind Designs &amp; Interiors (Pty) Ltd</b><br>14 - 18 Ivanseth Rd, Reuven, JHB, 2091<br>Tel 011 683 0080 · orders@blinddesigns.co.za<br>VAT # 4760134025</p></div>
  <div class="blk"><h3>To (Customer)</h3>
    <p><b>${H(order.customer) || '—'}</b>${cust.known ? '<br>Customer ' + H(ce.customer) + ' · Address ' + H(ce.address) + (ce.operator !== '' && ce.operator != null ? ' · Operator ' + H(ce.operator) + (opName ? ' (' + H(opName) + ')' : '') : '') : ' <span class="bad">(no BlindIQ IDs)</span>'}${order.client ? '<br>End client / job: ' + H(order.client) : ''}${order.address ? '<br>' + H(order.address).replace(/\n/g, '<br>') : ''}</p></div>
  <div class="blk"><table class="meta">${meta}</table></div>
</div>
${order.notes ? '<p style="margin:2mm 0 0"><b>Order notes:</b> ' + H(order.notes) + '</p>' : ''}
<h2>Blinds (${order.items.length})</h2>
<table class="items"><thead><tr>
  <th>Item</th><th>Qty</th><th>Location</th><th>Blind Type</th><th>Range</th><th>Colour</th>
  <th>Width</th><th>Drop</th><th>Cont. Drop</th><th>Control</th><th>Control</th><th>Fix</th>
</tr></thead><tbody>${rows}</tbody></table>
${(order.sundries || []).length ? `<h2>Sundries (${order.sundries.length})</h2>
<table class="items"><thead><tr><th>Code</th><th>Qty</th><th>Type ID</th><th>Sundry ID</th><th>Description / notes</th></tr></thead><tbody>${sunRows}</tbody></table>` : ''}
<div class="foot"><span>Generated by OrderBot — BlindIQ import preview. Red values are not yet mapped to BlindIQ IDs; red ✗ options will NOT import until corrected.</span><span>${H(new Date().toISOString().slice(0, 10))}</span></div>
</body></html>`;
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
- Map the dealer's column wording to BlindIQ options in "options": Comp / Comp Col → Mech Colour; Bott Bar Col → Bottom Bar; Cass Col → the cassette colour option; Steel Chain=Yes or Chain Type=Steel → Steel Ball Chain=Yes; Roll → Roll Type; Int Bracket → Intermediate Bracket; Tilt Cord → the tilt control side; Cord Ht / Chain Height → controlDrop; Br col → Bracket Colour; Alum col → Powder Coat Colour; Add H/D → Hold Downs; Twist Lock Pole / Skylight Pole → the pole option; Crank + Crank length + Crank col → the crank handle/control. Put true accessories (motor Type, Charger, Remote, crank handle as a separate part) into "sundries" when they are charged components.
- A valance or pelmet requested ON a blind line: put it into that line's "options" as "Valance Type=Linear" (or Half Round etc.), "Valance Colour=...", "Valance Width=...", "Valance Returns=..." — do NOT invent a separate line item for it; the converter splits it into its own BlindIQ valance line automatically. A valance printed as its OWN row in the document stays its own line item (blindType "Valance").`;
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
        it.variants = biqTemplateFor2(mappings, it.blindType, it.range);
        (li.options || []).forEach(opt => {
            const i = String(opt).indexOf('=');
            if (i > 0) biqSetVar(it.variants, biqNorm(opt.slice(0, i)), biqNorm(opt.slice(i + 1)));
            else if (biqNorm(opt)) biqSetVar(it.variants, biqNorm(opt), 'Yes');
        });
        it.notes = biqNorm(li.notes);
        o.items.push(it);
    });
    // AI-extracted sundries used to arrive as bare descriptions with no BlindIQ item —
    // resolve them the same way as every other format. Motor view first for EVERY sundry
    // (it is small and precise, so a unique hit there IS a motor part — no keyword
    // guessing), aggregating duplicates and applying the white default; anything that
    // doesn't resolve there gets one full-catalogue attempt; still-unresolved stays
    // flagged with the description intact.
    (ai.sundries || []).forEach(s => {
        const qty = biqNorm(s.qty) || '1', desc = biqNorm(s.description);
        if (!desc) return;
        const before = o.sundries.length;
        biqAddMotorSundry(mappings, o, desc, +qty || 1, true);
        const su = o.sundries[o.sundries.length - 1];
        if (o.sundries.length > before && su && !su.sundry) {
            const h = biqFuzzySundry(mappings, desc);
            if (h && h.sundry != null) { su.type = String(h.type); su.sundry = String(h.sundry); }
        }
    });
    // inline valances in AI options (Valance Type= / Valance Colour= ...) -> own line
    biqStageInlineValances(mappings, o);
    biqExpandValances(mappings, o);
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
        // per-blind-type control availability (BlindIQ's own dropdown matrix, where known)
        [['c1', 'control1'], ['c2', 'control2']].forEach(([side, field]) => {
            if (biqControlAllowed(mappings, it.blindType, side, it[field]) === false) {
                const names = biqAllowedControlNames(mappings, it.blindType, side) || [];
                probs.push({ t: w + 'control "' + it[field] + '" is not available for ' + it.blindType + ' (' + (side === 'c1' ? 'Control 1' : 'Control 2') + ' options: ' + names.join(' / ') + ').' });
            }
        });
        if (it._bracketOdd) probs.push({ t: w + 'flagged as ' + it._bracketOdd + ' bracket but has no matching pair — couple it with its partner line (or clear the flag).' });
        // Options the emit gate would withhold — surfaced here so they are FIXED, not lost.
        biqDroppedVariants(mappings, it).forEach(d =>
            probs.push({ t: w + 'option "' + d.k + '=' + d.v + '" will NOT import — ' + d.why + '. Correct the value or move it to the item notes.' }));
        if (it._valance && it._valance.length && !it._valanceLine)
            probs.push({ t: w + 'has a VALANCE (' + it._valance.join(', ') + ') — BlindIQ needs this captured as its own valance line. Details are carried in the item notes.' });
        const spec = biqVariantSpec(mappings, it.blindType, it.range);
        if (spec) spec.forEach(o => {
            if (o.req) { const f = it.variants.find(v => biqLc(v[0]) === biqLc(o.k));
                if (!f || !biqNorm(f[1])) probs.push({ t: w + 'option "' + o.k + '" is required for ' + it.blindType + (o.values && o.values.length ? ' (' + o.values.slice(0, 4).join(' / ') + (o.values.length > 4 ? ' …' : '') + ')' : '') + '.' }); }
        });
        if (!(+it.width > 0)) probs.push({ t: w + 'width missing/invalid.' });
        // Valance lines carry no drop — 0 (or blank -> 0 in the XML) is correct (Russel 2026-08-07).
        const isValance = (() => { const r = biqResolve(mappings, 'blindTypes', it.blindType); return r.known && (r.id === 14 || r.id === 27); })();
        if (!(+it.drop > 0) && !isValance) probs.push({ t: w + 'drop missing/invalid.' });
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
        x += tag('COI_Drop', it.drop || ((rt.known && (rt.id === 14 || rt.id === 27)) ? '0' : it.drop));   // valances: no drop -> 0
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
        const spec = biqVariantSpec(mappings, it.blindType, it.range);
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
        // Value-level canonicalization (Russel 2026-08-07, Mathéo "Beige (S40)"): when a value
        // isn't on the sheet's list but the value MINUS bracketed qualifiers is, use the
        // catalogue spelling and note the original. Anything still off-list keeps flagging.
        const spec2 = biqVariantSpec(mappings, it.blindType, it.range);
        if (spec2) it.variants.forEach(v => {
            const o = spec2.find(s => biqLc(s.k) === biqLc(v[0]));
            if (!o || !(o.values || []).length) return;
            const val = biqNorm(v[1]); if (!val) return;
            const ci = o.values.find(x => biqLc(x) === biqLc(val));
            if (ci) { if (ci !== val) v[1] = ci; return; }            // case-only difference -> catalogue spelling, silently
            const stripped = biqNorm(val.replace(/\s*\([^)]*\)\s*/g, ' '));
            // "4x steel collapsable" (tight PDF kerning glues the count to the x) -> "4 x ..." (J6966)
            const spacedX = biqNorm(val.replace(/\b(\d+)\s*x\b/gi, '$1 x'));
            const cands = [stripped, spacedX, biqNorm(stripped.replace(/\b(\d+)\s*x\b/gi, '$1 x'))];
            const real = cands.map(c => c && c !== val ? o.values.find(x => biqLc(x) === biqLc(c)) : null).find(Boolean);
            if (real) { v[1] = real; it.notes = (it.notes ? it.notes + ' | ' : '') + v[0] + ' "' + val + '" read as ' + real; }
        });
    });
    biqFoldCassette(mappings, order);
}

// Dealers (TBD software especially) write a cassette as plain keys — "Cassette=Yes",
// "Cassette Colour=Black", "Fabric Insert=Yes" — while BlindIQ's option is a single
// colour-valued key ("Sys 40 70mm Cassette=Black") plus a separate insert toggle
// ("Fabric Insert for 70mm Cassette=Yes"). Fold the dealer keys onto the blind type's own
// cassette options. Template-aware: works for any blind type whose spec has a colour-valued
// *Cassette* option, and leaves the raw keys (to be flagged, never dropped) where it doesn't.
// A Cassette=Yes with a missing/unknown colour keeps the raw value so the emit gate flags it.
export function biqFoldCassette(mappings, order) {
    (order ? order.items : []).forEach(it => {
        const spec = biqVariantSpec(mappings, it.blindType, it.range); if (!spec) return;
        const isYes = s => /^(yes|true)$/i.test(biqNorm(s));
        const idxOf = re => it.variants.findIndex(v => re.test(biqLc(v[0])));
        const colourCassette = spec.find(o => /cassette/i.test(o.k) && (o.values || []).length
            && !(o.values || []).every(x => /^(yes|no)$/i.test(x)));
        const ci = idxOf(/^cassette$/), coli = idxOf(/^cassette\s+colou?r$/);
        if (colourCassette && (ci >= 0 || coli >= 0)) {
            const on = ci >= 0 ? isYes(it.variants[ci][1]) : true;   // a colour alone implies a cassette
            const colour = coli >= 0 ? biqNorm(it.variants[coli][1]) : '';
            if (on) {
                const match = (colourCassette.values || []).find(x => biqLc(x) === biqLc(colour));
                biqSetVar(it.variants, colourCassette.k, match || colour || 'Yes');
            }
            [ci, coli].filter(x => x >= 0).sort((a, b) => b - a).forEach(x => it.variants.splice(x, 1));
        }
        const fii = idxOf(/^fabric\s+insert$/);
        const fiOpt = spec.find(o => /fabric\s+insert/i.test(o.k));
        if (fii >= 0 && fiOpt && biqLc(fiOpt.k) !== 'fabric insert') {
            if (isYes(it.variants[fii][1])) biqSetVar(it.variants, fiOpt.k, 'Yes');
            it.variants.splice(fii, 1);
        }
    });
}

// Fill omitted options with sensible defaults so the capturer sees the real standard:
//  - REQUIRED: matrix default if present; Yes/No-type (or free-text like "Split Tier on Tier") -> "No";
//              genuine multi-choice with no default (Frame, Rail Size, Louvre, Closure) -> left to flag.
//  - OPTIONAL Yes/No toggles (Steel Ball Chain, SmartRail, Intermediate Bracket, ...): default "No"
//    unless stipulated. (On export, "No" toggles collapse to nothing — absence = No in BlindIQ.)
// Dealer phrasings that mean an option value BlindIQ spells differently. Only ever used when the
// supplied value doesn't already match one of the option's allowed values.
const BIQ_VALUE_SYNONYMS = [
    [/^(lhs?|left)(\s*(hand\s*)?(side|only))?$/i, 'LH'],
    [/^(rhs?|right)(\s*(hand\s*)?(side|only))?$/i, 'RH'],
    [/^(both(\s*sides)?|lhs?\s*(&|and|\+|\/)\s*rhs?|left\s*(&|and|\+|\/)\s*right)$/i, 'LH & RH'],
    [/^(none|no|nil|n\/a)$/i, 'None']
];
export function biqApplyOptionDefaults(mappings, order) {
    (order ? order.items : []).forEach(it => {
        const spec = biqVariantSpec(mappings, it.blindType, it.range);
        if (!spec) return;
        spec.forEach(o => {
            const f = it.variants.find(v => biqLc(v[0]) === biqLc(o.k));
            // A value that isn't one of the spec's allowed values is silently dropped from the
            // XML, losing what the customer asked for ("Val Returns=RHS only"). Coerce common
            // phrasings onto the real value; anything still unmatched is left to be flagged.
            if (f && biqNorm(f[1]) && (o.values || []).length
                && !(o.values || []).some(v => biqLc(v) === biqLc(f[1]))) {
                const hit = BIQ_VALUE_SYNONYMS.find(([re]) => re.test(biqNorm(f[1])));
                const want = hit && (o.values || []).find(v => biqLc(v) === biqLc(hit[1]));
                if (want) { f[1] = want; it._optCoerced = true; }
            }
            if (f && biqNorm(f[1])) return;            // already set
            const vals = (o.values || []).map(biqLc);
            const isToggle = vals.length > 0 && vals.every(v => v === 'yes' || v === 'no');
            const isColour = /colou?r/i.test(o.k);     // colour is order-specific — never silently default it
            // A reveal-fit blind sits inside the recess, so the valance has no exposed ends and
            // needs no returns. Face-fix leaves the ends visible, so that stays for the capturer.
            // Only fills a blank — an explicit "LH & RH" on the order is never overridden.
            const revealId = (mappings.fixes || {})['reveal'];
            if (/^val(ance)?\s*returns$/i.test(o.k) && vals.includes('none') && revealId != null
                && biqResolve(mappings, 'fixes', it.fix).id === revealId) {
                biqSetVar(it.variants, o.k, 'None'); it._optDefaulted = true; return;
            }
            // Eliminative default: a required choice where some values are explicitly
            // "for Motor Only" and exactly ONE alternative exists. On a blind whose controls are
            // known and contain no motor, the motor-only value is impossible — the alternative is
            // the only legal one. (System Choice on Roller System 55: "Sys 55" vs "Sys 55 (with
            // 40+ Bracket) for Motor Only".) Motorised or unknown-control blinds keep the flag.
            if (o.req && (o.values || []).length >= 2) {
                const motorOnly = (o.values || []).filter(v => /motor\s*only/i.test(v));
                const others = (o.values || []).filter(v => !/motor\s*only/i.test(v));
                const ctl = biqNorm((it.control1 || '') + ' ' + (it.control2 || ''));
                if (motorOnly.length && others.length === 1 && ctl && !/motor/i.test(ctl)) {
                    biqSetVar(it.variants, o.k, others[0]); it._optDefaulted = true; return;
                }
            }
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

// ---------- per-blind-type CONTROL availability ----------
// BlindIQ scopes the Control 1 / Control 2 dropdowns per blind type (its own UI greys out the
// rest). That matrix lives in BlindIQ's database; until the SQL export lands, code-confirmed
// matrices go here (source: screenshots of BlindIQ's own dropdowns). Keyed by blindTypeId; ids
// are control catalogue IDs. mappings.controlsScoped (imported data) always wins over this seed.
const BIQ_CONTROLS_SCOPED_SEED = {
    // Cellular Free Hang (32) — confirmed 27 Jul 2026: C1 = Lh/Rh Cordlock, Lh/Rh Motor; C2 = Free Hang
    '32': { c1: [107, 108, 17, 4], c2: [190] }
};
function biqControlMatrixFor(mappings, blindType) {
    const bt = biqResolve(mappings, 'blindTypes', blindType);
    if (!bt.known) return null;
    const m = (mappings.controlsScoped || {})[String(bt.id)] || BIQ_CONTROLS_SCOPED_SEED[String(bt.id)];
    if (!m) return null;
    return Array.isArray(m) ? { c1: m, c2: m } : m;
}
// true / false / null (null = no matrix data for this type — stay silent)
export function biqControlAllowed(mappings, blindType, side, controlName) {
    const m = biqControlMatrixFor(mappings, blindType);
    if (!m) return null;
    const r = biqResolve(mappings, side === 'c2' ? 'control2' : 'control1', controlName);
    if (!r.known) return null;                                     // unmapped is flagged elsewhere
    if (r.id === -1) return true;                                  // 'None' is always acceptable
    return (m[side] || []).some(id => String(id) === String(r.id));
}
// Human-readable list of what IS allowed (for flags/pickers).
export function biqAllowedControlNames(mappings, blindType, side) {
    const m = biqControlMatrixFor(mappings, blindType);
    if (!m) return null;
    const cat = side === 'c2' ? 'control2' : 'control1';
    const inv = {};
    Object.entries(mappings[cat] || {}).forEach(([k, v]) => { if (inv[v] === undefined || k.length > inv[v].length) inv[v] = k; });
    return (m[side] || []).map(id => inv[id] || ('#' + id)).map(biqTitleCase);
}
function biqTitleCase(s) { return String(s).replace(/\b[a-z]/g, c => c.toUpperCase()); }
// Snap controls onto the type's matrix where the answer is FORCED, flag where it isn't:
//  - a side whose matrix holds exactly ONE option and the current value isn't legal -> set it
//    (Cellular C2 must be "Free Hang" — a parsed "Rh Pin" is an artefact, not information);
//  - an illegal MANUAL drive when the matrix has exactly one manual family on that side -> swap
//    drive family, keep the side (dealer "LHC" on a cellular = left-hand control = Lh Cordlock);
//  - anything else illegal is left in place for collectProblems to flag. Bracket-assigned sides
//    (Coupled/Intermediate) are never touched.
export function biqApplyControlMatrix(mappings, order) {
    const MANUAL = /cordlock|chain|wand|cord|crank|spring/i;
    ((order && order.items) || []).forEach(it => {
        const m = biqControlMatrixFor(mappings, it.blindType);
        if (!m || it._bracketRole) return;
        [['c1', 'control1', 'Lh'], ['c2', 'control2', 'Rh']].forEach(([side, field, pref]) => {
            const cur = biqNorm(it[field]);
            if (/coupled|intermediate/i.test(cur)) return;
            const ok = biqControlAllowed(mappings, it.blindType, side, cur);
            if (ok !== false) return;                              // legal, unknown, or no data
            const names = biqAllowedControlNames(mappings, it.blindType, side) || [];
            if (names.length === 1) { it[field] = names[0]; it._ctlMatrixed = true; return; }
            if (MANUAL.test(cur)) {
                const sidePrefix = new RegExp('^' + (cur.match(/^(lh|rh)/i) ? cur.match(/^(lh|rh)/i)[1] : pref), 'i');
                const manuals = names.filter(n => MANUAL.test(n));
                const families = [...new Set(manuals.map(n => (n.match(MANUAL) || [''])[0].toLowerCase()))];
                if (families.length === 1) {
                    const sameSide = manuals.find(n => sidePrefix.test(n));
                    if (sameSide) { it[field] = sameSide; it._ctlMatrixed = true; }
                }
            }
        });
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
// The shared-bracket option's exact name varies per blind type in BlindIQ —
// "Intermediate Bracket" + "Coupled Bracket" (Element Roller Sys 40), a single
// "Intermediate/Coupled  Bracket" (Roller System 40, double space and all),
// "Intermediate" (Element Vision). Target the blind type's OWN spec key so the
// option actually imports (Breed order J0000509-4 flagged the literal key as
// not-importable, Russel 2026-08-07). Falls back to the literal name when the
// spec is unknown.
function biqBracketOptionKey(mappings, it, kind) {
    const spec = biqVariantSpec(mappings, it.blindType, it.range) || [];
    const re = kind === 'coupled' ? /coupl/i : /interm/i;
    const o = spec.find(s => re.test(s.k));
    return o ? o.k : (kind === 'coupled' ? 'Coupled Bracket' : 'Intermediate Bracket');
}
// INTERMEDIATE bracket: two blinds share a bracket but operate independently (two drives).
// Each blind keeps its own drive; its non-drive (inner/shared) side becomes "[side] Intermediate".
// Bracket is costed once: Intermediate Bracket = Yes on the first line, No on the second.
export function biqApplyIntermediatePair(mappings, order, i, j) {
    [i, j].forEach(idx => {
        const it = order.items[idx]; if (!it) return;
        // If the document already states which side carries the shared bracket, trust it.
        // (July test: "Lh Pin / Rh Intermediate" reached this fallback and had its explicit
        // Pin overwritten, producing an impossible double-intermediate that went to production.)
        const intL = /intermediate/i.test(it.control1 || ''), intR = /intermediate/i.test(it.control2 || '');
        if (intL !== intR) return;
        const s = biqDriveSide(it);
        if (s === 'R') it.control1 = 'Lh Intermediate';            // drive right -> left is shared
        else if (s === 'L') it.control2 = 'Rh Intermediate';       // drive left  -> right is shared
        else if (s === 'B') { /* two drives, no free side — leave for the capturer */ }
        else if (/pin/i.test(it.control1)) it.control1 = 'Lh Intermediate';
        else if (/pin/i.test(it.control2)) it.control2 = 'Rh Intermediate';
        else it.control1 = 'Lh Intermediate';
    });
    biqSetVar(order.items[i].variants, biqBracketOptionKey(mappings, order.items[i], 'intermediate'), 'Yes');
    biqSetVar(order.items[j].variants, biqBracketOptionKey(mappings, order.items[j], 'intermediate'), 'No');
    order.items[i]._bracketRole = 'intermediate-1'; order.items[j]._bracketRole = 'intermediate-2';
}
// COUPLED bracket: two blinds joined, operated by ONE drive on one outer end. The two inner sides
// are "Coupled"; the operating blind's outer side keeps its drive (chain/motor); the partner's
// outer side is a Pin. i = first/left line, j = second/right line. Coupled Bracket Yes on i, No on j.
export function biqApplyCoupledPair(mappings, order, i, j) {
    const a = order.items[i], b = order.items[j]; if (!a || !b) return;
    // Same principle as the intermediate guard: when BOTH lines already state their Coupled
    // side (TBD's "Left End=Coupled / Right End=Control"), the document has fully specified
    // the geometry — only cost the bracket, never reshuffle the stated controls.
    const stated = it => /coupled/i.test(it.control1 || '') !== /coupled/i.test(it.control2 || '');
    if (!(stated(a) && stated(b))) {
        const sa = biqDriveSide(a), sb = biqDriveSide(b);
        let opIsA = (sa && sa !== 'B');
        if (!(sa && sa !== 'B') && (sb && sb !== 'B')) opIsA = false;
        const driveOf = (it, s) => (s === 'L') ? it.control1 : (s === 'R') ? it.control2
            : (/chain|motor/i.test(biqLc(it.control1)) ? it.control1 : it.control2);
        a.control2 = 'Rh Coupled';                                 // a inner (right)
        b.control1 = 'Lh Coupled';                                 // b inner (left)
        if (opIsA) {
            a.control1 = biqReSide(driveOf(a, sa) || 'Chain', 'L');// a outer left = drive
            b.control2 = 'Rh Pin';                                 // b outer right = pin
        } else {
            b.control2 = biqReSide(driveOf(b, sb) || 'Chain', 'R');// b outer right = drive
            a.control1 = 'Lh Pin';                                 // a outer left = pin
        }
    }
    biqSetVar(a.variants, biqBracketOptionKey(mappings, a, 'coupled'), 'Yes');
    biqSetVar(b.variants, biqBracketOptionKey(mappings, b, 'coupled'), 'No');
    a._bracketRole = 'coupled-1'; b._bracketRole = 'coupled-2';
}
// Detect/apply shared brackets across the order. Manual "couple with next line" (it._bracketWith)
// wins; otherwise consecutive lines flagged (notes or an explicit Yes) are paired two-by-two.
// A flagged line with no pair is marked (_bracketOdd) so collectProblems can surface it.
export function biqApplyBracketPairs(mappings, order) {
    const items = (order && order.items) || [];
    items.forEach(it => { delete it._bracketOdd; delete it._bracketRole; });
    // Fold bracket options onto each blind type's OWN key and clean phantoms
    // FIRST: a dealer's literal "Intermediate Bracket=Yes", or a row left behind
    // after the blind type resolved to a product that spells it differently
    // ("Intermediate/Coupled  Bracket"), must become the type's real option —
    // never a phantom BlindIQ won't import (Breed follow-up, Russel 2026-08-07).
    // A Yes value carries over to the real key; No/blank phantoms just drop
    // (absence = No in BlindIQ). Runs every refresh, so it self-heals.
    items.forEach(it => {
        const spec = biqVariantSpec(mappings, it.blindType, it.range);
        if (!spec) return;
        const specKeys = new Set(spec.map(o => biqLc(o.k)));
        for (let x = it.variants.length - 1; x >= 0; x--) {
            const [k, v] = it.variants[x];
            if (!/interm|coupl/i.test(k) || specKeys.has(biqLc(k))) continue;
            it.variants.splice(x, 1);
            const kind = /coupl/i.test(k) && !/interm/i.test(k) ? 'coupled' : 'intermediate';
            if (biqNorm(v) && !/^(no|none|false)$/i.test(biqNorm(v))) {
                const real = biqBracketOptionKey(mappings, it, kind);
                if (specKeys.has(biqLc(real))) biqSetVar(it.variants, real, biqNorm(v));
            }
        }
    });
    const consumed = new Set();
    const flag = it => {
        // any bracket-family key set to Yes counts, whatever this type calls it;
        // a combined "Intermediate/Coupled" Yes with no other signal is treated
        // as intermediate (drives stay independent — the safer geometry).
        const keyYes = re => it.variants.some(v => re.test(biqLc(v[0])) && biqLc(v[1]) === 'yes');
        const note = biqNorm(it.notes);
        if (/\bcoupl/i.test(note) || (keyYes(/coupl/) && !keyYes(/interm/))) return 'coupled';
        if (/\b(centre|center|middle|intermediate)\s+brackets?\b/i.test(note) || keyYes(/interm/)
            || it.variants.some(v => /\b(centre|center|middle)\s+brackets?\b/i.test(biqLc(v[0])))) return 'intermediate';
        return null;
    };
    for (let i = 0; i < items.length; i++) {                       // manual: couple with next line
        const m = items[i]._bracketWith;
        if (m && i + 1 < items.length && !consumed.has(i) && !consumed.has(i + 1)) {
            if (m === 'coupled') biqApplyCoupledPair(mappings, order, i, i + 1); else biqApplyIntermediatePair(mappings, order, i, i + 1);
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
            if (f === 'coupled') biqApplyCoupledPair(mappings, order, run[k], run[k + 1]); else biqApplyIntermediatePair(mappings, order, run[k], run[k + 1]);
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
