// =============================================================================
// cost-report-console.js — "Cost report" admin console for OrderBot
//
// Self-contained: renders into #cost-report-view and receives every external
// dependency (db, Firestore fns, toast/modal, isAdmin) via
// initCostReportConsole(deps), the same injection style as initBiqConverter.
// It touches nothing outside its own section and its pill.
//
// Paul uses it to tweak the Daily Cost Report without touching the office PC.
// The PC (cost_report.py) reads `settings` at every run and writes `catalog`
// (the product lists + its defaults) and `status` (the last run) back here.
//
// Firestore contract: collection `orderbot_cost_report` (spec:
// claude/daily-cost-report/orderbot-console-spec.md in the Daily Cost Report
// project). This page WRITES `settings` only; it reads `catalog` and `status`
// and never changes them. cost_report.py v1.1.0 is built against these shapes,
// so do not change them.
//
// Firestore is open to OrderBot's anonymous users, so everything read from it
// is untrusted text: it only ever reaches the page as text nodes.
//
// Named exports only, no build step (browser-native ES module).
// =============================================================================

export const COLLECTION = 'orderbot_cost_report';
const SCHEMA = 1;
const NAME_KEY = 'cr_name';                     // localStorage: who saves (updatedBy)
const STALE_AFTER_MS = 25 * 3600 * 1000;        // weekday time since the last run: one working day + 1 h grace
const STATUS_RECHECK_MS = 5 * 60 * 1000;        // re-check "the PC may be off" while the page stays open
const SLOW_SAVE_MS = 10 * 1000;                 // a save not confirmed by then is probably offline

// The report's own defaults, used only until the PC publishes `catalog` (whose
// `defaults` are authoritative). Kept in step with cost_report.py.
const FALLBACK_DEFAULTS = {
    costThresholdPct: 60,
    discountMarginPts: 5,
    orderTypes: {},
    sections: { breakdown: true, internal: true, allOrders: false },
    details: {
        options: true, lineNotes: true, orderNotes: true, customerRef: true,
        capturedBy: true, rep: true, requiredDate: false, deliveryMethod: false,
    },
    recipients: { to: ['paul@blinddesigns.co.za'], cc: [] },
    sendWhenNothingFlagged: true,
    allowedRecipientDomains: ['blinddesigns.co.za'],
    reportTime: '16:30',
    reportDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    // What the send time and days may be. Only a PC that runs on a 15-minute schedule
    // (cost_report.py 1.3.0+) publishes this; until then the page offers no schedule.
    schedule: null,
};

// Send days in week order, as the PC names them; labels for the tick-boxes.
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const MISSED_GRACE_MS = 3600 * 1000;            // a send slot counts as missed an hour after its time

// Report-content switches in display order, with Paul's labels (spec §5).
const SECTION_FIELDS = [
    ['breakdown', 'Order breakdown pages'],
    ['internal', 'Error & showroom list'],
    ['allOrders', 'List of every order checked'],
];
const DETAIL_FIELDS = [
    ['options', 'Blind options'],
    ['lineNotes', 'Line notes'],
    ['orderNotes', 'Order notes'],
    ['customerRef', 'Customer ref'],
    ['capturedBy', 'Captured by'],
    ['rep', 'Rep'],
    ['requiredDate', 'Required date'],
    ['deliveryMethod', 'Delivery method'],
];
const ORDER_MODES = [
    ['check', 'Check'],
    ['list', 'List separately'],
    ['ignore', 'Ignore'],
];
const MODE_KEYS = ORDER_MODES.map(([k]) => k);

// --------------------------------------------------------------------------
// Small helpers
// --------------------------------------------------------------------------

/** Create an element. Text only ever goes in as text nodes, never parsed as HTML. */
function h(tag, attrs, children) {
    const el = document.createElement(tag);
    for (const k in (attrs || {})) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of [].concat(children == null ? [] : children)) {
        if (c == null || c === false) continue;
        el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
}
function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }
const byId = (id) => document.getElementById(id);
const muted = (text) => h('p', { class: 'cr-muted', text });
const isNum = (v) => typeof v === 'number' && isFinite(v);
const list = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const validLimit = (n) => isNum(n) && n >= 1 && n <= 100;

/** A number, or `fallback` when the value is blank or not numeric. */
function num(v, fallback) {
    if (v == null || v === '' || typeof v === 'boolean') return fallback;
    const n = Number(v);
    return isFinite(n) ? n : fallback;
}

/**
 * What was typed in a number box: "62", "62.5", "62,5" (decimal comma) or "65%", with at
 * most two decimals. Returns { value }, { blank } or { bad }. The boxes are plain text on
 * purpose: a type="number" box reads "5,5" as 55 in Chromium and anything it can't parse as blank.
 */
function readNumber(input) {
    const t = String(input.value).trim();
    if (t === '') return { blank: true };
    const m = /^(\d+(?:[.,]\d{1,2})?)\s*%?$/.exec(t);
    return m ? { value: Number(m[1].replace(',', '.')) } : { bad: true };
}

/** A stored number as it goes back in a box: never in exponent form ("0.0000001", not "1e-7"). */
const numText = (n) => (isNum(n) ? n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 }) : '');

