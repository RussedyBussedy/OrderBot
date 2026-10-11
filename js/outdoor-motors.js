// The Somfy motor for a motorised outdoor blind, from the Zip X motor table (Oct 2026). Pure: tested in node.
//
// Russel (Oct 2026): "zip x blinds should follow the specific zipx table to determine which Somfy motor to use".
// The table is the Outdoor Price List July 2026, page 14, "Maestria Motor for Zip X Blinds": two width × drop grids
// of the Maestria io torque (every motor 17 rpm), one for the 78 mm tube (135 mm cassette, or no cassette) and one
// for the 95 mm tube that comes with the 165 mm cassette. Ruling 3 (Russel, 23 Sep 2026) uses the same grids for
// Free Hang, Channel X and Wire X: "the conservative choice: a blind without side zips drags less than a Zip X of
// the same size". A size between two lines of the table is read at the next width and drop up (BDO652491:
// 5740 × 3690 on the 165 mm cassette is read at 6000 × 4000, 25 Nm; it was made with 15 Nm and the 25 Nm motor
// was sent free of charge afterwards on BDO658949).
//
// The weight-based torque estimate (runPostAIValidations, section 0) gave that blind 6.6 Nm with the safety
// margin, so for these blinds the table replaces it: validateOutdoorMotors sets `motorTableValidation` on each
// motorised outdoor line (error: a smaller motor than the table; warning: no motor on the table at that size;
// info: the table's motor, or a bigger one) and drops the weight-based torque figures and alert for that line.

export const TABLE_WIDTHS = [800, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 7000];
export const TABLE_DROPS = [800, 1000, 1500, 2000, 2500, 3000, 4000, 5000];
// rows: drop (TABLE_DROPS), columns: width (TABLE_WIDTHS); Nm, 0 = "NA" (no motor offered at that size)
export const MOTOR_TABLE = {
    78: [
        [0, 0, 0, 0, 6, 6, 6, 6, 10, 10],
        [0, 0, 0, 6, 6, 6, 6, 6, 10, 10],
        [0, 0, 0, 6, 6, 6, 6, 10, 10, 15],
        [0, 0, 6, 6, 6, 6, 10, 10, 15, 15],
        [0, 0, 6, 6, 6, 10, 10, 15, 15, 15],
        [0, 0, 6, 10, 10, 10, 15, 15, 15, 15],
        [0, 0, 10, 10, 15, 15, 15, 15, 25, 25],
        [0, 0, 15, 15, 15, 15, 25, 25, 25, 35],
    ],
    95: [
        [0, 0, 0, 6, 6, 6, 6, 10, 10, 15],
        [0, 0, 0, 6, 6, 6, 10, 10, 15, 15],
        [0, 0, 6, 6, 6, 6, 10, 10, 15, 15],
        [0, 0, 6, 6, 6, 10, 10, 15, 15, 15],
        [0, 0, 6, 10, 10, 10, 15, 15, 15, 25],
        [0, 6, 10, 10, 10, 15, 15, 15, 25, 25],
        [0, 10, 10, 15, 15, 15, 15, 25, 25, 25],
        [0, 15, 15, 15, 15, 25, 25, 25, 35, 35],
    ],
};

const s = v => (v == null ? '' : String(v)).trim();
const mm = v => { const m = s(v).match(/\d{2,5}/); return m ? parseInt(m[0], 10) : NaN; };
// the next line of the table up (the size itself when it is on the table); -1 beyond the table
const upTo = (axis, v) => axis.findIndex(a => a >= v);

// Free Hang, Zip X, Channel X and Wire X (Blind IQ: "Outdoor Zip X" ...). Widescreen runs on a 105 mm tube: not on the table.
export const isTableBlind = blindType => /\b(zip\s*x|channel\s*x|wire\s*x|free\s*hang)\b/i.test(s(blindType)) && !/widescreen/i.test(s(blindType));

// The table's torque for a width × drop on the 78 or 95 mm tube: { torque (0 = NA), readAt: { width, drop } }, or
// { beyond: true } past the table's 7000 × 5000 mm.
export function tableTorque(widthMm, dropMm, tube = 78) {
    const w = mm(widthMm), d = mm(dropMm);
    if (isNaN(w) || isNaN(d)) return null;
    const c = upTo(TABLE_WIDTHS, w), r = upTo(TABLE_DROPS, d);
    if (c < 0 || r < 0) return { beyond: true, tube };
    return { torque: MOTOR_TABLE[tube === 95 ? 95 : 78][r][c], readAt: { width: TABLE_WIDTHS[c], drop: TABLE_DROPS[r] }, tube: tube === 95 ? 95 : 78 };
}

