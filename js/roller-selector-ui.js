// =============================================================================
// roller-selector-ui.js — the "Roller check" view: the Roller System Selector in OrderBot
//
// Renders into #roller-check-view: one card per blind (fabric, size, bottom bar, chain or motor), with the
// weight, the tube, the chain or the motors that lift it, and every warning, worked out by js/roller-selector.js
// (the same rules the comparison flags with). A motor picked under "Motor on the order" is checked against the
// blind: the tube it fits, its torque (the lift and the bearing friction), Louvolite's weight capacity for it and, for a
// battery motor, how long one charge lasts.
//
// Fabrics come from OrderBot's one fabric list (Fabric properties, Firestore orderbot_fabric_properties), read
// through deps.getFabricProperties when the view opens; the motors and rules are in js/roller-selector.js. The
// makers' own motor records (deps.getMotorCalcRecords, optional) make a battery figure the maker's instead of an
// estimate from the datasheet, and OrderBot's motor table (deps.getMotorProperties, optional) gives the narrowest
// blind a motor goes in. The lines are kept in localStorage (ob_roller_lines) for the person using the page
// only. Everything is written as text nodes.
//
// Named exports only, no build step (browser-native ES module).
// =============================================================================

import { MOTORS, BRANDS, LIMITS, fabricsOf, protocolsOf, selectRollerSystem } from './roller-selector.js';
import { monthsText } from './roller-motor-calc.js';

const STORE = 'ob_roller_lines';
const LEVEL_CLASS = { error: 'bg-red-100 text-red-800', warning: 'bg-yellow-100 text-yellow-800', info: 'bg-blue-100 text-blue-800', ok: 'bg-green-100 text-green-800' };
const blank = () => ({ location: '', fabric: '', kgPerM2: '', width: '', drop: '', bar: 'Alu Bottom Bar', system: 'auto', control: 'chain', brand: '', power: '', protocol: '', motorName: '', has15: false, hasSpring: false });

let root = null, lines = [], fabrics = null, fabricError = '', deps = {}, records = null, motorTable = null;
// "· battery about 8½ months" beside a battery motor ("est." when it is worked out from the datasheet)
const batteryNote = b => (b ? ` · battery ${monthsText(b.days)}${b.basis === 'estimate' ? ' (est.)' : ''}` : '');

function load() {
    try { const v = JSON.parse(localStorage.getItem(STORE) || '[]'); if (Array.isArray(v) && v.length) return v.map(x => ({ ...blank(), ...x })); } catch (e) { /* private window, blocked storage */ }
    return [blank()];
}
function save() { try { localStorage.setItem(STORE, JSON.stringify(lines)); } catch (e) { /* not kept: fine */ } }

function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
        else if (v === true) n.setAttribute(k, '');
        else if (v !== false && v != null) n.setAttribute(k, v);
    }
    kids.flat().forEach(c => c != null && n.append(c));
    return n;
}
const field = (label, input) => el('label', { class: 'block text-xs font-bold text-slate-600' }, label, input);
const inputCls = 'mt-1 w-full p-2 border rounded text-sm font-normal text-slate-900 bg-white';
function select(value, options, onchange) {
    const s = el('select', { class: inputCls, onchange: e => onchange(e.target.value) });
    options.forEach(([v, t]) => s.append(el('option', { value: v, text: t, selected: v === value })));
    return s;
}
const num = (value, placeholder, oninput) => el('input', { type: 'number', min: '0', class: inputCls, value, placeholder, oninput: e => oninput(e.target.value) });