/** Firestore Timestamp | {seconds} | ISO string | Date | ms → Date, or null. */
function toDate(v) {
    if (v == null) return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v.toDate === 'function') { try { return v.toDate(); } catch (e) { return null; } }
    if (typeof v === 'object' && isNum(v.seconds)) return new Date(v.seconds * 1000);
    if (typeof v === 'number') return new Date(v);
    const d = new Date(String(v));
    return isNaN(d) ? null : d;
}
const MS = (v) => { const d = toDate(v); return d ? d.getTime() : null; };

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mon 19 Oct 16:30", as the PDF and the email print it (cost_report.py fmt_when). */
function fmtWhen(v) {
    const d = toDate(v);
    if (!d) return '—';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${hh}:${mm}`;
}
const fmtNum = (n) => (isNum(n) ? String(Math.round(n * 100) / 100) : '—');

/** ["paul@blinddesigns.co.za", "russel@…"] → "Paul and Russel". */
function friendlyNames(addrs) {
    const names = list(addrs).map((a) => {
        const local = String(a).split('@')[0].replace(/[._-]+/g, ' ').trim();
        return local ? local.replace(/\b\w/g, (c) => c.toUpperCase()) : String(a);
    });
    if (names.length <= 1) return names[0] || '';
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

const emailLooksValid = (a) => /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(String(a).trim());
function emailDomain(a) {
    const s = String(a).trim();
    const at = s.lastIndexOf('@');
    return at < 0 ? '' : s.slice(at + 1).toLowerCase();
}
/** The PC only sends to catalog.defaults.allowedRecipientDomains (an empty list allows any domain). */
function addressAllowed(a) {
    const allowed = S.defaults.allowedRecipientDomains;
    return emailLooksValid(a) && (!allowed.length || allowed.includes(emailDomain(a)));
}
const domainsText = () => S.defaults.allowedRecipientDomains.map((d) => '@' + d).join(', ') || 'valid';

/** Time between two instants that falls on Mon–Fri (the report only runs on weekdays). */
function weekdayMsBetween(fromMs, toMs) {
    if (!(toMs > fromMs)) return 0;
    if (toMs - fromMs > 400 * 86400000) return toMs - fromMs;    // over a year: no need to be exact
    let total = 0;
    let cur = fromMs;
    while (cur < toMs) {
        const day = new Date(cur);
        const midnight = new Date(cur);
        midnight.setHours(24, 0, 0, 0);                          // the next local midnight
        const end = Math.min(midnight.getTime(), toMs);
        if (day.getDay() !== 0 && day.getDay() !== 6) total += end - cur;
        cur = end;
    }
    return total;
}

// ---- Send time and days ----------------------------------------------------

/** 'HH:MM' (24 h) -> minutes after midnight, or null. */
function minutesOf(t) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(typeof t === 'string' ? t.trim() : '');
    if (!m) return null;
    const hh = +m[1], mm = +m[2];
    return hh <= 23 && mm <= 59 ? hh * 60 + mm : null;
}
const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/** A list of day names, lower-case and in week order; null if empty or one isn't allowed (read as the PC reads it). */
function cleanDays(v, allowed) {
    const items = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;]/) : null;
    if (!items) return null;
    const keys = items.map((d) => String(d).trim().toLowerCase()).filter(Boolean).map((d) => d.slice(0, 3));
    if (!keys.length || keys.some((k) => !allowed.includes(k))) return null;
    return DAY_KEYS.filter((k) => keys.includes(k));
}

/** ['mon','tue','wed','thu','fri'] -> 'Mon–Fri'; ['mon','wed','fri'] -> 'Mon, Wed, Fri'. */
function daysText(days) {
    const idx = days.map((d) => DAY_KEYS.indexOf(d)).sort((a, b) => a - b);
    const run = idx.length > 2 && idx.every((v, i) => !i || v === idx[i - 1] + 1);
    return run ? `${DAY_LABELS[DAY_KEYS[idx[0]]]}–${DAY_LABELS[DAY_KEYS[idx[idx.length - 1]]]}`
        : idx.map((i) => DAY_LABELS[DAY_KEYS[i]]).join(', ');
}

/** The PC's schedule offer (catalog.defaults.schedule), checked; null when it offers none. */
function cleanSchedule(s) {
    s = obj(s);
    const from = minutesOf(s.earliest), to = minutesOf(s.latest), step = s.stepMinutes;
    const days = cleanDays(s.days, DAY_KEYS);
    if (from == null || to == null || from > to || !Number.isInteger(step) || step < 5 || step > 60 || !days) return null;
    return { earliest: from, latest: to, step, days };
}

/** The send time and days in force: the saved ones when the PC would accept them, else its defaults. */
function activeSchedule() {
    const st = obj(S.settings);
    const sch = S.defaults.schedule;
    const t = sch ? minutesOf(st.reportTime) : null;
    const time = t != null && t >= sch.earliest && t <= sch.latest ? hhmm(t) : S.defaults.reportTime;
    const days = (sch && cleanDays(st.reportDays, sch.days)) || S.defaults.reportDays;
    return { time, days };
}

/** '16:30' while the PC offers no schedule; '16:00 on Mon–Fri' once it does. */
function scheduleText() {
    if (!S.defaults.schedule) return S.defaults.reportTime || '16:30';
    const a = activeSchedule();
    return `${a.time} on ${daysText(a.days)}`;
}

/** The latest send slot (a send day at the send time) at least an hour old, or null. */
function lastDueSlot(nowMs) {
    const a = activeSchedule();
    const mins = minutesOf(a.time);
    if (mins == null || !a.days.length) return null;
    for (let back = 0; back <= 14; back++) {
        const d = new Date(nowMs);
        d.setDate(d.getDate() - back);
        d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
        const key = DAY_KEYS[(d.getDay() + 6) % 7];              // getDay(): 0 = Sunday
        if (a.days.includes(key) && d.getTime() + MISSED_GRACE_MS <= nowMs) return d.getTime();
    }
    return null;
}

/** A Firestore error in words someone can act on. */
function explain(e) {
    const code = String((e && e.code) || '');
    const msg = String((e && e.message) || e || '');
    if (/permission/i.test(code + ' ' + msg)) return 'Firestore refused access to orderbot_cost_report (permission denied).';
    if (/unavailable/i.test(code)) return 'Firestore could not be reached (offline?).';
    return msg || 'unknown error';
}

// --------------------------------------------------------------------------
// Switches (the app has no switch component, so this module ships its own)
// --------------------------------------------------------------------------

function makeSwitch(on, label, onChange) {
    const btn = h('button', {
        type: 'button', class: 'cr-switch', role: 'switch',
        'aria-checked': on ? 'true' : 'false', 'aria-label': label,
    });
    btn.addEventListener('click', () => {
        const next = btn.getAttribute('aria-checked') !== 'true';
        btn.setAttribute('aria-checked', next ? 'true' : 'false');
        if (onChange) onChange(next);
    });
    return btn;
}
const isOn = (sw) => sw.getAttribute('aria-checked') === 'true';
const setOn = (sw, on) => sw.setAttribute('aria-checked', on ? 'true' : 'false');

// --------------------------------------------------------------------------
// Module state
// --------------------------------------------------------------------------

let D = null;                     // injected deps
const S = {
    root: null,                   // #cost-report-view
    pill: null,                   // #nav-cost-report
    initialised: false,
    started: false,
    latestCatalog: undefined,     // newest `catalog` (undefined = not read yet, null = none published)
    catalog: {},                  // the catalog the form was built from
    settings: undefined,          // the saved `settings` the form knows (undefined = not read yet, null = none)
    defaults: FALLBACK_DEFAULTS,
    baseline: null,               // {exists, ms, by}: the saved version the form was loaded from
    conflict: null,               // a newer version someone else saved since then
    adoptNextEcho: false,         // our save went through but its timestamp could not be read back
    status: undefined,            // newest `status` (undefined = not read yet, null = none)
    seeded: false,
    writing: false,               // our own save or reset is in flight: its echo is not a conflict
    loadError: null,
    lastWritten: null,            // the settings we last saved, to recognise our own write when read back
    toList: [],
    ccList: [],
    view: { blind: { q: '', retired: false }, sundry: { q: '', retired: false } },   // kept across rebuilds
    ui: {},
};

// --------------------------------------------------------------------------
// Entry point and lifecycle
// --------------------------------------------------------------------------

/**
 * @param {object} deps - { db, doc, getDoc, setDoc, deleteDoc, onSnapshot,
 *   serverTimestamp, showToast, showConfirmModal, isAdmin }
 */
export function initCostReportConsole(deps) {
    try {
        D = deps || {};
        S.root = byId('cost-report-view');
        S.pill = byId('nav-cost-report');
        if (!S.root || S.initialised) return;
        if (!(typeof D.isAdmin === 'function' && D.isAdmin())) return;   // capturers never see this view
        S.initialised = true;
        injectStyles();
        buildScaffold();
        if (S.pill) {
            S.pill.classList.remove('hidden');
            S.pill.addEventListener('click', start);   // Firestore is only read once the page is opened
        }
    } catch (e) {
        // An optional admin page must never stop the rest of OrderBot from starting.
        console.error('Cost report console could not start', e);
    }
}

function start() {
    if (S.started) return;
    S.started = true;
    try {
        S.root.addEventListener('input', scheduleDirtyCheck);
        S.root.addEventListener('change', scheduleDirtyCheck);  // the send-time list
        S.root.addEventListener('click', scheduleDirtyCheck);
        window.addEventListener('beforeunload', onBeforeUnload);
        setInterval(() => { if (S.status) renderStatus(S.status); }, STATUS_RECHECK_MS);
        subscribe();
    } catch (e) {
        showLoadError(e);
    }
}

// --------------------------------------------------------------------------
// Firestore
// --------------------------------------------------------------------------

const ref = (id) => D.doc(D.db, COLLECTION, id);
const exists = (snap) => !!(snap && typeof snap.exists === 'function' && snap.exists());
const dataOf = (snap) => (exists(snap) ? snap.data() : null);

function subscribe() {
    // status + catalog are the PC's: watched live, never written here.
    D.onSnapshot(ref('status'), (snap) => { S.status = dataOf(snap); renderStatus(S.status); },
        (err) => renderStatusError(err));
    D.onSnapshot(ref('catalog'), (snap) => onCatalog(dataOf(snap)), showLoadError);
    // settings is this page's: seeds the form, then only signals someone else's save.
    D.onSnapshot(ref('settings'), (snap) => onSettings(dataOf(snap)), showLoadError);
}

function onCatalog(cat) {
    S.latestCatalog = cat;
    if (!S.seeded) {
        if (!cat) renderWaiting();
        maybeSeed();
        return;
    }
    // The PC republishes the lists after every run. Refresh the form unless it is being
    // edited; then the new lists appear on the next save, discard or reload.
    if (cat && !S.writing && !isDirty()) build();
}

function onSettings(data) {
    const incoming = versionOf(data);
    if (!S.seeded) {
        S.settings = data;
        S.baseline = incoming;
        maybeSeed();
        return;
    }
    if (S.writing) return;                                       // our own save or reset echoing back
    if (S.adoptNextEcho) {
        S.adoptNextEcho = false;
        if (isOurs(data)) { S.baseline = incoming; return; }
    }
    S.conflict = sameVersion(incoming, S.baseline) ? null : incoming;
    renderConflict();
}

function versionOf(d) {
    return d ? { exists: true, ms: MS(d.updatedAt), by: d.updatedBy ? String(d.updatedBy) : '' }
        : { exists: false, ms: null, by: '' };
}
const sameVersion = (a, b) => !!a && !!b && a.exists === b.exists && a.ms === b.ms;

/** The saved settings as Firestore has them now: { data } (data null when none), or null if unreadable. */
async function readSaved() {
    try { return { data: dataOf(await D.getDoc(ref('settings'))) }; } catch (e) { return null; }
}

/** Is this saved document the one we wrote (same content, whatever its timestamp)? */
function isOurs(data) {
    if (!data || !S.lastWritten) return false;
    const strip = (d) => { const c = Object.assign({}, d); delete c.updatedAt; return c; };
    return canon(strip(data)) === canon(strip(S.lastWritten));
}

/** Build the form once both the catalog (its structure) and the settings (its values) are in. */
function maybeSeed() {
    if (S.seeded || S.loadError || !S.latestCatalog || S.settings === undefined) return;
    S.seeded = true;
    build();
}

// --------------------------------------------------------------------------
// Scaffold, waiting and error states
// --------------------------------------------------------------------------

function buildScaffold() {
    clear(S.root);
    S.root.setAttribute('aria-label', 'Cost report settings');
    S.root.appendChild(h('div', { class: 'cr-stack' }, [
        h('div', { class: 'cr-head' }, [
            h('p', { class: 'bd-overline', text: 'Daily Cost Report — settings' }),
            h('span', { class: 'cr-muted cr-small', text: 'Admin only · the office PC reads these at every run' }),
        ]),
        h('div', { id: 'cr-status', class: 'bd-card cr-panel' }),
        h('div', { id: 'cr-body' }, h('div', { class: 'bd-card cr-panel' }, muted('Loading the settings…'))),
    ]));
    renderStatus(undefined);
}

function renderWaiting() {
    const body = byId('cr-body');
    if (!body || S.seeded || S.loadError) return;
    clear(body);
    body.appendChild(h('div', { class: 'bd-card cr-panel' }, [
        h('p', { class: 'bd-overline', text: 'Waiting for the office PC' }),
        h('p', { class: 'cr-help', text: 'The office PC publishes its product lists here after each report run. To publish '
            + 'them now, run "python cost_report.py --publish-catalog" on the office PC (with [orderbot] enabled = yes '
            + 'in config.ini).' }),
    ]));
}

function showLoadError(err) {
    console.error('Cost report console:', err);
    if (S.seeded) {                                              // keep the form and any unsaved edits
        if (D && D.showToast) D.showToast('Lost the link to the cost report settings: ' + explain(err), 'error');
        return;
    }
    S.loadError = err || true;
    const body = byId('cr-body');
    if (!body) return;
    clear(body);
    body.appendChild(h('div', { class: 'bd-card cr-panel cr-error' }, [
        h('p', { class: 'bd-overline', text: 'Could not load the settings' }),
        h('p', { class: 'cr-line', text: explain(err) }),
        h('p', { class: 'cr-help', text: 'If access was refused, the Firestore rules must let OrderBot read and write '
            + 'orderbot_cost_report/{doc}, like the other orderbot_* collections. Reload the page once that is fixed.' }),
    ]));
}

// --------------------------------------------------------------------------
// The form
// --------------------------------------------------------------------------

function build() {
    const body = byId('cr-body');
    if (!body) return;
    S.catalog = S.latestCatalog || S.catalog || {};
    S.defaults = mergeDefaults(S.catalog.defaults);
    const m = seedModel();
    S.toList = m.to.slice();
    S.ccList = m.cc.slice();
    S.ui = {};
    clear(body);
    [sectionLimits(m), sectionOrderTypes(m), sectionProductTypes(m), sectionReportContent(m),
        S.defaults.schedule ? sectionSchedule(m) : null,
        sectionRecipients(m), conflictBanner(), sectionActions()].forEach((el) => { if (el) body.appendChild(el); });
    renderConflict();
    updateDirtyUI();
    if (S.status !== undefined) renderStatus(S.status);          // the schedule it shows comes from these settings
}

/** The PC's defaults (catalog.defaults) over the built-in fallback, each field checked. */
function mergeDefaults(d) {
    d = obj(d);
    const f = FALLBACK_DEFAULTS;
    const rec = obj(d.recipients);
    const strs = (v, fb) => (Array.isArray(v) ? v.map(String) : fb.slice());
    return {
        costThresholdPct: num(d.costThresholdPct, f.costThresholdPct),
        discountMarginPts: num(d.discountMarginPts, f.discountMarginPts),
        orderTypes: Object.assign({}, obj(d.orderTypes)),
        sections: Object.assign({}, f.sections, obj(d.sections)),
        details: Object.assign({}, f.details, obj(d.details)),
        recipients: { to: strs(rec.to, f.recipients.to), cc: strs(rec.cc, f.recipients.cc) },
        sendWhenNothingFlagged: typeof d.sendWhenNothingFlagged === 'boolean' ? d.sendWhenNothingFlagged : f.sendWhenNothingFlagged,
        allowedRecipientDomains: strs(d.allowedRecipientDomains, f.allowedRecipientDomains)
            .map((x) => x.trim().toLowerCase().replace(/^@/, '')).filter(Boolean),
        reportTime: minutesOf(d.reportTime) != null ? hhmm(minutesOf(d.reportTime)) : f.reportTime,
        reportDays: cleanDays(d.reportDays, DAY_KEYS) || f.reportDays.slice(),
        schedule: cleanSchedule(d.schedule),
    };
}

function panel(overline, title, children) {
    return h('section', { class: 'bd-card cr-panel' }, [
        h('p', { class: 'bd-overline', text: overline }),
        h('h3', { class: 'bd-panel-title cr-title', text: title }),
    ].concat(children));
}

// ---- Limits (spec §2) -----------------------------------------------------

function sectionLimits(m) {
    const def = S.defaults;
    S.ui.cost = numberInput('cr-cost', m.costThresholdPct);
    S.ui.disc = numberInput('cr-disc', m.discountMarginPts);
    return panel('Limits', 'What gets flagged', [
        limitRow('cr-cost', 'Material cost limit',
            'Flag an order when its material cost is above this share of its net value.',
            S.ui.cost, '%', `default ${fmtNum(def.costThresholdPct)}%`),
        limitRow('cr-disc', 'Discount margin',
            "Flag when a line, or the whole order, is discounted more than this many points above the customer's discount rating.",
            S.ui.disc, 'pts', `default ${fmtNum(def.discountMarginPts)} pts`),
    ]);
}

function numberInput(id, value) {
    const input = h('input', { id, type: 'text', class: 'cr-num', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false' });
    input.value = numText(value);
    return input;
}

function limitRow(id, label, help, input, unit, defaultText) {
    return h('div', { class: 'cr-limit' }, [
        h('div', { class: 'cr-limit-text' }, [h('label', { class: 'cr-label', for: id, text: label }), h('p', { class: 'cr-help', text: help })]),
        h('div', { class: 'cr-limit-input' }, [input, h('span', { class: 'cr-unit', text: unit }), h('span', { class: 'cr-muted', text: defaultText })]),
    ]);
}

// ---- Order types (spec §3) ------------------------------------------------

function sectionOrderTypes(m) {
    S.ui.orderRadios = {};
    const rows = sortByUsed(S.catalog.orderTypes);
    const wrap = h('div');
    rows.forEach((t) => {
        const id = String(t.id);
        const name = typeName(t, 'Order type');
        const radios = ORDER_MODES.map(([mode]) => {
            const r = h('input', { type: 'radio', name: `cr-ot-${id}`, value: mode });
            r.checked = m.orderTypes[id] === mode;
            return r;
        });
        S.ui.orderRadios[id] = radios;
        wrap.appendChild(h('div', { class: 'cr-row', role: 'radiogroup', 'aria-label': name }, [
            nameCell(name, usedLabel(t)),
            h('div', { class: 'cr-radios' }, radios.map((r, i) => h('label', { class: 'cr-radio' }, [r, h('span', { text: ORDER_MODES[i][1] })]))),
        ]));
    });
    if (!rows.length) wrap.appendChild(muted('No order types published yet.'));
    return panel('Order types', 'Which orders to check', [
        h('p', { class: 'cr-help cr-lead', text: 'Check runs both tests. List separately puts the order in the error & showroom '
            + 'list with its material cost. Ignore leaves it out (it is counted in a footnote).' }),
        wrap,
    ]);
}

// ---- Product types (spec §4) ----------------------------------------------

function sectionProductTypes(m) {
    const blind = typeTable('blind', 'Blind types', S.catalog.blindTypes, m.blindTypes);
    const sundry = typeTable('sundry', 'Sundry types', S.catalog.sundryTypes, m.sundryTypes);
    S.ui.blindTable = blind.rows;
    S.ui.sundryTable = sundry.rows;
    return panel('Product types', 'Include or exclude product types', [
        h('p', { class: 'cr-help cr-lead', text: 'Switched-off types are left out of each order’s value and cost; an order left '
            + 'with nothing is skipped. An own limit replaces the overall cost limit for that type, and an order that mixes '
            + 'types gets the value-weighted blend of their limits.' }),
        blind.el,
        sundry.el,
    ]);
}

/** One searchable table of blind or sundry types. Returns { el, rows } (rows feed collectModel). */
function typeTable(kind, heading, catalogRows, model) {
    const rows = sortByUsed(catalogRows);
    const retiredCount = rows.filter((t) => t.hidden).length;
    const items = [];
    const listEl = h('div', { class: 'cr-typelist' });
    rows.forEach((t) => {
        const id = String(t.id);
        const name = typeName(t, kind === 'blind' ? 'Blind type' : 'Sundry type');
        const e = model[id] || { include: true, limitPct: null };
        const lim = h('input', {
            type: 'text', class: 'cr-num cr-limitpct', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
            placeholder: '—', 'aria-label': `Own cost limit % for ${name}`,
        });
        lim.value = numText(e.limitPct);
        lim.disabled = !e.include;                               // kept, but not used while switched off
        const sw = makeSwitch(e.include, `Include ${name}`, (on) => { lim.disabled = !on; });
        const el = h('div', { class: 'cr-row' + (t.hidden ? ' cr-retired' : '') }, [
            nameCell(name, usedLabel(t) + (t.hidden ? ' · retired' : '')),
            h('div', { class: 'cr-typectrls' }, [
                h('label', { class: 'cr-inline' }, [h('span', { class: 'cr-muted', text: 'Own limit' }), lim, h('span', { class: 'cr-unit', text: '%' })]),
                h('span', { class: 'cr-inline' }, [h('span', { class: 'cr-muted', text: 'Include' }), sw]),
            ]),
        ]);
        listEl.appendChild(el);
        items.push({ id, name, el, sw, lim, retired: !!t.hidden, find: name.toLowerCase() });
    });
    if (!rows.length) listEl.appendChild(muted('None published yet.'));

    const view = S.view[kind] || (S.view[kind] = { q: '', retired: false });   // survives a rebuild
    const search = h('input', {
        type: 'search', class: 'cr-input cr-search', placeholder: `Search ${rows.length} ${kind} types…`,
        'aria-label': `Search ${heading.toLowerCase()}`,
    });
    search.value = view.q;
    const retiredBtn = retiredCount ? h('button', { type: 'button', class: 'cr-link' }) : null;
    const filter = () => {
        view.q = search.value;
        const q = search.value.trim().toLowerCase();
        items.forEach((it) => {
            it.el.style.display = (!q || it.find.includes(q)) && (!it.retired || view.retired) ? '' : 'none';
        });
        if (retiredBtn) retiredBtn.textContent = `${view.retired ? 'Hide' : 'Show'} ${retiredCount} retired`;
    };
    search.addEventListener('input', filter);
    if (retiredBtn) retiredBtn.addEventListener('click', () => { view.retired = !view.retired; filter(); });
    // Bring a row the search or the retired toggle is hiding back into view (e.g. to show an error).
    items.forEach((it) => {
        it.reveal = () => {
            if (it.el.style.display !== 'none') return;
            search.value = '';
            if (it.retired) view.retired = true;
            filter();
        };
    });
    // "All on" / "Switch all off" act on the rows the search is showing (spec §4).
    const setShown = (on) => items.forEach((it) => {
        if (it.el.style.display !== 'none') { setOn(it.sw, on); it.lim.disabled = !on; }
    });
    filter();

    const el = h('div', { class: 'cr-typeblock' }, [
        h('div', { class: 'cr-typehead' }, [
            h('h4', { class: 'cr-subtitle', text: heading }),
            h('div', { class: 'cr-typetools' }, [
                search,
                h('button', { type: 'button', class: 'cr-chipbtn', text: 'All on', onclick: () => setShown(true) }),
                h('button', { type: 'button', class: 'cr-chipbtn', text: 'Switch all off', onclick: () => setShown(false) }),
                retiredBtn,
            ]),
        ]),
        listEl,
    ]);
    return { el, rows: items };
}

// ---- Report content (spec §5) ---------------------------------------------

function sectionReportContent(m) {
    S.ui.sections = {};
    S.ui.details = {};
    const row = (key, label, on, store) => {
        const sw = makeSwitch(on, label);
        store[key] = sw;
        return h('div', { class: 'cr-row' }, [h('span', { class: 'cr-row-name', text: label }), sw]);
    };
    return panel('Report content', 'What the report shows', [
        h('h4', { class: 'cr-subtitle', text: 'Sections' }),
        h('div', { class: 'cr-togglegrid' }, SECTION_FIELDS.map(([k, label]) => row(k, label, m.sections[k], S.ui.sections))),
        h('h4', { class: 'cr-subtitle cr-gap', text: 'Details in the order blocks and summary' }),
        h('div', { class: 'cr-togglegrid' }, DETAIL_FIELDS.map(([k, label]) => row(k, label, m.details[k], S.ui.details))),
        h('p', { class: 'cr-help', text: 'Fabric-only notes and own-limit notes always show, because they explain the numbers. '
            + 'With “Captured by” off, the summary shows the rep instead (if “Rep” is on).' }),
    ]);
}

// ---- Schedule: send time and days (shown once the PC offers it) -----------

function sectionSchedule(m) {
    const sch = S.defaults.schedule;
    const def = S.defaults;
    const times = [];
    for (let t = sch.earliest; t <= sch.latest; t += sch.step) times.push(hhmm(t));
    if (!times.includes(m.reportTime)) { times.push(m.reportTime); times.sort(); }   // a saved time off the list stays
    S.ui.time = h('select', { id: 'cr-time', class: 'cr-input cr-time' }, times.map((t) => h('option', { value: t, text: t })));
    S.ui.time.value = m.reportTime;
    S.ui.days = {};
    const boxes = sch.days.map((k) => {
        const cb = h('input', { type: 'checkbox', value: k });
        cb.checked = m.reportDays.includes(k);
        S.ui.days[k] = cb;
        return h('label', { class: 'cr-radio' }, [cb, h('span', { text: DAY_LABELS[k] })]);
    });
    return panel('Schedule', 'When the report is sent', [
        limitRow('cr-time', 'Send at', `The office PC checks every ${sch.step} minutes and sends the report at its first check `
            + 'after this time, once a day.', S.ui.time, '', `default ${def.reportTime}`),
        h('div', { class: 'cr-limit' }, [
            h('div', { class: 'cr-limit-text' }, [
                h('span', { class: 'cr-label', text: 'On these days' }),
                h('p', { class: 'cr-help', text: 'Each report covers every order since the one before, so orders from the other '
                    + 'days go in the next report.' }),
            ]),
            h('div', { class: 'cr-limit-input cr-days', role: 'group', 'aria-label': 'Send days' },
                boxes.concat(h('span', { class: 'cr-muted', text: `default ${daysText(def.reportDays)}` }))),
        ]),
    ]);
}

// ---- Recipients (spec §6) -------------------------------------------------

function sectionRecipients(m) {
    const def = S.defaults;
    const example = 'name@' + (def.allowedRecipientDomains[0] || 'blinddesigns.co.za');
    S.ui.toEmpty = def.recipients.to.length
        ? `Empty — the PC will use its own list: ${def.recipients.to.join(', ')}.`
        : 'Empty — the PC will use its own list.';
    S.ui.toChips = h('div', { class: 'cr-chips' });
    S.ui.ccChips = h('div', { class: 'cr-chips' });
    S.ui.toInput = h('input', { id: 'cr-to', type: 'text', class: 'cr-input', inputmode: 'email', autocomplete: 'off', placeholder: example });
    S.ui.ccInput = h('input', { id: 'cr-cc', type: 'text', class: 'cr-input', inputmode: 'email', autocomplete: 'off', placeholder: example });
    const onEnter = (which) => (e) => { if (e.key === 'Enter') { e.preventDefault(); addAddresses(which); } };
    S.ui.toInput.addEventListener('keydown', onEnter('to'));
    S.ui.ccInput.addEventListener('keydown', onEnter('cc'));
    renderChips('to');
    renderChips('cc');
    S.ui.sendEmpty = makeSwitch(m.sendWhenNothingFlagged, 'Send even when nothing is flagged');
    return panel('Recipients', 'Who gets the report', [
        h('p', { class: 'cr-help cr-lead', text: `Only ${domainsText()} addresses. Separate several with commas.` }),
        h('label', { class: 'cr-label', for: 'cr-to', text: 'To' }),
        S.ui.toChips,
        h('div', { class: 'cr-addrow' }, [S.ui.toInput, h('button', { type: 'button', class: 'cr-chipbtn', text: 'Add', onclick: () => addAddresses('to') })]),
        h('label', { class: 'cr-label cr-gap', for: 'cr-cc', text: 'Cc' }),
        S.ui.ccChips,
        h('div', { class: 'cr-addrow' }, [S.ui.ccInput, h('button', { type: 'button', class: 'cr-chipbtn', text: 'Add', onclick: () => addAddresses('cc') })]),
        h('div', { class: 'cr-row cr-gap' }, [h('span', { class: 'cr-row-name', text: 'Send even when nothing is flagged' }), S.ui.sendEmpty]),
        // cost_report.py still sends when there are error or showroom orders, even with this off.
        h('p', { class: 'cr-help', text: 'When this is off, the email is skipped only on days with nothing flagged and no '
            + 'error or showroom orders.' }),
    ]);
}

const recipientList = (which) => (which === 'to' ? S.toList : S.ccList);

/** Add what was typed in the To or Cc box (several allowed). Returns false if anything is refused. */
function addAddresses(which) {
    const input = which === 'to' ? S.ui.toInput : S.ui.ccInput;
    const target = recipientList(which);
    const parts = input.value.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) { input.value = ''; return true; }
    const bad = parts.find((a) => !emailLooksValid(a));
    if (bad) { D.showToast(`“${bad}” doesn’t look like an email address.`, 'error'); input.focus(); return false; }
    const outside = parts.find((a) => !addressAllowed(a));
    if (outside) { D.showToast(`Only ${domainsText()} addresses are allowed (“${outside}”).`, 'error'); input.focus(); return false; }
    parts.forEach((a) => { if (!target.some((x) => x.toLowerCase() === a.toLowerCase())) target.push(a); });
    input.value = '';
    renderChips(which);
    scheduleDirtyCheck();
    return true;
}

function renderChips(which) {
    const container = which === 'to' ? S.ui.toChips : S.ui.ccChips;
    const items = recipientList(which);
    clear(container);
    if (!items.length) {
        container.appendChild(h('span', { class: 'cr-muted', text: which === 'to' ? S.ui.toEmpty : 'none' }));
        return;
    }
    items.forEach((a, i) => {
        const refused = !addressAllowed(a);
        const remove = h('button', { type: 'button', 'aria-label': `Remove ${a}`, text: '✕' });
        remove.addEventListener('click', () => { items.splice(i, 1); renderChips(which); scheduleDirtyCheck(); });
        container.appendChild(h('span', {
            class: 'cr-chip' + (refused ? ' cr-chip-bad' : ''),
            title: refused ? `The PC only sends to ${domainsText()} addresses, so it will ignore this one.` : null,
        }, [h('span', { text: a }), remove]));
    });
}

// ---- Save / Discard / Reset (spec §7) -------------------------------------

function sectionActions() {
    let name = '';
    try { name = localStorage.getItem(NAME_KEY) || ''; } catch (e) { /* storage blocked */ }
    S.ui.name = h('input', { id: 'cr-name', type: 'text', class: 'cr-input cr-name', autocomplete: 'name' });
    S.ui.name.value = name || 'Paul';
    S.ui.name.addEventListener('change', rememberName);
    S.ui.dirty = h('span', { class: 'cr-dirty', role: 'status', 'aria-live': 'polite' });
    S.ui.save = h('button', { type: 'button', class: 'bd-btn-primary py-2 px-6', text: 'Save', onclick: onSave });
    S.ui.discard = h('button', { type: 'button', class: 'bd-btn-secondary py-2 px-5', text: 'Discard changes', onclick: onDiscard });
    S.ui.reset = h('button', { type: 'button', class: 'bd-btn-secondary py-2 px-5', text: 'Reset to defaults', onclick: onReset });
    return h('div', { class: 'bd-card cr-actions' }, [
        h('div', { class: 'cr-saveas' }, [h('label', { class: 'cr-muted', for: 'cr-name', text: 'Saving as' }), S.ui.name]),
        h('div', { class: 'cr-actionbtns' }, [S.ui.dirty, S.ui.discard, S.ui.reset, S.ui.save]),
    ]);
}

/** updatedBy: asked once and kept in localStorage (cr_name); "Paul" by default (spec). */
function rememberName() {
    const who = ((S.ui.name && S.ui.name.value) || '').trim() || 'Paul';
    try { localStorage.setItem(NAME_KEY, who); } catch (e) { /* storage blocked: still used for this save */ }
    return who;
}

function setBusy(on) {
    [S.ui.save, S.ui.discard, S.ui.reset].forEach((b) => { if (b) b.disabled = on; });
    if (S.ui.save) S.ui.save.textContent = on ? 'Saving…' : 'Save';
}

async function onSave() {
    if (S.writing || !S.seeded) return;
    if (!addAddresses('to') || !addAddresses('cc')) return;      // an address typed but not added yet
    const refused = S.toList.concat(S.ccList).filter((a) => !addressAllowed(a));
    if (refused.length) {
        D.showToast(`Remove ${refused.join(', ')} first: the PC only sends to ${domainsText()} addresses.`, 'error');
        return;
    }
    const read = collectModel();
    if (read.error) {
        D.showToast(read.error, 'error');
        if (read.reveal) read.reveal();                          // a row hidden by the search or retired toggle
        if (read.focus) read.focus.focus();
        return;
    }
    const doc = toSettingsDoc(read.model);
    // Someone else may have saved since this form was loaded: say so before overwriting (spec §7).
    const saved = await readSaved();
    const now = saved && versionOf(saved.data);
    if (now && !sameVersion(now, S.baseline)) {
        if (isOurs(saved.data)) {
            S.baseline = now;                                    // our own last save, read back late: not a conflict
            S.adoptNextEcho = false;
        } else {
            S.conflict = now;
            renderConflict();
            D.showConfirmModal(`${describeVersion(now)} Replace their version with yours? `
                + '(Cancel keeps theirs; then use “Load the latest” to see it.)', () => { write(doc); });
            return;
        }
    }
    await write(doc);
}

async function write(doc) {
    if (S.writing) return;
    S.writing = true;
    setBusy(true);
    const slow = setTimeout(slowNotice, SLOW_SAVE_MS);
    try {
        const payload = Object.assign({}, doc, { updatedAt: D.serverTimestamp(), updatedBy: rememberName() });
        S.lastWritten = Object.assign({}, payload, { updatedAt: null });
        await D.setDoc(ref('settings'), payload);
        S.settings = S.lastWritten;
        // Read it back for its server timestamp. If what Firestore holds is not what we wrote,
        // someone else saved straight after us: show the banner instead of adopting theirs.
        const back = await readSaved();
        S.conflict = null;
        if (!back) S.adoptNextEcho = true;
        else if (isOurs(back.data)) S.baseline = versionOf(back.data);
        else { S.baseline = { exists: true, ms: null, by: '' }; S.conflict = versionOf(back.data); }
        if (S.latestCatalog && S.latestCatalog !== S.catalog) build();   // the PC published new lists meanwhile
        else {
            renderConflict();
            updateDirtyUI();
            if (S.status !== undefined) renderStatus(S.status);  // shows the send time just saved
        }
        D.showToast(`Saved. Applies from the next report (${scheduleText()}).`, 'success');
    } catch (e) {
        D.showToast('Could not save: ' + explain(e), 'error');
    } finally {
        clearTimeout(slow);
        S.writing = false;
        setBusy(false);
    }
}

/** Firestore keeps an offline write and sends it later, so a save can wait a long time. */
function slowNotice() {
    if (S.writing) D.showToast('Still saving… Check the connection: the change is sent as soon as OrderBot is back online.', 'info');
}

function onReset() {
    if (S.writing || !S.seeded) return;
    D.showConfirmModal('Reset every setting to the report’s defaults? This deletes the saved choices; the office PC '
        + 'uses its own defaults from the next report.', async () => {
        if (S.writing) return;
        S.writing = true;
        setBusy(true);
        const slow = setTimeout(slowNotice, SLOW_SAVE_MS);
        try {
            await D.deleteDoc(ref('settings'));
            S.settings = null;
            S.lastWritten = null;
            S.baseline = versionOf(null);
            S.conflict = null;
            build();
            D.showToast(`Reset to the defaults. Applies from the next report (${scheduleText()}).`, 'success');
        } catch (e) {
            D.showToast('Could not reset the settings: ' + explain(e), 'error');
        } finally {
            clearTimeout(slow);
            S.writing = false;
            setBusy(false);
        }
    });
}

function onDiscard() {
    if (!isDirty()) { D.showToast('There are no unsaved changes.', 'info'); return; }
    D.showConfirmModal('Discard your changes and go back to the saved settings?', () => build());
}

/** Replace the form with the newest saved settings (after someone else saved). */
function loadLatest() {
    const load = async () => {
        try {
            const data = dataOf(await D.getDoc(ref('settings')));
            S.settings = data;
            S.baseline = versionOf(data);
            S.conflict = null;
            build();
            D.showToast('Loaded the latest saved settings.', 'info');
        } catch (e) {
            D.showToast('Could not load the settings: ' + explain(e), 'error');
        }
    };
    if (isDirty()) D.showConfirmModal('Discard your unsaved changes and load the latest saved settings?', load);
    else load();
}

// ---- Someone else saved (spec §7) -----------------------------------------

function conflictBanner() {
    S.ui.conflictText = h('span');
    S.ui.conflict = h('div', { class: 'cr-banner hidden', role: 'alert' }, [
        S.ui.conflictText,
        h('button', { type: 'button', class: 'bd-btn-secondary py-1 px-4', text: 'Load the latest', onclick: loadLatest }),
    ]);
    return S.ui.conflict;
}

function renderConflict() {
    if (!S.ui.conflict) return;
    S.ui.conflict.classList.toggle('hidden', !S.conflict);
    if (S.conflict) S.ui.conflictText.textContent = `${describeVersion(S.conflict)} Load the latest to see it before you save over it.`;
}

function describeVersion(v) {
    if (!v.exists) return 'Someone reset these settings to the defaults after you opened this page.';
    return `${v.by || 'Someone'} saved these settings${v.ms ? ' on ' + fmtWhen(v.ms) : ''}, after you opened this page.`;
}

// --------------------------------------------------------------------------
// Model: form <-> settings document
// --------------------------------------------------------------------------

/** The settings the form starts from: the saved document with the PC's defaults filled in. */
function seedModel() {
    const st = obj(S.settings);
    const def = S.defaults;
    const savedOT = obj(st.orderTypes);
    const sec = obj(st.sections);
    const det = obj(st.details);
    const rec = obj(st.recipients);
    const m = {
        costThresholdPct: num(st.costThresholdPct, def.costThresholdPct),
        discountMarginPts: num(st.discountMarginPts, def.discountMarginPts),
        orderTypes: {},
        blindTypes: seedTypes(S.catalog.blindTypes, obj(st.blindTypes)),
        sundryTypes: seedTypes(S.catalog.sundryTypes, obj(st.sundryTypes)),
        sections: {},
        details: {},
        // A missing or empty To means "the PC's own list"; Cc is used exactly as saved.
        to: Array.isArray(rec.to) && rec.to.length ? rec.to.map(String) : def.recipients.to.slice(),
        cc: Array.isArray(rec.cc) ? rec.cc.map(String) : def.recipients.cc.slice(),
        sendWhenNothingFlagged: st.sendWhenNothingFlagged != null ? !!st.sendWhenNothingFlagged : def.sendWhenNothingFlagged,
    };
    sortByUsed(S.catalog.orderTypes).forEach((t) => {
        const id = String(t.id);
        m.orderTypes[id] = MODE_KEYS.includes(savedOT[id]) ? savedOT[id]
            : MODE_KEYS.includes(def.orderTypes[id]) ? def.orderTypes[id] : 'ignore';
    });
    SECTION_FIELDS.forEach(([k]) => { m.sections[k] = sec[k] != null ? !!sec[k] : !!def.sections[k]; });
    DETAIL_FIELDS.forEach(([k]) => { m.details[k] = det[k] != null ? !!det[k] : !!def.details[k]; });
    if (def.schedule) {
        const a = activeSchedule();
        m.reportTime = a.time;
        m.reportDays = a.days.slice();
    }
    return m;
}

/** Per type: switched on unless saved off (as the PC reads it), with its own limit if it has one. */
function seedTypes(rows, saved) {
    const out = {};
    sortByUsed(rows).forEach((t) => {
        const id = String(t.id);
        const e = obj(saved[id]);
        const include = 'include' in e ? !!e.include : true;
        const limit = num(e.limitPct, null);
        // A switched-off type keeps a valid limit for when it is switched back on; an invalid one is dropped.
        out[id] = { include, limitPct: include || validLimit(limit) ? limit : null };
    });
    return out;
}

/** Read the form. Returns { model } or { error, focus }. */
function collectModel() {
    const ui = S.ui;
    const cost = readNumber(ui.cost).value;
    if (!(cost >= 1 && cost <= 100)) return { error: 'The cost limit must be a number from 1 to 100, like 60 or 62.5.', focus: ui.cost };
    const disc = readNumber(ui.disc).value;
    if (!(disc >= 0 && disc <= 100)) return { error: 'The discount margin must be a number from 0 to 100, like 5 or 5.5.', focus: ui.disc };
    const m = {
        costThresholdPct: cost,
        discountMarginPts: disc,
        orderTypes: {},
        blindTypes: {},
        sundryTypes: {},
        sections: {},
        details: {},
        to: S.toList.length ? S.toList.slice() : S.defaults.recipients.to.slice(),
        cc: S.ccList.slice(),
        sendWhenNothingFlagged: isOn(ui.sendEmpty),
    };
    for (const id in ui.orderRadios) {
        const picked = ui.orderRadios[id].find((r) => r.checked);
        m.orderTypes[id] = picked ? picked.value : 'ignore';
    }
    for (const [key, rows] of [['blindTypes', ui.blindTable], ['sundryTypes', ui.sundryTable]]) {
        for (const r of rows) {
            const include = isOn(r.sw);
            const typed = readNumber(r.lim);
            let limitPct = typed.blank ? null : typed.value;
            if (typed.bad || (limitPct != null && !validLimit(limitPct))) {
                if (include) {
                    return { error: `The own limit for ${r.name} must be a number from 1 to 100, or blank.`, focus: r.lim, reveal: r.reveal };
                }
                limitPct = null;                                 // switched off: a bad limit is simply dropped
            }
            m[key][r.id] = { include, limitPct };
        }
    }
    SECTION_FIELDS.forEach(([k]) => { m.sections[k] = isOn(ui.sections[k]); });
    DETAIL_FIELDS.forEach(([k]) => { m.details[k] = isOn(ui.details[k]); });
    const sch = S.defaults.schedule;
    if (sch && ui.time) {
        const days = DAY_KEYS.filter((k) => ui.days[k] && ui.days[k].checked);
        if (!days.length) return { error: 'Tick at least one day to send the report on.', focus: ui.days[sch.days[0]] };
        if (minutesOf(ui.time.value) == null) return { error: 'Pick a send time.', focus: ui.time };
        m.reportTime = ui.time.value;
        m.reportDays = days;
    }
    return { model: m };
}

/** The `settings` document to save, in exactly the contract's shape. */
function toSettingsDoc(m) {
    const st = obj(S.settings);
    const doc = {
        schema: SCHEMA,
        costThresholdPct: m.costThresholdPct,
        discountMarginPts: m.discountMarginPts,
        orderTypes: Object.assign(carryOver(st.orderTypes, S.catalog.orderTypes), m.orderTypes),
        blindTypes: Object.assign(carryOver(st.blindTypes, S.catalog.blindTypes), changedTypes(m.blindTypes)),
        sundryTypes: Object.assign(carryOver(st.sundryTypes, S.catalog.sundryTypes), changedTypes(m.sundryTypes)),
        sections: m.sections,
        details: m.details,
        // An empty To is left out so the PC quietly uses its own list (an explicit [] is
        // reported as an ignored setting on every report).
        recipients: S.toList.length ? { to: S.toList.slice(), cc: S.ccList.slice() } : { cc: S.ccList.slice() },
        sendWhenNothingFlagged: m.sendWhenNothingFlagged,
    };
    if (m.reportTime != null) {
        doc.reportTime = m.reportTime;
        doc.reportDays = m.reportDays.slice();
    } else {                                                     // the PC offers no schedule: keep what was saved
        if (st.reportTime != null) doc.reportTime = st.reportTime;
        if (st.reportDays != null) doc.reportDays = st.reportDays;
    }
    return doc;
}

/** Saved entries for types the current lists don't show are kept as they were. */
function carryOver(saved, rows) {
    const shown = new Set(sortByUsed(rows).map((t) => String(t.id)));
    const out = {};
    for (const id in obj(saved)) if (!shown.has(id)) out[id] = saved[id];
    return out;
}

/** Only types that differ from the default (switched on, no own limit), per the contract. */
function changedTypes(table) {
    const out = {};
    for (const id in table) {
        const { include, limitPct } = table[id];
        if (!include) out[id] = limitPct != null ? { include: false, limitPct } : { include: false };
        else if (limitPct != null) out[id] = { include: true, limitPct };
    }
    return out;
}

// --------------------------------------------------------------------------
// Unsaved changes
// --------------------------------------------------------------------------

/** JSON with object keys sorted, so key order never counts as a change. */
function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
}

const pendingAddressText = () => !!((S.ui.toInput && S.ui.toInput.value.trim()) || (S.ui.ccInput && S.ui.ccInput.value.trim()));

function isDirty() {
    if (!S.seeded || !S.ui.cost) return false;
    if (pendingAddressText()) return true;
    const now = collectModel();
    return !!now.error || canon(now.model) !== canon(seedModel());
}

let dirtyTimer = 0;
function scheduleDirtyCheck() {
    if (dirtyTimer) return;
    dirtyTimer = setTimeout(() => { dirtyTimer = 0; updateDirtyUI(); }, 0);
}

function updateDirtyUI() {
    if (!S.ui.dirty) return;
    const dirty = isDirty();
    S.ui.dirty.textContent = dirty ? 'Unsaved changes' : 'No unsaved changes';
    S.ui.dirty.classList.toggle('cr-dirty-on', dirty);
}

function onBeforeUnload(e) {
    if (!isDirty()) return;
    e.preventDefault();
    e.returnValue = '';                                          // the browser shows its own "leave site?" prompt
}

// --------------------------------------------------------------------------
// Status card (spec §1)
// --------------------------------------------------------------------------

function renderStatus(status) {
    const card = byId('cr-status');
    if (!card) return;
    clear(card);
    card.classList.remove('cr-bad');
    card.appendChild(h('p', { class: 'bd-overline', text: 'Last report' }));
    if (status === undefined) { card.appendChild(muted('Loading…')); return; }
    if (!status) { card.appendChild(muted('No report has run yet. The office PC writes its status here after each run.')); return; }

    if (status.ok === false) {
        card.classList.add('cr-bad');
        card.appendChild(h('p', { class: 'cr-line' }, [h('b', { text: 'The last run failed' }), ` (${fmtWhen(status.lastRunAt)}).`]));
        if (status.message) card.appendChild(h('p', { class: 'cr-help', text: String(status.message) }));
        card.appendChild(h('p', { class: 'cr-help', text: 'The next run picks up every order since the last successful report.' }));
    } else {
        const parts = [];
        if (isNum(status.flagged)) parts.push(isNum(status.checked) ? `${status.flagged} flagged of ${status.checked}` : `${status.flagged} flagged`);
        if (Array.isArray(status.emailedTo)) parts.push(status.emailedTo.length ? `sent to ${friendlyNames(status.emailedTo)}` : 'not emailed');
        card.appendChild(h('p', { class: 'cr-line' }, [h('b', { text: fmtWhen(status.lastRunAt) }), parts.length ? `, ${parts.join(', ')}.` : '.']));
        const sub = [];
        if (toDate(status.windowStart) && toDate(status.windowEnd)) sub.push(`Orders placed ${fmtWhen(status.windowStart)} – ${fmtWhen(status.windowEnd)}`);
        if (isNum(status.flaggedCost) || isNum(status.flaggedDiscount)) {
            sub.push(`${isNum(status.flaggedCost) ? status.flaggedCost : 0} on cost, ${isNum(status.flaggedDiscount) ? status.flaggedDiscount : 0} on discount`);
        }
        if (isNum(status.internal)) sub.push(`${status.internal} error/showroom`);
        if (isNum(status.excludedByProductType) && status.excludedByProductType > 0) sub.push(`${status.excludedByProductType} skipped by product type`);
        if (sub.length) card.appendChild(h('p', { class: 'cr-help', text: sub.join(' · ') }));
    }
    if (status.settingsUsed) card.appendChild(h('p', { class: 'cr-help', text: `Settings used: ${status.settingsUsed}` }));
    const ignored = list(status.settingsIgnored).map(String).filter(Boolean);
    if (ignored.length) card.appendChild(h('p', { class: 'cr-warn', text: `Ignored by the PC: ${ignored.join('; ')}` }));
    if (S.defaults.schedule) card.appendChild(h('p', { class: 'cr-help', text: `Sends at ${scheduleText()}.` }));

    // Warn when a report the PC should have sent hasn't gone out: with a schedule, the latest send
    // slot (an hour's grace) without a run that day; without one, more than a working day since the last run.
    const last = MS(status.lastRunAt);
    const now = Date.now();
    if (last != null && S.defaults.schedule) {
        const slot = lastDueSlot(now);
        if (slot != null && last < new Date(slot).setHours(0, 0, 0, 0)) {
            card.classList.add('cr-bad');
            card.appendChild(h('p', { class: 'cr-warn', text: `The ${fmtWhen(slot)} report hasn’t gone out; the last one is from `
                + `${fmtWhen(last)}. The office PC may be off.` }));
        }
    } else if (last != null && weekdayMsBetween(last, now) > STALE_AFTER_MS) {
        card.classList.add('cr-bad');
        card.appendChild(h('p', { class: 'cr-warn', text: `The last report is from ${fmtWhen(last)}, more than a working day ago. The office PC may be off.` }));
    }
    if (status.scriptVersion) {
        card.appendChild(h('p', { class: 'cr-muted cr-small', text: `Cost report v${status.scriptVersion}${status.host ? ' · ' + status.host : ''}` }));
    }
}

function renderStatusError(err) {
    console.error('Cost report console:', err);
    const card = byId('cr-status');
    if (!card) return;
    clear(card);
    card.appendChild(h('p', { class: 'bd-overline', text: 'Last report' }));
    card.appendChild(h('p', { class: 'cr-warn', text: `Could not read the last run: ${explain(err)}` }));
}

// --------------------------------------------------------------------------
// Misc helpers
// --------------------------------------------------------------------------

/** Catalog rows, most used first (the PC already sorts them; this also drops malformed rows). */
function sortByUsed(rows) {
    return list(rows).filter((t) => t && typeof t === 'object' && t.id != null).sort((a, b) =>
        (num(b.used30, 0) - num(a.used30, 0)) || String(a.name || '').localeCompare(String(b.name || '')));
}
function usedLabel(t) {
    const n = num(t.used30, 0);
    return n ? `used ${n.toLocaleString('en-ZA')}× in 30 days` : 'not used in 30 days';
}
const typeName = (t, kind) => (t.name ? String(t.name) : `${kind} ${t.id}`);
const nameCell = (name, sub) => h('div', { class: 'cr-row-name' }, [h('span', { text: name }), h('span', { class: 'cr-used', text: sub })]);

// --------------------------------------------------------------------------
// Scoped styles (OrderBot has no switch or chip components of its own)
// --------------------------------------------------------------------------

function injectStyles() {
    if (byId('cost-report-styles')) return;
    const css = `
      #cost-report-view .cr-stack > * + * { margin-top: 1.1rem; }
      #cost-report-view .cr-head { display: flex; align-items: baseline; justify-content: space-between; gap: .4rem 1rem; flex-wrap: wrap; padding: 0 .25rem; }
      #cost-report-view .cr-head .bd-overline { margin: 0; }
      #cost-report-view .cr-panel { padding: 1.15rem 1.35rem; }
      #cost-report-view .cr-title { margin: 0 0 .9rem; }
      #cost-report-view .cr-muted { color: var(--bd-grey); }
      #cost-report-view .cr-small { font-size: .72rem; }
      #cost-report-view .cr-help { color: var(--bd-grey); font-size: .8rem; margin: .15rem 0 0; line-height: 1.4; }
      #cost-report-view .cr-lead { margin: -.4rem 0 .6rem; }
      #cost-report-view .cr-gap { margin-top: 1rem; }
      #cost-report-view .cr-warn { color: #8a4a38; font-size: .82rem; margin: .35rem 0 0; font-weight: 600; }
      #cost-report-view .cr-line { font-size: 1rem; margin: 0; color: var(--bd-ink); }
      #cost-report-view .cr-label { display: block; font-weight: 700; color: var(--bd-ink); }
      #cost-report-view .cr-subtitle { font: 700 .9rem 'PT Sans', sans-serif; color: var(--bd-ink); margin: 0 0 .4rem; }
      #cost-report-view .cr-bad, #cost-report-view .cr-error { border-color: var(--bd-blush); background: #f9ece7; }
      #cost-report-view .cr-row { display: flex; align-items: center; justify-content: space-between; gap: .4rem 1rem; flex-wrap: wrap; padding: .55rem .15rem; border-bottom: 1px solid var(--bd-line); }
      #cost-report-view .cr-row:last-child { border-bottom: 0; }
      #cost-report-view .cr-row-name { display: flex; flex-direction: column; gap: .1rem; min-width: 0; }
      #cost-report-view .cr-used { font-size: .72rem; color: var(--bd-grey); }
      #cost-report-view .cr-radios { display: flex; gap: .4rem; flex-wrap: wrap; }
      #cost-report-view .cr-radio { display: inline-flex; align-items: center; gap: .35rem; font-size: .85rem; background: var(--bd-sage-tint); border: 1px solid var(--bd-line); border-radius: 8px; padding: .3rem .6rem; cursor: pointer; }
      #cost-report-view .cr-radio input { accent-color: var(--bd-olive); }
      #cost-report-view .cr-limit { display: flex; align-items: flex-start; justify-content: space-between; gap: .4rem 1rem; flex-wrap: wrap; padding: .55rem 0; border-bottom: 1px solid var(--bd-line); }
      #cost-report-view .cr-limit:last-child { border-bottom: 0; }
      #cost-report-view .cr-limit-text { flex: 1 1 260px; }
      #cost-report-view .cr-limit-input { display: flex; align-items: center; gap: .5rem; white-space: nowrap; }
      #cost-report-view .cr-num { width: 68px; border: 1px solid var(--bd-line-strong); border-radius: 8px; padding: .35rem .45rem; text-align: right; font-variant-numeric: tabular-nums; }
      #cost-report-view .cr-num:disabled { opacity: .45; background: var(--bd-sage-tint); }
      #cost-report-view .cr-limitpct { width: 60px; }
      #cost-report-view .cr-time { min-width: 96px; }
      #cost-report-view .cr-days { flex-wrap: wrap; white-space: normal; }
      #cost-report-view .cr-unit { color: var(--bd-grey); font-weight: 700; }
      #cost-report-view .cr-input { border: 1px solid var(--bd-line-strong); border-radius: 8px; padding: .4rem .6rem; min-width: 0; }
      #cost-report-view .cr-typeblock { margin-top: 1rem; }
      #cost-report-view .cr-typehead { display: flex; align-items: center; justify-content: space-between; gap: .75rem; flex-wrap: wrap; margin-bottom: .35rem; }
      #cost-report-view .cr-typetools { display: flex; align-items: center; gap: .4rem; flex-wrap: wrap; }
      #cost-report-view .cr-search { flex: 1 1 180px; }
      #cost-report-view .cr-typelist { max-height: 340px; overflow-y: auto; border: 1px solid var(--bd-line); border-radius: 10px; padding: 0 .6rem; }
      #cost-report-view .cr-typectrls { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
      #cost-report-view .cr-inline { display: inline-flex; align-items: center; gap: .4rem; font-size: .8rem; }
      #cost-report-view .cr-togglegrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 0 1.25rem; }
      #cost-report-view .cr-chips { display: flex; flex-wrap: wrap; gap: .4rem; margin: .3rem 0; align-items: center; }
      #cost-report-view .cr-chip { display: inline-flex; align-items: center; gap: .45rem; background: var(--bd-olive-tint); color: var(--bd-ink); border-radius: 999px; padding: .25rem .5rem .25rem .75rem; font-size: .85rem; }
      #cost-report-view .cr-chip-bad { background: #f4e3dd; color: #8a4a38; }
      #cost-report-view .cr-chip button { border: 0; background: transparent; cursor: pointer; color: var(--bd-olive-deep); font-weight: 700; line-height: 1; padding: 0 .1rem; }
      #cost-report-view .cr-addrow { display: flex; gap: .4rem; margin-bottom: .2rem; }
      #cost-report-view .cr-addrow .cr-input { flex: 1 1 auto; }
      #cost-report-view .cr-chipbtn { font: 700 .74rem 'PT Sans', sans-serif; letter-spacing: .04em; background: var(--bd-sage-tint); color: var(--bd-ink); border: 1px solid var(--bd-line-strong); border-radius: 8px; padding: .3rem .7rem; cursor: pointer; }
      #cost-report-view .cr-chipbtn:hover { background: var(--bd-olive-tint); }
      #cost-report-view .cr-link { border: 0; background: transparent; color: var(--bd-olive); font-weight: 700; font-size: .78rem; cursor: pointer; text-decoration: underline; }
      #cost-report-view .cr-actions { display: flex; align-items: center; justify-content: space-between; gap: .75rem 1rem; flex-wrap: wrap; padding: 1rem 1.25rem; }
      #cost-report-view .cr-saveas { display: flex; align-items: center; gap: .5rem; }
      #cost-report-view .cr-name { width: 140px; }
      #cost-report-view .cr-actionbtns { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
      #cost-report-view .cr-dirty { font-size: .78rem; color: var(--bd-grey); margin-right: .25rem; }
      #cost-report-view .cr-dirty-on { color: #8a4a38; font-weight: 700; }
      #cost-report-view .bd-btn-secondary:disabled { opacity: .5; cursor: not-allowed; }
      #cost-report-view .cr-banner { display: flex; align-items: center; justify-content: space-between; gap: .75rem 1rem; flex-wrap: wrap; background: #f9ece7; border: 1px solid var(--bd-blush); color: #8a4a38; border-radius: 12px; padding: .8rem 1.1rem; font-size: .88rem; font-weight: 600; }
      #cost-report-view .cr-banner.hidden { display: none; }
      #cost-report-view .cr-switch { position: relative; width: 44px; height: 24px; border-radius: 999px; background: var(--bd-line-strong); border: 0; cursor: pointer; flex: none; transition: background .15s ease; padding: 0; }
      #cost-report-view .cr-switch[aria-checked="true"] { background: var(--bd-olive); }
      #cost-report-view .cr-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform .15s ease; box-shadow: 0 1px 2px rgba(0,0,0,.25); }
      #cost-report-view .cr-switch[aria-checked="true"]::after { transform: translateX(20px); }
      #cost-report-view .cr-switch:focus-visible { outline: 2px solid var(--bd-olive); outline-offset: 2px; }
    `;
    document.head.appendChild(h('style', { id: 'cost-report-styles', text: css }));
}