// The 95 mm tube comes with the 165 mm cassette ("Full Cassette 165mm=Yes" on Blind IQ's line); otherwise 78 mm.
export function tubeOf(item) {
    const specs = (item && item.specifications) || [];
    const on = v => !/^(no|none|n\/a|-|0|false|)$/i.test(s(v));
    for (const sp of specs) {
        const name = s(sp && sp.specName), v = s(sp && sp.specComparison && sp.specComparison.blindIQValue);
        if (/\b165\s*mm\b|\b95\s*mm\s*tube\b/i.test(name) && on(v)) return 95;
        if (/\b165\s*mm\b|\b95\s*mm\s*tube\b/i.test(v)) return 95;
    }
    return 78;
}

// "Maestria IO 25nm/17rpm", "Motors Somfy Io / Maestria IO 15nm/17rpm", "Maestria Rts 10nm/17" -> 25, 15, 10
export function maestriaTorque(desc) {
    const m = s(desc).match(/maestria\b[^0-9]*?(\d{1,2})\s*n\.?\s*m\b/i);
    return m ? parseInt(m[1], 10) : null;
}

const isMotorised = it => /motor/i.test(s(it.control1 && it.control1.blindIQValue) + ' ' + s(it.control2 && it.control2.blindIQValue));

export function validateOutdoorMotors(data) {
    const out = { checked: 0, errors: 0, warnings: 0 };
    if (!data || !Array.isArray(data.lineItems)) return out;
    const lines = data.lineItems.filter(it => it && isTableBlind(it.blindType && it.blindType.blindIQValue) && isMotorised(it));
    if (!lines.length) return out;
    // the Somfy Maestria motors on the order, one per unit
    const motors = [];
    (data.sundries || []).forEach(sd => {
        const name = s(sd && sd.item && sd.item.blindIQValue), t = maestriaTorque(name);
        if (!t) return;
        const q = Math.max(1, parseInt(sd.quantity, 10) || 1);
        for (let i = 0; i < q; i++) motors.push({ torque: t, name });
    });
    const need = lines.map(it => {
        const width = mm(it.width && it.width.blindIQValue), drop = mm(it.drop && it.drop.blindIQValue), tube = tubeOf(it);
        return { it, width, drop, tube, t: tableTorque(width, drop, tube), area: width * drop };
    }).filter(x => x.t);
    // most demanding blind first, strongest motor first: the pairing most in the order's favour, so an error means
    // no way of fitting these motors to these blinds follows the table (blinds the table has no motor for go last)
    const req = x => (x.t.beyond || !x.t.torque) ? -1 : x.t.torque;
    need.sort((a, b) => (req(b) - req(a)) || (b.area - a.area));
    motors.sort((a, b) => b.torque - a.torque);
    need.forEach((x, k) => {
        const it = x.it;
        out.checked++;
        const size = `${x.width} × ${x.drop} mm`;
        const grid = `${x.tube} mm tube${x.tube === 95 ? ' / 165 mm cassette' : ''} grid`;
        // the table decides the motor for these blinds: the weight-based estimate is dropped
        delete it.requiredTorque; delete it.requiredTorqueSafety; delete it.torqueValidation;
        const m = motors[k];
        // with no Somfy Maestria motor on the order (ShawSmart, or the customer's own motor) the table is shown, not checked
        const somfy = motors.length > 0;
        if (x.t.beyond) {
            it.motorTableValidation = { type: somfy ? 'warning' : 'info', message: `Zip X Motor Table: ${size} is beyond the table (it runs to 7000 × 5000 mm) — ask the factory which motor.` };
            if (somfy) out.warnings++;
            return;
        }
        const at = `${grid}, read at ${x.t.readAt.width} × ${x.t.readAt.drop}`;
        it.motorTable = { torque: x.t.torque, tube: x.tube, readAt: x.t.readAt, ordered: m ? m.torque : null };
        if (x.t.torque === 0) {
            it.motorTableValidation = { type: somfy ? 'warning' : 'info', message: `Zip X Motor Table: the table offers no Somfy motor for ${size} (${grid}, NA at ${x.t.readAt.width} × ${x.t.readAt.drop}) — check that this blind can be motorised.` };
            if (somfy) out.warnings++;
        } else if (!m) {
            it.motorTableValidation = { type: 'info', message: `Zip X Motor Table: Maestria io ${x.t.torque} Nm for ${size} (${at}); no Somfy Maestria motor on the order for this blind.` };
        } else if (m.torque < x.t.torque) {
            it.motorTableValidation = { type: 'error', message: `Zip X Motor Table: ${size} needs the Maestria io ${x.t.torque} Nm (${at}); the order has ${m.name}.` };
            out.errors++;
        } else if (m.torque > x.t.torque) {
            it.motorTableValidation = { type: 'info', message: `Zip X Motor Table: ${x.t.torque} Nm is enough for ${size} (${at}); ${m.torque} Nm is on the order.` };
        } else {
            it.motorTableValidation = { type: 'info', message: `Zip X Motor Table: ${x.t.torque} Nm for ${size} (${at}), as ordered.` };
        }
    });
    return out;
}
