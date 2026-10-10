// Context for the order-comparison AI (index.html → processSingleComparison), Oct 2026:
//  - the team's saved corrections, shown with the capturer's own words;
//  - Blind Designs' standards for values a customer document usually leaves out;
//  - the "NOT_SPECIFIED" result for values the customer never stated (information, not a flag);
//  - the document converter's own reading of the customer file.
// Pure functions and text: no DOM, no Firestore, so they can be tested in node.

// ---------------------------------------------------------------- corrections (orderbot_feedback)
// A saved correction holds the capturer's words (userExplanation) and, for newer ones, an AI rewrite
// (enhancedExplanation; "RAW: …" when the rewrite failed). 47 of the first 63 (July 2025) have no
// rewrite at all, so the prompt used to show them as "undefined"; some rewrites open with chat
// ("Here's a clear, precise rule for your AI…").
const CHATTY_LINE = /^\s*(here('|’)s|here is|here are|to (transform|ensure|provide|create|make|turn|write)|okay|ok,|sure|certainly|of course|absolutely)\b[^\n]*(\n+|$)/i;
const clip = (s, max) => (s.length > max ? s.slice(0, max).replace(/\s+\S*$/, '') + ' …' : s);

export function correctionText(fb, max = 600) {
    const user = String((fb && fb.userExplanation) || '').trim();
    let rule = String((fb && fb.enhancedExplanation) || '').trim().replace(/^RAW:\s*/i, '');
    for (let i = 0; i < 3 && CHATTY_LINE.test(rule); i++) rule = rule.replace(CHATTY_LINE, '').trim();
    rule = rule.replace(/^\s*-{3,}\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
    if (rule && user && rule.toLowerCase() === user.toLowerCase()) rule = '';
    return { user: clip(user, max), rule: clip(rule, max) };
}

// The 10 corrections whose text shares the most words with the file names (newest first on ties).
export function selectRelevantFeedback(allFeedback, contextTerms, n = 10) {
    const list = [...(allFeedback || [])];
    const newest = (a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
    if (!contextTerms || contextTerms.length === 0) return list.sort(newest).slice(0, n);
    const terms = contextTerms.map(t => String(t).toLowerCase());
    return list.map(fb => {
        const text = (JSON.stringify(fb.incorrectItem || '') + ' ' + (fb.userExplanation || '') + ' ' + (fb.enhancedExplanation || '')).toLowerCase();
        return { ...fb, _relevanceScore: terms.reduce((acc, t) => acc + (text.includes(t) ? 1 : 0), 0) };
    }).sort((a, b) => b._relevanceScore - a._relevanceScore || newest(a, b)).slice(0, n);
}

export function formatCorrectionExamples(list) {
    if (!list || !list.length) return '';
    return '\n# CORRECTION EXAMPLES\nMistakes the team corrected in earlier comparisons. Apply the lesson wherever the same situation appears.\n'
        + list.map((fb, i) => {
            const { user, rule } = correctionText(fb);
            return `Example ${i + 1}:\n- Incorrect item: ${JSON.stringify(fb.incorrectItem)}\n`
                + (user ? `- What was wrong (capturer): "${user}"\n` : '')
                + (rule ? `- Rule: "${rule}"\n` : '');
        }).join('\n');
}

// ---------------------------------------------------------------- Blind Designs standards
// From the Blind Price List and Shutter Price List (July 2026), the Roller System Selector and the
// converter rules checked against the orders BlindIQ stored (CLAUDE.md, "rules from Blind Designs'
// own documents"). Keep it to what a customer document typically leaves out.
export const BD_STANDARDS = `
# BLIND DESIGNS STANDARDS
What Blind Designs supplies when the customer document does not say otherwise. Blind IQ often shows these values although the customer never wrote them.
- Names: dealers use their own wording. "Roller", "Roller blind", "Element Roller", "Sys 40" and "System 40" mean Roller System 40 (System 55 only when stated); "Wood venetian" and "Element Wood" mean Wood Venetian; "Vertical" means 90mm Vertical Blind. Face = "F/Fix" = "FF" = "Face fix"; Reveal = "R/Fix" = "I/R" = "Recess" = "Inside reveal" = "Ceiling fix".
- Blind IQ range and colour names carry suffixes customers do not write: roll widths ("2050mm"), "@", "#", "^", "Fr", "/ Aventus 5%". Compare the name itself.
- Sizes: Blind IQ keeps widths and drops in 5 mm steps (1203 → 1205, 1201 → 1200). A 1–2 mm difference that is exactly this rounding is a MATCH; say so in the reasoning. Shutters, Perfect Fit, outdoor and skylight blinds are made to the millimetre: there every difference counts.
- Control drop: Blind IQ calculates it, usually 75 % of the drop for rollers, 66 % for venetians and Allusion, 80 % with a 1.5:1 control. A length the customer writes wins.
- Valances: Blind IQ carries each valance as its own line (blind type Valance), so a valance order has more Blind IQ lines than customer lines and the item letters can differ (customer A with a valance can be Blind IQ A and B). Pair the lines by location, size and product; a letter difference caused only by the valance lines is a MATCH. On roller blinds, a valance whose style the customer does not name (just "valance", or only its colour, size or returns) is a Linear Valance, the usual roller valance; Half Round Valance, 70mm Cassette and the other valance ranges need the customer's wording.
- Valances, pelmets and curtain tracks have no drop: Blind IQ shows 0, which matches a customer document that gives only a width.
- Roller System 40 / 55: hardware (Mech Colour) White unless stated; a stated cassette colour sets it (Silver cassette = Grey hardware). Bottom bar and cassette follow the hardware colour (Grey hardware = Silver bar). Roll Type Standard unless a reverse roll is asked for. A fitted cassette has Cassette End Cap = Full End Cap. No chain tidy unless asked. "System 40 1.5:1" is fitted only to blinds over about 4 kg.
- Chain blinds have the chain on one side and a pin on the other (Lh Chain + Rh Pin, or Rh Chain + Lh Pin). Customers usually give only the control side ("R", "Right", "Rh chain"), which is the chain side; the pin on the other side comes with it, so a Blind IQ pin opposite the stated chain side is a MATCH, not an OMISSION. Two blinds sharing a bracket show Coupled or Intermediate on the shared side.
- Out of Warranty is ticked when a roller fabric is turned beyond its roll width where the fabric may only be turned out of warranty, or when a blind is over the selling limit: System 40 3200 x 3400, System 55 4000 x 4500, Vision 2200 x 2600, Allusion 3990 x 3000 or under 750 wide.
- Venetians: under 600 mm wide Split controls, 600 mm and wider Grouped; 35mm Aluminium always Grouped. Valance returns: Reveal fix none, Face fix LH & RH. Retro on Standard slats has a matching aluminium valance and bottom bar ("Aluminium: <slat colour>").
- Verticals (90 mm): track White unless stated. The Control (chain & cord) colour follows the track colour; a wand is Mono-command.
- Allusion: 107 mm vane spacing unless 90 mm is asked for.
- Urban hinged shutters: 100 mm top and bottom rails on panels of 1201–1800 mm without a middle rail. Scribe strips are not fitted to new shutters.
- Cellular: headrail and bottom bar White unless stated.
- Outdoor Zip X, Channel X and Wire X: crank blinds get Silver Crank 8:1; motorised blinds have Crank Handle None.
- Curtain tracks: a centre split or float stack takes a Butt Arm Kit, a left or right stack a Single Butt Arm.
`;

// ---------------------------------------------------------------- the NOT_SPECIFIED result
// Over half the flags the comparison raised (7,304 of 13,679 across 841 comparisons, June–Oct 2026)
// were values the customer document does not mention at all; about 1 flag in 60 led to a change.
export const RESULT_VALUES = ['MATCH', 'MISMATCH', 'OMISSION', 'NOTE', 'NOT_SPECIFIED'];
// Paul's critical fields (js/constants.js CRITICAL_FIELDS) are never "not specified".
export const NOT_SPECIFIED_RULES = `
# WHEN THE CUSTOMER DOCUMENT IS SILENT
Result "NOT_SPECIFIED" means: the customer document does not mention this field or specification at all (no column, value, tick or note for it), and Blind IQ shows a value, usually a Blind Designs standard above or the capturer's choice. It is information for the capturer, not an error.
- Use NOT_SPECIFIED for specifications (the "=" line, including Control drop) and for Fix and Location. Put the Blind IQ value in blindIQValue, leave customerValue empty, and say in the reasoning whether the Blind IQ value is the Blind Designs standard.
- Never use NOT_SPECIFIED for Blind Type, Range, Colour, QTY, Width, Drop, Control 1 or Control 2. When one of these is missing from the customer document, the result is OMISSION. A value that follows from what the customer did state is not missing: the pin opposite a stated chain side, and the Linear Valance for a roller blind's valance whose style is not named, are a MATCH.
- MISMATCH: the customer document states a value and Blind IQ shows a different one. OMISSION: the customer asks for something Blind IQ does not have, or one of the fields above is missing.
`;

// ---------------------------------------------------------------- converter reading
// reading = { order, format } from biqReadCustomerFile (js/biq-converter-ui.js): the converter's
// deterministic parse of a recognised dealer layout, after the same rules as the Drawings tab.
const nz = v => v != null && String(v).trim() !== '' && !/^(no|none)$/i.test(String(v).trim());
export function describeConverterReading(reading, fileName) {
    const o = reading && reading.order;
    if (!o || !(o.items || []).length) return '';
    const lines = o.items.map((it, i) => {
        const ctl = [it.control1, it.control2].filter(nz).join(' / ');
        const head = [`qty ${it.qty || 1}`, it.blindType || '(type not read)', it.range, it.colour,
            `${it.width || '?'} x ${it.drop || '?'}`, it.fix, ctl, nz(it.controlDrop) ? 'control drop ' + it.controlDrop : '']
            .filter(nz).join(' | ');
        const dflt = (reading.defaults || [])[i] || {};
        const lc = v => String(v || '').trim().toLowerCase();
        const opts = (it.variants || []).filter(v => v && v[0] && nz(v[1]))
            .map(v => `${v[0]}: ${v[1]}` + (dflt[lc(v[0])] && dflt[lc(v[0])] === lc(v[1]) ? ' (default)' : '')).join('; ');
        const notes = String(it.notes || '').trim();
        return `Line ${i + 1}${it.location ? ' (' + it.location + ')' : ''}: ${head}`
            + (opts ? `\n  options: ${opts}` : '')
            + (notes ? `\n  converter notes: ${clip(notes, 500)}` : '');
    });
    const sundries = (o.sundries || []).map(s => `${s.qty || 1} x ${s._src || s.notes || s.sundry || ''}`).filter(s => !/x\s*$/.test(s));
    return `
# CONVERTER READING OF THE CUSTOMER DOCUMENT
OrderBot's document converter read the customer file "${fileName || ''}"${reading.format ? ' (' + reading.format + ')' : ''} as below, already in Blind IQ's product names. It is a fixed parser and usually right for this dealer layout. Use it to cross-check your own reading and to see which dealer wording maps to which Blind IQ name. The documents stay the source of truth: where the customer document clearly shows something else, follow the document and say so in the reasoning. An option marked "(default)" is Blind IQ's default for that product and may not be on the customer document at all. Converter notes such as "not on the order" or "the price list's standard" mark values the customer did not state. Fields the customer did not state are NOT_SPECIFIED unless they are among the fields that are never NOT_SPECIFIED.
${lines.join('\n')}${sundries.length ? '\nSundries: ' + sundries.join('; ') : ''}
`;
}