function lineCard(line, idx) {
    const set = (k, v, rerender = false) => { line[k] = v; save(); rerender ? render() : refreshResult(); };
    const result = el('div', { class: 'mt-4' });
    const refreshResult = () => { result.replaceChildren(resultView(line)); };

    const fabric = el('input', { type: 'text', class: inputCls, value: line.fabric, list: 'roller-fabrics', placeholder: 'e.g. 5 Screen', oninput: e => set('fabric', e.target.value) });
    const title = el('p', { class: 'bd-panel-title', text: `Blind ${idx + 1}${line.location ? ' — ' + line.location : ''}` });
    const grid = el('div', { class: 'grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3' },
        field('Location / ref', el('input', { type: 'text', class: inputCls, value: line.location, oninput: e => { set('location', e.target.value); title.textContent = `Blind ${idx + 1}${line.location ? ' — ' + line.location : ''}`; } })),
        field('Fabric (range)', fabric),
        field('Fabric kg/m² (if not listed)', num(line.kgPerM2, 'from the list', v => set('kgPerM2', v))),
        field('Width (mm)', num(line.width, '', v => set('width', v))),
        field('Drop (mm)', num(line.drop, '', v => set('drop', v))),
        field('Bottom bar', select(line.bar, [['Alu Bottom Bar', 'Aluminium / oval (0.28 kg/m)'], ['SmartRail', 'SmartRail (0.36 kg/m)'], ['Plastic Bottom Bar', 'Plastic (0.20 kg/m)']], v => set('bar', v))),
        field('System', select(line.system, [['auto', 'Work it out'], ['40', 'Roller System 40'], ['55', 'Roller System 55']], v => set('system', v))),
        field('Control', select(line.control, [['chain', 'Chain (manual)'], ['motor', 'Motorised']], v => set('control', v, true))));
    if (line.control === 'motor') {
        const motors = MOTORS.filter(m => (!line.brand || m.brand === line.brand) && (!line.power || m.power === line.power) && (!line.protocol || m.protocol === line.protocol));
        grid.append(
            field('Motor brand', select(line.brand, [['', 'Any'], ...BRANDS.map(b => [b, b])], v => { line.protocol = ''; line.motorName = ''; set('brand', v, true); })),
            field('Power', select(line.power, [['', 'Either'], ['wf', 'Wire-free (battery)'], ['220v', '220V']], v => { line.motorName = ''; set('power', v, true); })),
            field('Protocol', select(line.protocol, [['', 'Any'], ...(line.brand ? protocolsOf(line.brand) : [...new Set(MOTORS.map(m => m.protocol))]).map(p => [p, p])], v => { line.motorName = ''; set('protocol', v, true); })),
            field('Motor on the order (optional)', select(line.motorName, [['', '— check a motor —'], ...motors.map(m => [m.name, `${m.name} (Sys ${m.systems.join('/')})`])], v => set('motorName', v))));
    } else {
        grid.append(
            el('label', { class: 'flex items-center gap-2 text-xs font-bold text-slate-600 mt-6' }, el('input', { type: 'checkbox', checked: line.has15, onchange: e => set('has15', e.target.checked) }), 'System 40 1.5:1 on the order'),
            el('label', { class: 'flex items-center gap-2 text-xs font-bold text-slate-600 mt-6' }, el('input', { type: 'checkbox', checked: line.hasSpring, onchange: e => set('hasSpring', e.target.checked) }), 'Lift Assisting Spring on the order'));
    }
    const head = el('div', { class: 'flex items-center justify-between mb-3' },
        title,
        el('div', { class: 'flex gap-2' },
            el('button', { type: 'button', class: 'bd-btn-secondary py-1 px-3 text-sm', text: 'Copy', onclick: () => { lines.splice(idx + 1, 0, { ...line }); save(); render(); } }),
            lines.length > 1 ? el('button', { type: 'button', class: 'bd-btn-secondary py-1 px-3 text-sm', text: 'Remove', onclick: () => { lines.splice(idx, 1); save(); render(); } }) : null));
    refreshResult();
    return el('div', { class: 'bd-card p-5 mb-4' }, head, grid, result);
}

function stat(label, value) {
    return el('div', { class: 'p-2 rounded bg-slate-50 border border-slate-200' }, el('div', { class: 'text-xs text-slate-500', text: label }), el('div', { class: 'text-sm font-bold text-slate-900', text: value }));
}

function resultView(line) {
    const r = selectRollerSystem({
        ...line,
        fabrics,
        records,
        motorTable,
        system: line.system === 'auto' ? 'auto' : +line.system,
        kgPerM2: parseFloat(line.kgPerM2) || 0,
    });
    const wrap = el('div');
    if (r.width > 0 && r.drop > 0) {
        const stats = el('div', { class: 'grid grid-cols-2 md:grid-cols-5 gap-2 mb-3' },
            // the weight shown is the one used: the list's, or the typed one when the list has none for this fabric
            stat('Fabric', r.fabric ? `${r.fabric.name} · ${r.fabric.kg ?? (parseFloat(line.kgPerM2) > 0 ? line.kgPerM2 + ' (typed)' : '?')} kg/m² · roll ${r.fabric.roll} mm` : (line.kgPerM2 ? line.kgPerM2 + ' kg/m²' : '—')),
            stat('Blind weight', r.kg != null ? r.kg.toFixed(2) + ' kg' : '—'),
            // what a motor must give: the lift at the heaviest point with the bearing friction
            stat('Torque needed', r.torque[40] != null && r.torque[55] != null ? `Sys 40 ${r.torque[40].toFixed(2)} · Sys 55 ${r.torque[55].toFixed(2)} Nm` : '—'),
            stat('System', r.system ? 'Roller System ' + r.system : '—'),
            stat(line.control === 'motor' ? 'Lightest motor that lifts it' : 'Chain', line.control === 'motor'
                ? (r.recommended ? `${r.recommended.motor.name} (Sys ${r.recommended.system})${batteryNote(r.recommended.battery)}` : '—')
                : (r.chain ? r.chain.advice : '—')));
        wrap.append(stats);
        if (r.alternatives.length) wrap.append(el('p', { class: 'text-xs text-slate-500 mb-2', text: 'Also lifts it: ' + r.alternatives.map(a => `${a.motor.name} (Sys ${a.system})${batteryNote(a.battery)}`).join(' — ') }));
    }
    const msgs = r.messages.length ? r.messages : (r.width > 0 && r.drop > 0 && r.kg != null ? [{ level: 'ok', text: 'Within the selector\'s limits.' }] : []);
    msgs.forEach(m => wrap.append(el('div', { class: `p-2 mb-1 rounded text-sm font-semibold ${LEVEL_CLASS[m.level] || ''}`, text: m.text })));
    return wrap;
}

