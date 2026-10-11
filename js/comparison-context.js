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
- Valances: Blind IQ carries each valance as its own line (blind type Valance), so a valance order has more Blind IQ lines than customer lines and the item letters can differ (customer A with a valance can be Blind IQ A and B). Pair the lines by location, size and product; a letter difference caused only by the valance lines is a MATCH. On roller blinds, a valance whose style the customer does not name (just "valance", or only its colour, size or returns) is a Linear Valance, the usual roller valance; Half Round Valance, 70mm Cassette and the other valance ranges need the customer's wording. A customer document (often a Blind IQ Online export or a dealer system) can instead carry the cassette or valance as an option on the blind's own line ("Sys 40 70mm Cassette=Black", "items A, B & C in one cassette"): pair Blind IQ's separate Valance line (range 70mm Cassette, Linear Valance, …) with that option and compare its colour and width. A different colour is a MISMATCH on the Blind IQ Valance line, not an OMISSION.
- Valances, pelmets and curtain tracks have no drop: Blind IQ shows 0, which matches a customer document that gives only a width.
- Roller System 40 / 55: hardware (Mech Colour) White unless stated; a stated cassette colour sets it (Silver cassette = Grey hardware). Bottom bar and cassette follow the hardware colour (Grey hardware = Silver bar). Roll Type Standard unless a reverse roll is asked for. A fitted cassette has Cassette End Cap = Full End Cap. No chain tidy unless asked. "System 40 1.5:1" is fitted only to blinds over about 4 kg.
- Chain blinds have the chain on one side and a pin on the other (Lh Chain + Rh Pin, or Rh Chain + Lh Pin). Customers usually give only the control side ("R", "Right", "Rh chain"), which is the chain side; the pin on the other side comes with it, so a Blind IQ pin opposite the stated chain side is a MATCH, not an OMISSION. Two blinds sharing a bracket show Coupled or Intermediate on the shared side. Customers also write the side as "RC" / "LC" (right or left control) or "L" / "R" in a control column.
- Roller chains: the standard chain is a plastic chain matching the control colour (Mech Colour). Steel Ball Chain=Yes replaces it with a stainless steel ball chain. A colour given for the chain itself ("Black chain", "Chain: White", or White, Black, Grey or Anthracite in a control-colour column that offers Steel Ball Chain as one of its choices) means the plastic chain in that colour, so Steel Ball Chain=Yes is a MISMATCH. A mechanism colour on its own says nothing about the chain: when the customer does not mention the chain, Steel Ball Chain is NOT_SPECIFIED (it is often the dealer's standing choice).
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

// ---------------------------------------------------------------- reading the customer document (v2.4)
// The mistakes OrderBot missed (admin error cases and changes made after a check, July 2025 – October 2026)
// were mostly customer values reported as exactly what Blind IQ showed: a handwritten 2720 read as Blind IQ's
// 2700, "Opal" read as "Bronze", widths written under a sketch read as drops, a column header's legend
// "(Steel Ball Chain)" taken as the row's value, a cassette colour given on the blind lines while Blind IQ
// carries the cassette as its own line.
export const READING_RULES = `
# READING THE CUSTOMER DOCUMENT
Most mistakes OrderBot has missed were customer values reported as whatever Blind IQ shows. Read the customer document on its own terms:
- Read each customer value from the customer document itself before you look at Blind IQ's value for that field. customerValue is what the customer wrote, never Blind IQ's value copied across. When they are the same, say in the reasoning where on the customer document you read it (row and column, or the sketch).
- Never let Blind IQ's value decide how you read an unclear handwritten mark. Digits that are easy to confuse: 5 and 8, 2 and 7, 4 and 6 (an open 4), 1 and 7, 0 and 6, 3 and 8. Compare the mark with the same writer's other digits on the page (other sizes, the phone and order numbers) and report the digit it matches. If it could still be either, give your best reading with confidence 0.5 or lower: a MATCH on an unclear mark never has a confidence above 0.5.
- Sketches: the number along the top or bottom edge of a drawn window or box is its width, also when it is written under the box; the number along its left or right side is its drop. A size with "all" or "x3" beside it applies to every box in that group.
- A value belongs to its own row. Carry it to other rows only where the customer marks it so: ditto marks, an arrow or line down the column, "same", "as above", "all".
- Column headers: words in brackets or a list of choices in a header ("CONTROL COLOUR (Steel Ball Chain) (White/Black/Grey/Anthracite)", "Standard/Waterfall") show that column's options, not this row's value. Read the row's own cell; an empty cell is not specified.
- A multiplier after a size or an item ("1350 x 2", "x2", "2 off", "pair") is a quantity, not a drop.
- A customer document that only accepts a Blind Designs quote ("go ahead as per quote BDO669711", "1x double roller as per attached quote BDO659288") and gives no sizes has nothing to compare line by line: quote that wording in specialInstructions, leave the customer values empty and give the fields the result NOTE.
`;

// The second, customer-only reading (v2.4): the customer document without Blind IQ's, so nothing to lean on.
export const SECOND_READING_PROMPT = `
# TASK
Read ONLY the customer order document(s) below and list every line exactly as the customer wrote it. There is no supplier document: do not guess what a supplier system would contain, and do not correct the customer.

# RULES
- One entry per blind, valance, pelmet, cassette, track, side channel or other product line, in the order they appear on the document (top to bottom; on sketches left to right). Skip prices, totals and blank rows.
- width and drop: the millimetres as written, digits only. On a sketch the number along the top or bottom edge of a box is the width (also when it is written under the box) and the number along its left or right side is the drop. A size with "all" or "x3" beside it applies to every box in that group. A value carried down by ditto marks, an arrow, a line or "same" applies to those rows.
- qty: the number of pieces. A multiplier after a size or item ("1350 x 2", "x2", "2 off", "pair") is the quantity. Leave it empty when the line gives none.
- product, range, colour, control, fix, location: the customer's own words for that line, "" when the line does not give them. Words in brackets or a list of choices in a column header are that column's options, not the row's value.
- Handwriting: compare an unclear digit with the same writer's other digits on the page (other sizes, phone and order numbers) and give the digit it matches. Give a confidence from 0 to 1 for the width, drop, qty and colour of every line: 0.9 or more only when the writing is unambiguous, 0.5 or less when a digit could be read two ways.
- ref: the line's own label on the document (item letter or number, row number), "" if none.

# OUTPUT
Respond only with a JSON object with a "lines" array.
`;

export function secondReadingSchema() {
    const S = { type: 'STRING' }, N = { type: 'NUMBER' };
    return {
        type: 'OBJECT',
        properties: {
            lines: {
                type: 'ARRAY',
                items: {
                    type: 'OBJECT',
                    properties: { ref: S, location: S, qty: S, width: S, drop: S, product: S, range: S, colour: S, control: S, fix: S, notes: S,
                        qtyConfidence: N, widthConfidence: N, dropConfidence: N, colourConfidence: N },
                    required: ['ref', 'location', 'qty', 'width', 'drop', 'product', 'colour', 'widthConfidence', 'dropConfidence']
                }
            }
        },
        required: ['lines']
    };
}

// ---------------------------------------------------------------- converter reading
// reading = { order, format } from biqReadCustomerFile (js/biq-converter-ui.js): the converter's
// deterministic parse of a recognised dealer layout, after the same rules as the Drawings tab.
const nz = v => v != null && String(v).trim() !== '' && !/^(no|none)$/i.test(String(v).trim());
export function describeConverterReading(reading, fileName) {
    const o = reading && reading.order;
    if (!o || !(o.items || []).length) return '';
    const exact = !!(reading.exact || o.exact);
    const lines = o.items.map((it, i) => {
        const ctl = [it.control1, it.control2].filter(nz).join(' / ');
        const head = [`qty ${it.qty || 1}`, it.blindType || '(type not read)', it.range, it.colour,
            `${it.width || '?'} x ${it.drop || '?'}`, it.fix, ctl, nz(it.controlDrop) ? 'control drop ' + it.controlDrop : '']
            .filter(nz).join(' | ');
        const dflt = (reading.defaults || [])[i] || {};
        const lc = v => String(v || '').trim().toLowerCase();
        const opts = exact
            ? (it.exactOptions || []).filter(v => v && v[0] && String(v[1] || '').trim()).map(v => `${v[0]}: ${v[1]}`).join('; ')
            : (it.variants || []).filter(v => v && v[0] && nz(v[1]))
                .map(v => `${v[0]}: ${v[1]}` + (dflt[lc(v[0])] && dflt[lc(v[0])] === lc(v[1]) ? ' (default)' : '')).join('; ');
        const notes = String(it.notes || '').trim();
        return (exact && it.code ? `Item ${it.code}` : `Line ${i + 1}`) + `${it.location ? ' (' + it.location + ')' : ''}: ${head}`
            + (opts ? `\n  options: ${opts}` : '')
            + (notes ? `\n  ${exact ? 'note on the order' : 'converter notes'}: ${clip(notes, 500)}` : '');
    });
    const sundries = (o.sundries || []).map(s => `${s.qty || 1} x ${s._src || s.notes || s.sundry || ''}`).filter(s => !/x\s*$/.test(s));
    if (exact) return `
# THE CUSTOMER'S BLINDIQ ONLINE ORDER
The customer file "${fileName || ''}" is the dealer's own order captured in BlindIQ Online${o.iqLinkId ? ' (IQ Link ID ' + o.iqLinkId + ')' : ''}, printed in Blind IQ's own names. OrderBot parsed it without reading it by eye, so the values below ARE the customer's values: use them exactly as the customerValue of each line (match lines by the customer's item letter; Blind IQ's letters can shift when it adds a line, e.g. a separate Valance line). The options are those printed on the online order; every other option was left at the sheet's default.
${lines.join('\n')}${sundries.length ? '\nSundries: ' + sundries.join('; ') : ''}${o.notes ? '\nOrder message: ' + clip(o.notes, 500) : ''}
`;
    return `
# CONVERTER READING OF THE CUSTOMER DOCUMENT
OrderBot's document converter read the customer file "${fileName || ''}"${reading.format ? ' (' + reading.format + ')' : ''} as below, already in Blind IQ's product names. It is a fixed parser and usually right for this dealer layout. Use it to cross-check your own reading and to see which dealer wording maps to which Blind IQ name. The documents stay the source of truth: where the customer document clearly shows something else, follow the document and say so in the reasoning. An option marked "(default)" is Blind IQ's default for that product and may not be on the customer document at all. Converter notes such as "not on the order" or "the price list's standard" mark values the customer did not state. Fields the customer did not state are NOT_SPECIFIED unless they are among the fields that are never NOT_SPECIFIED.
${lines.join('\n')}${sundries.length ? '\nSundries: ' + sundries.join('; ') : ''}
`;
}