function render() {
    const list = el('div');
    lines.forEach((l, i) => list.append(lineCard(l, i)));
    const dl = el('datalist', { id: 'roller-fabrics' });
    fabricsOf(fabrics).forEach(f => dl.append(el('option', { value: f.name })));
    const listNote = fabricError
        ? el('div', { class: `p-2 mt-3 rounded text-sm font-semibold flex items-center justify-between gap-3 ${LEVEL_CLASS.error}` },
            el('span', { text: fabricError }),
            el('button', { type: 'button', class: 'bd-btn-secondary py-1 px-3 text-sm', text: 'Try again', onclick: () => loadFabrics().then(render) }))
        : el('p', { class: 'text-xs text-slate-500 mt-2', text: `Fabrics: OrderBot's fabric list (${fabricsOf(fabrics).length} fabrics), edited under Fabric properties on the Orders view.` });
    root.replaceChildren(
        el('div', { class: 'flex items-center justify-between mb-2 px-1' },
            el('p', { class: 'bd-overline', style: 'margin-bottom:0;', text: 'Roller check — Roller System Selector' })),
        el('div', { class: 'bd-card p-5 mb-4 text-sm text-slate-700' },
            el('p', { text: `Roller System 40 and 55 blinds: the weight, the tube, the chain or the motors that lift it. System 40 to ${LIMITS[40].width} × ${LIMITS[40].drop} mm; System 55 to ${LIMITS[55].width} × ${LIMITS[55].drop} mm and ${LIMITS[55].kg} kg. Chain: 1:1 to 4 kg, 1.5:1 from 4 to 8 kg, System 55 beyond. A motor's torque must cover the lift at the blind's heaviest point, with the fabric rolled on the tube, and the bearing friction, on the tube it goes in; a One Touch motor must also be within Louvolite's weight capacity. A battery motor shows how long one charge lasts at one up and down a day${records ? '' : ' (an estimate from the datasheet)'}. The same rules flag OrderBot's comparisons.` }), listNote),
        dl, list,
        el('div', { class: 'flex justify-center gap-3 mb-10' },
            el('button', { type: 'button', class: 'bd-btn-primary py-2 px-5', text: '+ Add a blind', onclick: () => { lines.push(blank()); save(); render(); } }),
            el('button', { type: 'button', class: 'bd-btn-secondary py-2 px-5', text: 'Clear all', onclick: () => { lines = [blank()]; save(); render(); } })));
}

// The fabric list, through deps.getFabricProperties. Empty or failed: say so (with "Try again"), never guess.
async function loadFabrics() {
    fabricError = '';
    try {
        // index.html's module may set its dependencies after the pill was first clicked: read them now
        const get = (deps && deps.getFabricProperties) || (window.OrderBotRollerDeps && window.OrderBotRollerDeps.getFabricProperties);
        fabrics = await get();
        if (!fabrics || !fabrics.size) fabricError = "OrderBot's fabric list is empty or not loaded yet, so fabrics can't be looked up: try again, or type each fabric's weight (kg/m²).";
    } catch (e) {
        console.error('Roller check: fabric list not loaded', e);
        fabrics = null;
        fabricError = "OrderBot's fabric list could not be loaded, so fabrics can't be looked up: try again, or type each fabric's weight (kg/m²).";
    }
    // the makers' own motor records, when the page has them: optional, so a failure only leaves the estimates
    try {
        const getRecords = (deps && deps.getMotorCalcRecords) || (window.OrderBotRollerDeps && window.OrderBotRollerDeps.getMotorCalcRecords);
        records = getRecords ? await getRecords() : null;
    } catch (e) { records = null; }
    // OrderBot's motor table, for the narrowest blind a motor goes in (its Min W): optional too. Without it a longer
    // motor is named by Louvolite's minimum blind width.
    try {
        const getTable = (deps && deps.getMotorProperties) || (window.OrderBotRollerDeps && window.OrderBotRollerDeps.getMotorProperties);
        motorTable = getTable ? await getTable() : null;
    } catch (e) { motorTable = null; }
}
// d: { getFabricProperties } (index.html): resolves to the fabric list (fabricList() in js/roller-selector.js)
export async function initRollerCheck(d = {}) {
    root = document.getElementById('roller-check-view');
    if (!root) return;
    deps = d;
    lines = load();
    root.replaceChildren(el('p', { class: 'bd-overline', text: 'Roller check — loading the fabric list…' }));
    await loadFabrics();
    render();
}
