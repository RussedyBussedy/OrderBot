// =============================================================================
// biq-converter-ui.js — BlindIQ XML Converter UI for OrderBot
// Self-contained: renders into #biq-converter-section, receives every external
// dependency (db, Firestore fns, property getters, validations, proxy config)
// via initBiqConverter(deps). Touches nothing outside its own section/modals.
// =============================================================================
import {
    BIQ_SEED_MAPPINGS, BIQ_MAPPING_CATEGORIES, BIQ_EXTRACTION_SCHEMA,
    biqNorm, biqLc, biqResolve, biqResolveColour, biqBlankOrder, biqBlankItem,
    biqParseDate, biqComputeControlDrop, biqTemplateFor, biqSetVar,
    biqSplitFabric, biqNeedsSplit, biqReSplitFabrics,
    biqResolveRange, biqRangeNamesFor, biqComputeControlDropV2, biqResolveSundry, biqRecomputeControlDrops, biqApplyCustomerDefaults, biqVariantSpec, biqMergeTemplate, biqTemplateFor2, biqAssignSundryCodes, biqResolveCustomer, biqCanonicalCustomerName,
    biqBuildDiscernment, BIQ_DISCERN_SCHEMA, biqBuildDiscernPrompt, biqApplyDiscernment, biqAcceptSuggestion, biqLearnFromAI,
    biqApplyShutterConfig, biqApplyOptionDefaults, biqCopyOptions, biqInferControls, biqCanonicalize,
    biqParseBlindGuysRows, biqNormalizeBlindGuys,
    biqParseMatheoItems, biqNormalizeMatheo,
    biqParseBDFields, biqNormalizeBDForm,
    biqBuildExtractionPrompt, biqAiResultToOrder,
    biqCollectProblems, biqGenerateXML, biqPrettyXML, biqImportSafetyScan,
    biqToComparisonShape, biqExtractCheckResults
} from './biq-converter.js';
import { biqDetectForm, biqParseSpecForm, biqElementGridOptions } from './biq-form-specs.js';

let D = null;            // injected deps
let MAPS = null;         // live mappings (seeds + Firestore)
let order = null;        // current order model
let checkResults = null; // last torque/spec check results
let assignCtx = null, fsCtx = null, mapTab = 'blindTypes';
const $ = id => document.getElementById(id);
const escH = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------- mappings io
const MAPPINGS_COLLECTION = 'orderbot_biq_mappings';
function freshSeeds() { return JSON.parse(JSON.stringify(BIQ_SEED_MAPPINGS)); }
async function loadMappings() {
    MAPS = freshSeeds();
    if (!D.db) { D.showToast('BlindIQ mappings: database offline — using built-in defaults only.', 'error'); return; }
    try {
        const snap = await D.getDocs(D.collection(D.db, MAPPINGS_COLLECTION));
        if (snap.empty) {
            for (const cat of Object.keys(BIQ_SEED_MAPPINGS)) await saveCategory(cat); // first run: seed
        } else {
            snap.forEach(d => applyCategoryDoc(d.id, d.data()));
        }
        renderStaticDatalists();
        // live sync: a mapping added on any PC appears here within seconds
        D.onSnapshot(D.collection(D.db, MAPPINGS_COLLECTION), snap2 => {
            snap2.docChanges().forEach(ch => applyCategoryDoc(ch.doc.id, ch.doc.data()));
            renderStaticDatalists();
            if (order) refresh();
            if ($('biq-mapmodal') && !$('biq-mapmodal').classList.contains('hidden')) renderMapBody();
        });
    } catch (e) { console.error('biq mappings load failed', e); D.showToast('Could not load BlindIQ mappings from Firestore.', 'error'); }
}
function applyCategoryDoc(id, data) {
    if (!data || !data.json) return;
    const base = id.split('__')[0];
    try { MAPS[base] = Object.assign(MAPS[base] || {}, JSON.parse(data.json)); } catch (e) { console.error('bad mapping doc', id, e); }
}
const SHARD_LIMIT = 700000; // chars; Firestore doc hard limit is ~1MB
async function saveCategory(cat) {
    if (!D.db) return;
    try {
        const full = JSON.stringify(MAPS[cat] || {});
        if (full.length <= SHARD_LIMIT) {
            await D.setDoc(D.doc(D.db, MAPPINGS_COLLECTION, cat), { json: full, shards: 1, updatedAt: new Date().toISOString() });
            return;
        }
        // shard: split entries across customers / customers__2 / ...
        const entries = Object.entries(MAPS[cat] || {});
        const chunks = []; let cur = {}, curLen = 2;
        for (const [k, v] of entries) {
            const addLen = k.length + JSON.stringify(v).length + 6;
            if (curLen + addLen > SHARD_LIMIT) { chunks.push(cur); cur = {}; curLen = 2; }
            cur[k] = v; curLen += addLen;
        }
        chunks.push(cur);
        for (let i = 0; i < chunks.length; i++) {
            const id = i === 0 ? cat : cat + '__' + (i + 1);
            await D.setDoc(D.doc(D.db, MAPPINGS_COLLECTION, id), { json: JSON.stringify(chunks[i]), shards: chunks.length, updatedAt: new Date().toISOString() });
        }
    }
    catch (e) { console.error('biq mapping save failed', e); D.showToast('Could not save mapping to Firestore.', 'error'); }
}
function exportMappingsFile() {
    const blob = new Blob([JSON.stringify(MAPS, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'BlindIQ_mappings_' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
}
async function importMappingsFile(file) {
    if (!file) return;
    try {
        const m = JSON.parse(await file.text());
        for (const k in m) {
            if (!m[k] || typeof m[k] !== 'object') continue;
            MAPS[k] = Object.assign(MAPS[k] || {}, m[k]);
            await saveCategory(k);
        }
        D.showToast('Mappings imported and synced to Firestore for the whole team.', 'success');
        renderStaticDatalists(); renderMapBody(); if (order) refresh();
    } catch (e) { D.showToast('Not a valid mappings file.', 'error'); }
}

// ---------------------------------------------------------------- file intake
async function handleFiles(files) {
    if (!files || !files.length) return;
    const f = files[0];
    const ext = f.name.split('.').pop().toLowerCase();
    try {
        setStatus('Reading ' + f.name + '…');
        if (ext === 'xlsx' || ext === 'xls') await loadXlsx(f);
        else if (ext === 'pdf') await loadPdf(f);
        else if (['png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'webp'].includes(ext)) await aiExtract([f]);
        else D.showToast('Unsupported file type: .' + ext, 'error');
    } catch (err) {
        console.error(err); setStatus('');
        D.showToast('Could not read this file: ' + err.message, 'error');
    }
}
async function loadXlsx(f) {
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
    const p = biqParseBlindGuysRows(rows);
    if (p) { setOrder(biqNormalizeBlindGuys(MAPS, p)); return; }
    D.showToast('Spreadsheet layout not recognised — falling back to AI extraction.', 'info');
    await aiExtract([f]);
}
async function loadPdf(f) {
    const buf = await f.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
    // 1) BD fillable form?
    const fields = {};
    for (let p = 1; p <= doc.numPages; p++) {
        const ann = await (await doc.getPage(p)).getAnnotations();
        ann.forEach(a => { if (a.fieldName) { let v = a.fieldValue; if (Array.isArray(v)) v = v.join(', '); fields[a.fieldName] = v; } });
    }
    const filled = Object.values(fields).filter(v => !(v == null || v === '' || v === 'Off' || v === '/Off')).length;
    if (filled >= 3) {
        const formKey = biqDetectForm(fields);
        if (formKey && formKey !== 'element') {
            const o = biqParseSpecForm(MAPS, formKey, fields);
            if (o.items.length || o.customer) { setOrder(o); return; }
        }
        const p = biqParseBDFields(fields);
        if (p && (p.items.length || p.meta.customerName)) { setOrder(biqNormalizeBDForm(MAPS, p, biqElementGridOptions(fields))); return; }
    }
    // 2) Mathéo text layout?
    const textItems = [];
    for (let p = 1; p <= doc.numPages; p++) {
        const tc = await (await doc.getPage(p)).getTextContent();
        tc.items.forEach(i => textItems.push({ s: i.str, x: i.transform[4], y: i.transform[5] - p * 10000 }));
    }
    if (textItems.map(i => i.s).join('').replace(/\s/g, '').length > 40) {
        const m = biqParseMatheoItems(textItems);
        if (m && m.rows.length) { setOrder(biqNormalizeMatheo(MAPS, m)); return; }
    }
    // 3) unknown or scanned -> AI
    await aiExtract([f]);
}

// ---------------------------------------------------------------- AI extraction
async function fileToB64(f) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res({ mimeType: f.type || 'application/octet-stream', data: String(r.result).split(',')[1] });
        r.onerror = rej; r.readAsDataURL(f);
    });
}
async function aiExtract(files) {
    setStatus('AI is reading the document… (Gemini)');
    const parts = [{ text: biqBuildExtractionPrompt(Object.keys(MAPS.ranges), Object.keys(MAPS.blindTypes)) }];
    for (const f of files) { const b = await fileToB64(f); parts.push({ inlineData: b }); }
    const proxyPayload = {
        model: D.EXTRACTION_MODEL,
        payload: { contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: BIQ_EXTRACTION_SCHEMA } }
    };
    let resultText, response;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            response = await fetch(D.PROXY_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(proxyPayload) });
            resultText = await response.text();
            if (response.ok) break;
            if (attempt === 3 || !(response.status === 503 || response.status === 429 || response.status >= 500)) throw new Error('API ' + response.status + ': ' + resultText.slice(0, 200));
        } catch (e) { if (attempt === 3) { setStatus(''); throw e; } }
        await new Promise(r => setTimeout(r, attempt * 2000));
    }
    const result = JSON.parse(resultText);
    if (!result.candidates || !result.candidates[0]?.content) throw new Error('No content from AI' + (result.promptFeedback?.blockReason ? ' (' + result.promptFeedback.blockReason + ')' : ''));
    const ai = JSON.parse(result.candidates[0].content.parts[0].text);
    const o = biqAiResultToOrder(MAPS, ai);
    setOrder(o);
    D.showToast('AI extracted ' + o.items.length + ' line item(s) — verify every value against the original document.', 'info');
}

// ---------------------------------------------------------------- state/render
let aiBusy = false;
function setOrder(o) { order = o; checkResults = null; $('biq-editor').classList.remove('hidden'); renderHeader(); refresh(); setStatus(''); fitCollapsible(); maybeAiDiscern(); }

// Run AI discernment over any unresolved PRODUCT names (not the customer account).
async function aiDiscern(manual) {
    if (!order || aiBusy) return;
    const slots = biqBuildDiscernment(MAPS, order);
    if (!slots.length) { if (manual) D.showToast('Nothing for AI to match - all product names already resolve.', 'info'); return; }
    if (!D.PROXY_API_URL) { if (manual) D.showToast('AI matching needs the Gemini connection (OrderBot only).', 'error'); return; }
    aiBusy = true; setStatus('AI is matching ' + slots.length + ' product name(s) to the BlindIQ catalogue...');
    try {
        const payload = { model: D.EXTRACTION_MODEL, payload: { contents: [{ role: 'user', parts: [{ text: biqBuildDiscernPrompt(slots) }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: BIQ_DISCERN_SCHEMA } } };
        let txt, resp;
        for (let a = 1; a <= 3; a++) {
            try { resp = await fetch(D.PROXY_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); txt = await resp.text(); if (resp.ok) break; if (a === 3) throw new Error('API ' + resp.status); } catch (e) { if (a === 3) throw e; }
            await new Promise(r => setTimeout(r, a * 1500));
        }
        const result = JSON.parse(txt);
        const out = JSON.parse(result.candidates[0].content.parts[0].text);
        const report = biqApplyDiscernment(MAPS, order, out.matches, { autoAt: 0.85, suggestAt: 0.5 });
        const autos = report.filter(r => r.mode === 'auto').length, sugg = report.filter(r => r.mode === 'suggest').length;
        setStatus('');
        refresh();
        D.showToast('AI matched ' + autos + ' name(s) automatically (amber - please verify) and suggested ' + sugg + ' more. ' + (slots.length - autos - sugg) + ' still need you.', autos || sugg ? 'success' : 'info');
    } catch (e) { setStatus(''); console.error(e); D.showToast('AI match failed: ' + e.message, 'error'); }
    aiBusy = false;
}
function maybeAiDiscern() {
    if (order && order.source !== 'manual' && biqBuildDiscernment(MAPS, order).length) aiDiscern(false);
}
function setStatus(t) { $('biq-status').textContent = t; fitCollapsible(); }
// OrderBot's collapsible freezes max-height on expand + overflow:hidden, which clips our
// dynamically-growing editor. While the section is open, let it grow naturally so the page
// can scroll to all of it.
function fitCollapsible() {
    const hdr = document.getElementById('biq-converter-header');
    const c = document.getElementById('biq-converter-content');
    if (hdr && c && hdr.classList.contains('open')) { c.style.maxHeight = 'none'; c.style.overflow = 'visible'; }
}
function newBlankOrder() { const o = biqBlankOrder(); o.orderDate = new Date().toISOString().slice(0, 10); o.items.push(biqBlankItem('a')); setOrder(o); }
function hv(id, v) { $(id).value = v == null ? '' : v; }
function val(id) { return biqNorm($(id).value); }
function renderHeaderValuesOnly() { // sync defaults filled by code into visible inputs without full re-render
    if ($('biq-h-delmethod').value !== (order.deliveryMethod || '')) $('biq-h-delmethod').value = order.deliveryMethod || '';
    if ($('biq-h-packing').value !== (order.packingType || '')) $('biq-h-packing').value = order.packingType || '';
}
function renderHeader() {
    $('biq-srcbadge').textContent = order.sourceDesc;
    hv('biq-h-customer', order.customer); hv('biq-h-ordernum', order.orderNumber); hv('biq-h-client', order.client);
    hv('biq-h-orderdate', order.orderDate); hv('biq-h-reqdate', order.requiredDate); hv('biq-h-orderid', order.orderId);
    hv('biq-h-delmethod', order.deliveryMethod); hv('biq-h-packing', order.packingType);
    $('biq-h-address').value = order.address || ''; hv('biq-h-notes', order.notes);
}
function readHeader() {
    if (!order) return;
    order.customer = val('biq-h-customer'); order.orderNumber = val('biq-h-ordernum'); order.client = val('biq-h-client');
    order.orderDate = val('biq-h-orderdate'); order.requiredDate = val('biq-h-reqdate'); order.orderId = val('biq-h-orderid') || '0';
    order.deliveryMethod = val('biq-h-delmethod'); order.packingType = val('biq-h-packing');
    order.address = $('biq-h-address').value; order.notes = val('biq-h-notes');
}
function idTag(res, cat, name) {
    if (res.empty) return '<span class="biq-tag biq-tag-na">—</span>';
    const arg = escH(JSON.stringify([cat, String(name)]));
    if (res.known) return `<span class="biq-tag biq-tag-ok" data-biq-assign='${arg}'>✓ ${res.id}</span>`;
    return `<span class="biq-tag biq-tag-miss" data-biq-assign='${arg}'>? assign</span>`;
}

function refresh() {
    if (!order) return;
    readHeader();
    biqReSplitFabrics(MAPS, order);
    biqRecomputeControlDrops(MAPS, order);
    biqAssignSundryCodes(order);
    biqApplyCustomerDefaults(MAPS, order); renderHeaderValuesOnly();
    biqApplyShutterConfig(MAPS, order);
    biqApplyOptionDefaults(MAPS, order);
    biqInferControls(MAPS, order);
    biqCanonicalize(MAPS, order);
    renderCustomerTag();
    renderItems();
    renderProblems();
    renderChecks();
    renderPreview();
    $('biq-xmlout').textContent = biqPrettyXML(biqGenerateXML(MAPS, order));
    fitCollapsible();
}
let refTimer = null;
function scheduleRefresh() { clearTimeout(refTimer); refTimer = setTimeout(refresh, 350); }

function renderCustomerTag() {
    const r = biqResolveCustomer(MAPS, order.customer);
    $('biq-custtag').innerHTML = order.customer
        ? (r.known
            ? `<span class="biq-tag biq-tag-ok" data-biq-assign='${escH(JSON.stringify(['customers', order.customer]))}'>✓ cust ${r.entry.customer} / addr ${r.entry.address}${r.entry.operator ? ' / op ' + r.entry.operator : ''}</span>`
            : `<span class="biq-tag biq-tag-miss" data-biq-assign='${escH(JSON.stringify(['customers', order.customer]))}'>? assign BlindIQ customer IDs</span>`)
        : '';
    const dm = biqResolve(MAPS, 'deliveryMethods', order.deliveryMethod);
    $('biq-delmtag').innerHTML = order.deliveryMethod ? idTag(dm, 'deliveryMethods', order.deliveryMethod) : '';
    const pk = biqResolve(MAPS, 'packingTypes', order.packingType);
    $('biq-packtag').innerHTML = order.packingType ? idTag(pk, 'packingTypes', order.packingType) : '';
}

const BIQ_FIELD_CAT = { blindType:'blindTypes', range:'ranges', colour:'colours', control1:'control1', control2:'control2', fix:'fixes' };
function prodTag(i, field, res) {
    if (res.empty) return '<span class="biq-tag biq-tag-na" data-biq-prodsearch="'+i+':'+field+'" title="Search the BlindIQ catalogue">+ find</span>';
    if (res.known) return '<span class="biq-tag biq-tag-ok" data-biq-prodsearch="'+i+':'+field+'" title="Correct? Click to search & change">✓ '+res.id+'</span>';
    return '<span class="biq-tag biq-tag-miss" data-biq-prodsearch="'+i+':'+field+'" title="Click to search the BlindIQ catalogue">? find</span>';
}
function aiChip(it, field) {
    const a = it._ai && it._ai[field];
    if (!a) return '';
    const pct = Math.round((a.confidence || 0) * 100);
    if (a.mode === 'auto')
        return ` <span class="biq-ai biq-ai-auto" title="AI matched '${escH(a.from)}' to '${escH(a.to)}' (${pct}%). Click to verify / change / undo." data-biq-prodsearch="${it._idx}:${field}">AI ${pct}% ✎</span>`;
    return ` <span class="biq-ai biq-ai-sug" title="AI thinks '${escH(it[field])}' means '${escH(a.to)}' (${pct}%). Click to accept." data-biq-acceptai="${it._idx}:${field}">AI? ${escH(a.to)} (${pct}%) - accept</span>`;
}
function renderItems() {
    const tb = $('biq-itemrows'); let html = '';
    order.items.forEach((it, i) => {
        it._idx = i;
        const rt = biqResolve(MAPS, 'blindTypes', it.blindType), rr = biqResolveRange(MAPS, it.blindType, it.range),
            rc = biqResolveColour(MAPS, it.range, it.colour), rf = biqResolve(MAPS, 'fixes', it.fix),
            r1 = biqResolve(MAPS, 'control1', it.control1), r2 = biqResolve(MAPS, 'control2', it.control2);
        const DL = { blindType: 'biq-dl-bt', fix: 'biq-dl-fix', control1: 'biq-dl-c1', control2: 'biq-dl-c2' };
        const inp = (k, v, cls, mw) => `<input class="biq-in ${cls || ''}" style="min-width:${mw || 60}px" value="${escH(v)}" data-biq-item="${i}" data-biq-field="${k}"${DL[k] ? ` list="${DL[k]}"` : ''}>`;
        const rangeTag = biqNeedsSplit(MAPS, it)
            ? `<span class="biq-tag biq-tag-miss" data-biq-split="${i}">✂ split</span>`
            : prodTag(i,'range',rr);
        const flags = checkFlagsFor(i);
        const hasAuto = it._ai && Object.values(it._ai).some(a => a.mode === 'auto');
        html += '<tr' + (flags.some(f => f.type !== 'warning') ? ' class="biq-row-alert"' : (flags.length ? ' class="biq-row-warn"' : (hasAuto ? ' class="biq-row-ai"' : ''))) + '>'
            + `<td>${inp('code', it.code, '', 36)}</td><td>${inp('qty', it.qty, '', 32)}</td>`
            + `<td>${inp('location', it.location, '', 100)}</td>`
            + `<td>${inp('blindType', it.blindType, '', 110)}<br>${prodTag(i,'blindType',rt)}${aiChip(it,'blindType')}</td>`
            + `<td>${inp('range', it.range, '', 100)}<br>${rangeTag.replace("data-biq-assign='" + escH(JSON.stringify(['ranges', String(it.range)])), "data-biq-assign='" + escH(JSON.stringify(['ranges', String(it.range), it.blindType])))}</td>`
            + `<td>${inp('colour', it.colour, '', 90)}<br>${prodTag(i,'colour',rc)}${aiChip(it,'colour')}</td>`
            + `<td>${inp('width', it.width, '', 52)}</td><td>${inp('drop', it.drop, '', 52)}</td>`
            + `<td>${inp('fix', it.fix, '', 64)}<br>${prodTag(i,'fix',rf)}${aiChip(it,'fix')}</td>`
            + `<td>${inp('control1', it.control1, '', 76)}<br>${prodTag(i,'control1',r1)}${aiChip(it,'control1')}</td>`
            + `<td>${inp('control2', it.control2, '', 76)}<br>${prodTag(i,'control2',r2)}${aiChip(it,'control2')}</td>`
            + `<td>${inp('controlDrop', it.controlDrop, '', 52)}</td>`
            + `<td class="whitespace-nowrap"><button class="biq-btn-sm" data-biq-togglevars="${i}">${it.open ? '▾' : '▸'} opts (${it.variants.filter(v => v[1]).length})</button> <button class="biq-btn-sm biq-btn-danger" data-biq-delitem="${i}">✕</button></td>`
            + '</tr>';
        if (flags.length) {
            html += `<tr class="biq-flagrow"><td></td><td colspan="12">` + flags.map(f =>
                `<div class="${f.type === 'warning' ? 'text-amber-700' : 'text-red-700'} text-xs font-semibold py-0.5">⚠ ${escH(f.message)}</div>`).join('') + '</td></tr>';
        }
        if (it.open) {
            const spec = biqVariantSpec(MAPS, it.blindType) || [];
            html += `<tr><td colspan="13"><div class="biq-varbox">`;
            it.variants.forEach((v, vi) => {
                const so = spec.find(o => biqLc(o.k) === biqLc(v[0]));
                let dl = '';
                if (so && so.values && so.values.length) {
                    const dlid = `biq-dl-v-${i}-${vi}`;
                    dl = ` list="${dlid}"></input><datalist id="${dlid}">${so.values.map(x => `<option value="${escH(x)}">`).join('')}</datalist`;
                }
                html += `<div class="flex gap-1 mb-1"><input class="biq-in biq-vk${so && so.req ? ' font-semibold' : ''}" value="${escH(v[0])}" data-biq-var="${i}:${vi}:0" placeholder="Option" title="${so && so.req ? 'Required option' : ''}">`
                    + `<input class="biq-in flex-1" value="${escH(v[1])}" data-biq-var="${i}:${vi}:1" placeholder="${so && so.values ? escH(so.values.slice(0, 3).join(' / ')) : '(empty = blank in XML)'}"${dl}>`
                    + `<button class="biq-btn-sm biq-btn-danger" data-biq-delvar="${i}:${vi}">✕</button></div>`;
            });
            html += `<button class="biq-btn-sm" data-biq-addvar="${i}">+ option</button>`
                + (order.items.length > 1 ? ` <button class="biq-btn-sm" data-biq-copyopts="${i}" title="Copy these options to other lines">⧉ Copy options to other lines</button>` : '')
                + ` <input class="biq-in" style="margin-left:10px;width:280px" placeholder="Item notes (COI_Order_Notes)" value="${escH(it.notes)}" data-biq-item="${i}" data-biq-field="notes">`
                + `</div></td></tr>`;
        }
    });
    tb.innerHTML = html || '<tr><td colspan="13" class="text-slate-400 p-3">No items — drop an order file above or add an item.</td></tr>';
    const sb = $('biq-sundryrows'); let sh = '';
    order.sundries.forEach((s, i) => {
        sh += `<tr><td><input class="biq-in" style="min-width:40px" value="${escH(s.code)}" data-biq-sundry="${i}" data-biq-field="code"></td>`
            + `<td><input class="biq-in" style="min-width:40px" value="${escH(s.qty)}" data-biq-sundry="${i}" data-biq-field="qty"></td>`
            + `<td><input class="biq-in" style="min-width:60px" value="${escH(s.type)}" data-biq-sundry="${i}" data-biq-field="type" placeholder="e.g. 8"></td>`
            + `<td><input class="biq-in" style="min-width:60px" value="${escH(s.sundry)}" data-biq-sundry="${i}" data-biq-field="sundry" placeholder="e.g. 1897"></td>`
            + `<td><input class="biq-in w-full" value="${escH(s.notes)}" data-biq-sundry="${i}" data-biq-field="notes"></td>`
            + `<td class="whitespace-nowrap"><button class="biq-btn-sm" data-biq-sundrysearch="${i}" title="Search the BlindIQ sundries database">🔍</button> <button class="biq-btn-sm biq-btn-danger" data-biq-delsundry="${i}">✕</button></td></tr>`;
    });
    sb.innerHTML = sh || '<tr><td colspan="6" class="text-slate-400 p-2">None</td></tr>';
}
function checkFlagsFor(i) {
    if (!checkResults) return [];
    const r = checkResults.items.find(x => x.index === i);
    return r ? r.flags : [];
}

function renderProblems() {
    const probs = biqCollectProblems(MAPS, order);
    const el = $('biq-problems');
    if (!probs.length) {
        el.className = 'mt-3 p-3 rounded-lg text-sm bg-green-50 border border-green-200 text-green-800';
        el.innerHTML = '✔ All names mapped and required fields present — the XML is ready to import into BlindIQ.';
        return;
    }
    el.className = 'mt-3 p-3 rounded-lg text-sm bg-red-50 border border-red-200 text-red-800';
    el.innerHTML = `<b>${probs.length} thing${probs.length > 1 ? 's' : ''} to fix before this order is import-ready:</b><ul class="list-disc pl-5 mt-1">`
        + probs.map(p => '<li>' + escH(p.t)
            + (p.split != null ? ` <span class="biq-fixlink" data-biq-split="${p.split}">split it now</span>` : '')
            + (p.cat ? ` <span class="biq-fixlink" data-biq-assign='${escH(JSON.stringify([p.cat, String(p.name), p.blindType || '']))}'>map it now</span>` : '')
            + '</li>').join('') + '</ul>';
}

// ---------------------------------------------------------------- checks (torque etc.)
async function runChecks() {
    if (!order || !order.items.length) { D.showToast('Nothing to check yet.', 'info'); return; }
    refresh();
    setStatus('Running torque & spec checks against Fabric / Motor / Tube properties…');
    try {
        const [fabricProps, motorProps, tubeProps] = await Promise.all([D.getFabricProperties(), D.getMotorProperties(), D.getTubeProperties()]);
        const shaped = biqToComparisonShape(order);
        D.runPostAIValidations(shaped, fabricProps, motorProps, tubeProps);
        checkResults = biqExtractCheckResults(shaped);
        // note items whose range has no fabric properties (no torque possible)
        checkResults.missingFabric = order.items
            .filter(it => biqLc(it.range) && !fabricProps.get(biqLc(it.range)))
            .map(it => it.range).filter((v, i, a) => a.indexOf(v) === i);
        setStatus('');
        refresh();
        D.showToast('Checks complete.', 'success');
    } catch (e) { setStatus(''); console.error(e); D.showToast('Checks failed: ' + e.message, 'error'); }
}
function renderChecks() {
    const el = $('biq-checks');
    if (!checkResults) { el.innerHTML = '<span class="text-slate-400 text-sm">Not run yet — click "Run torque & spec checks".</span>'; return; }
    let html = '';
    if (checkResults.global) html += `<div class="text-red-700 font-semibold text-sm mb-1">⚠ ${escH(checkResults.global)}</div>`;
    const flagged = checkResults.items.filter(i => i.flags.length);
    const weights = checkResults.items.filter(i => i.blindWeight != null);
    html += `<div class="text-sm text-slate-600">${flagged.length ? flagged.length + ' item(s) flagged — see red rows in the grid.' : '✔ No torque / fabric / control / motor alerts.'}`;
    if (weights.length) html += ` &nbsp;·&nbsp; Weights computed for ${weights.length} item(s): ` + weights.map(w => {
        const it = order.items[w.index];
        return `<b>${escH(it && it.code || '?')}</b> ${w.blindWeight}kg${w.requiredTorqueSafety ? ' / needs ' + w.requiredTorqueSafety + 'Nm' : ''}`;
    }).join(', ');
    html += '</div>';
    if (checkResults.missingFabric && checkResults.missingFabric.length)
        html += `<div class="text-amber-700 text-xs mt-1">No fabric properties found for: ${checkResults.missingFabric.map(escH).join(', ')} — add them under Fabric Properties (exact range name) to enable weight/torque checks.</div>`;
    el.innerHTML = html;
}

// ---------------------------------------------------------------- preview + xml
function renderPreview() {
    const custR = biqResolveCustomer(MAPS, order.customer);
    const cust = { known: custR.known };
    const c = custR.known ? custR.entry : { customer: '?', address: '?', operator: '?' };
    const fmt = d => { if (!d) return '—'; const dd = new Date(d); return isNaN(dd) ? d : dd.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }); };
    const warn = (cat, name) => (!biqLc(name) || biqResolve(MAPS, cat, name).known) ? '' : ' <span class="text-red-600 font-bold">⚠</span>';
    let h = `<div class="border border-slate-300 rounded overflow-hidden text-xs bg-white">
      <div class="bg-slate-800 text-white px-3 py-2 font-bold flex justify-between"><span>Purchase Order — BlindIQ import preview</span><span>${escH(order.orderNumber)}</span></div>
      <div class="grid grid-cols-3 border-b border-slate-200">
        <div class="p-2 border-r border-slate-100"><div class="uppercase text-slate-400 font-semibold mb-1" style="font-size:10px">Customer (dealer)</div>
          <div><b>${escH(order.customer || '—')}</b>${cust.known ? '' : ' <span class="text-red-600 font-bold">⚠ not mapped</span>'}</div>
          <div>IQ: cust ${c.customer} / addr ${c.address} / op ${c.operator}</div><div>End client: ${escH(order.client || '—')}</div></div>
        <div class="p-2 border-r border-slate-100"><div class="uppercase text-slate-400 font-semibold mb-1" style="font-size:10px">Order</div>
          <div>Ref: <b>${escH(order.orderNumber || '—')}</b> · IQ ID ${escH(order.orderId)}</div>
          <div>Order date: ${fmt(order.orderDate)}</div><div>Required: <b>${fmt(order.requiredDate)}</b></div><div>Notes: ${escH(order.notes || '—')}</div></div>
        <div class="p-2"><div class="uppercase text-slate-400 font-semibold mb-1" style="font-size:10px">Delivery</div>
          <div>Method: ${escH(order.deliveryMethod || '—')}${warn('deliveryMethods', order.deliveryMethod)}</div>
          <div>Packing: ${escH(order.packingType || '—')}${warn('packingTypes', order.packingType)}</div>
          <div class="whitespace-pre-line">${escH(order.address || '—')}</div></div>
      </div>
      <div class="bg-slate-100 px-3 py-1 font-bold text-slate-700">Blinds (${order.items.length})</div>
      <table class="w-full"><tr class="bg-slate-50 text-slate-500 uppercase" style="font-size:10px">
        <th class="text-left px-2 py-1">Item</th><th class="text-left px-1">Qty</th><th class="text-left px-1">Location</th><th class="text-left px-1">Blind type</th><th class="text-left px-1">Range</th><th class="text-left px-1">Colour</th><th class="text-left px-1">Width</th><th class="text-left px-1">Drop</th><th class="text-left px-1">Ctrl drop</th><th class="text-left px-1">Control L</th><th class="text-left px-1">Control R</th><th class="text-left px-1">Fix</th></tr>`;
    order.items.forEach(it => {
        const rc = biqResolveColour(MAPS, it.range, it.colour);
        h += `<tr class="border-t border-slate-100"><td class="px-2 py-1 font-bold">${escH(it.code)}</td><td class="px-1">${escH(it.qty)}</td><td class="px-1">${escH(it.location)}</td>
          <td class="px-1">${escH(it.blindType)}${warn('blindTypes', it.blindType)}</td><td class="px-1">${escH(it.range)}${(!biqLc(it.range) || biqResolveRange(MAPS, it.blindType, it.range).known) ? '' : ' <span class="text-red-600 font-bold">⚠</span>'}</td>
          <td class="px-1">${escH(it.colour)}${(!biqLc(it.colour) || rc.known) ? '' : ' <span class="text-red-600 font-bold">⚠</span>'}</td>
          <td class="px-1">${escH(it.width)}</td><td class="px-1">${escH(it.drop)}</td><td class="px-1">${escH(it.controlDrop)}</td>
          <td class="px-1">${escH(it.control1)}${warn('control1', it.control1)}</td><td class="px-1">${escH(it.control2)}${warn('control2', it.control2)}</td><td class="px-1">${escH(it.fix)}${warn('fixes', it.fix)}</td></tr>`;
        const vs = it.variants.filter(v => biqNorm(v[1])).map(v => escH(v[0]) + '=' + escH(v[1])).join(' | ');
        if (vs || it.notes) h += `<tr class="bg-slate-50"><td></td><td colspan="11" class="px-1 pb-1 text-slate-500" style="font-size:10.5px">${vs}${it.notes ? ' <i>— ' + escH(it.notes) + '</i>' : ''}</td></tr>`;
    });
    h += '</table>';
    if (order.sundries.length) {
        h += `<div class="bg-slate-100 px-3 py-1 font-bold text-slate-700">Sundries (${order.sundries.length})</div><table class="w-full">`;
        order.sundries.forEach(s => { h += `<tr class="border-t border-slate-100"><td class="px-2 py-1 font-bold">${escH(s.code)}</td><td class="px-1">${(+s.qty || 0).toFixed(3)}</td><td class="px-1">type ${escH(s.type)}</td><td class="px-1">sundry ${escH(s.sundry)}</td><td class="px-1">${escH(s.notes)}</td></tr>`; });
        h += '</table>';
    }
    h += '</div>';
    $('biq-preview').innerHTML = h;
}
function downloadXML() {
    refresh();
    const probs = biqCollectProblems(MAPS, order);
    const offenders = biqImportSafetyScan(biqGenerateXML(MAPS, order));
    if (offenders.length) {
        D.showToast('Blocked: these numeric fields are empty and WILL crash BlindIQ\'s importer (Error 13): ' + offenders.join(', '), 'error');
        return;
    }
    const go = () => {
        const learned = biqLearnFromAI(MAPS, order);
        if (learned.length) {
            const cats = [...new Set(learned.map(l => l.cat))];
            cats.forEach(c => saveCategory(c));
            D.showToast('Learned ' + learned.length + ' AI match(es) - future orders with this wording resolve automatically.', 'success');
        }
        const blob = new Blob([biqGenerateXML(MAPS, order)], { type: 'text/xml' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = 'BlindIQ_Import_' + (order.orderNumber || 'order').replace(/[^\w\-]+/g, '_') + '.xml'; a.click();
    };
    if (probs.length) D.showConfirmModal(`This order still has ${probs.length} unresolved issue(s) — the XML will contain blank IDs and may fail to import. Download anyway?`, go);
    else go();
}

// ---------------------------------------------------------------- name pickers (discernment UX)
// Returns [[displayName, id], ...] for a category, ranges scoped to a blind type when known.
function biqTitle(s) { return String(s).replace(/\b[a-z]/g, c => c.toUpperCase()); }
function nameOptionsFor(cat, scopeBlindType) {
    if (cat === 'customers') return Object.entries(MAPS.customers || {}).map(([k, v]) => [k, v]);
    if (cat === 'sundries') return Object.entries(MAPS.sundries || {}).map(([k, v]) => [k, v]);
    let pairs;
    if (cat === 'ranges') {
        pairs = []; const bt = biqResolve(MAPS, 'blindTypes', scopeBlindType);
        for (const [k, v] of Object.entries(MAPS.rangesScoped || {})) {
            const i = k.indexOf('|');
            if (!bt.known || k.slice(0, i) === String(bt.id)) pairs.push([k.slice(i + 1), v]);
        }
        for (const [k, v] of Object.entries(MAPS.ranges || {})) pairs.push([k, v]);
    } else if (cat === 'colours') {
        pairs = Object.entries(MAPS.colours || {}).map(([k, v]) => [k.startsWith('|') ? k.slice(1) : k, v]);
    } else {
        pairs = Object.entries(MAPS[cat] || {}).map(([k, v]) => [k, v]);
    }
    return pairs.map(([n, v]) => [biqTitle(n), v]);  // proper-case display so applied values look clean
}
function biqSearchNames(cat, scopeBlindType, query) {
    const tokens = biqLc(query).split(/\s+/).filter(Boolean);
    let opts = nameOptionsFor(cat, scopeBlindType);
    if (tokens.length) opts = opts.filter(([n]) => { const nl = biqLc(n); return tokens.every(t => nl.includes(t)); });
    opts.sort((a, b) => {
        const sa = tokens.length && biqLc(a[0]).startsWith(tokens[0]) ? 0 : 1;
        const sb = tokens.length && biqLc(b[0]).startsWith(tokens[0]) ? 0 : 1;
        return sa - sb || a[0].localeCompare(b[0]);
    });
    return opts.slice(0, 30);
}
function renderPickResults(cat, scopeBlindType) {
    const el = $('biq-as-results'); if (!el) return;
    const q = $('biq-as-pick') ? $('biq-as-pick').value : '';
    const hits = biqSearchNames(cat, scopeBlindType, q);
    if (!hits.length) {
        el.innerHTML = `<div class="p-2 text-sm text-slate-400">No matches${q ? ' for "' + escH(q) + '" — check spelling or try fewer words' : ''}.</div>`;
        return;
    }
    el.innerHTML = hits.map(([n, v]) => {
        const idtxt = (typeof v === 'object')
            ? (v.sundry != null ? 'sundry ' + v.sundry + ' · type ' + v.type
                : 'cust ' + v.customer + (v.address ? ' · addr ' + v.address : '') + (v.ops && v.ops.length ? ' · ' + v.ops.length + ' operators' : (v.operator ? ' · op ' + v.operator : '')))
            : 'ID ' + v;
        return `<div class="biq-pickrow flex justify-between items-center px-2 py-1 cursor-pointer hover:bg-indigo-50 border-b border-slate-100" data-biq-pickval="${escH(n)}">
            <span class="text-sm">${escH(n)}</span><span class="text-xs text-slate-400 whitespace-nowrap pl-3">${escH(idtxt)}</span></div>`;
    }).join('');
}
function applyPick(name) {
    if (!assignCtx) return;
    const { cat, scopeBlindType } = assignCtx;
    if ($('biq-as-pick')) $('biq-as-pick').value = name;
    if (cat === 'sundries') {
        const e = (MAPS.sundries || {})[biqLc(name)];
        if (e) { $('biq-as-styp').value = e.type; $('biq-as-sid').value = e.sundry; $('biq-as-sname').value = name; }
        renderPickResults(cat, assignCtx.scopeBlindType);
        return;
    }
    if (cat === 'customers') {
        const e = MAPS.customers[biqLc(name)];
        if (e) {
            $('biq-as-c').value = e.customer; $('biq-as-a').value = e.address || '';
            $('biq-as-o').outerHTML = (e.ops && e.ops.length)
                ? `<select id="biq-as-o" class="biq-in flex-1"><option value="">— choose operator —</option>${e.ops.map(o => `<option value="${o[0]}">${escH(o[1])} (${o[0]})</option>`).join('')}</select>`
                : `<input id="biq-as-o" class="biq-in flex-1" placeholder="Operator ID" value="${escH(e.operator || '')}">`;
        }
    } else if (cat === 'sundries') {
        const e = (MAPS.sundries || {})[biqLc(name)];
        if (e) { $('biq-as-styp').value = e.type; $('biq-as-sid').value = e.sundry; $('biq-as-sname').value = name; }
    } else {
        const hit = nameOptionsFor(cat, scopeBlindType).find(([n]) => n === biqLc(name));
        if (hit) $('biq-as-id').value = hit[1];
    }
    renderPickResults(cat, scopeBlindType);
}
function fillPickDatalist(cat, scopeBlindType, filter) {
    const dl = $('biq-as-dl'); if (!dl) return;
    const f = biqLc(filter);
    const opts = nameOptionsFor(cat, scopeBlindType)
        .filter(([n]) => !f || n.includes(f))
        .slice(0, 50);
    dl.innerHTML = opts.map(([n, v]) => `<option value="${escH(n)}">${escH('ID ' + (typeof v === 'object' ? v.customer : v))}</option>`).join('');
}
function renderStaticDatalists() {
    const mk = (id, cat) => {
        let dl = $(id);
        if (!dl) { dl = document.createElement('datalist'); dl.id = id; document.body.appendChild(dl); }
        dl.innerHTML = Object.keys(MAPS[cat] || {}).slice(0, 400).map(k => `<option value="${escH(k)}">`).join('');
    };
    mk('biq-dl-bt', 'blindTypes'); mk('biq-dl-fix', 'fixes'); mk('biq-dl-c1', 'control1'); mk('biq-dl-c2', 'control2');
    mk('biq-dl-dm', 'deliveryMethods'); mk('biq-dl-pt', 'packingTypes');
}

// ---------------------------------------------------------------- assign / split / mappings modals
let copySrc = null;
function openCopyOptions(srcIdx) {
    copySrc = srcIdx;
    const src = order.items[srcIdx];
    const setOpts = src.variants.filter(v => biqNorm(v[1]));
    const srcBt = biqLc(src.blindType);
    const rows = order.items.map((it, i) => i === srcIdx ? '' :
        `<label class="flex items-center gap-2 py-1 text-sm ${biqLc(it.blindType) !== srcBt ? 'text-amber-700' : ''}">
            <input type="checkbox" value="${i}" ${biqLc(it.blindType) === srcBt ? 'checked' : ''}>
            <b>${escH(it.code || (i + 1))}</b> — ${escH(it.blindType || '?')}${it.location ? ' — ' + escH(it.location) : ''}${biqLc(it.blindType) !== srcBt ? ' (different blind type)' : ''}
        </label>`).join('');
    $('biq-copy-note').innerHTML = `Copy the <b>${setOpts.length}</b> set option(s) from line <b>${escH(src.code || (srcIdx + 1))}</b> (${escH(src.blindType || '?')}) to:`;
    $('biq-copy-targets').innerHTML = rows || '<div class="text-slate-400 text-sm">No other lines.</div>';
    $('biq-copy-overwrite').checked = false;
    show('biq-copymodal');
}
function applyCopyOptions() {
    const targets = [...document.querySelectorAll('#biq-copy-targets input[type=checkbox]:checked')].map(cb => +cb.value);
    if (!targets.length) { D.showToast('Pick at least one line to copy to.', 'error'); return; }
    const overwrite = $('biq-copy-overwrite').checked;
    const n = biqCopyOptions(order, copySrc, targets, { overwrite });
    hide('biq-copymodal');
    refresh();
    D.showToast('Copied options to ' + targets.length + ' line(s) (' + n + ' value' + (n === 1 ? '' : 's') + ' set).', 'success');
}
// Per-field catalogue search: find the correct product and APPLY it to this line
// (sets the field value, resolves to the ID, and learns the customer's wording).
function openProductPicker(idx, field) {
    const it = order.items[idx]; if (!it) return;
    const cat = BIQ_FIELD_CAT[field];
    const scope = field === 'range' ? it.blindType : null;
    const original = (it._aiOrig && it._aiOrig[field] !== undefined) ? it._aiOrig[field] : it[field];
    assignCtx = { cat, scopeBlindType: scope, product: true, idx, field, original };
    const label = (BIQ_MAPPING_CATEGORIES[cat] || {}).label || field;
    const revert = (it._ai && it._ai[field]) ? ` <span class="biq-fixlink" data-biq-prodrevert="${idx}:${field}">↩ undo AI, keep "${escH(original)}"</span>` : '';
    $('biq-as-note').innerHTML = `Search the BlindIQ <b>${escH(label.toLowerCase())}</b> and click the correct one — it will be applied to this line and remembered for "<b>${escH(original)}</b>".${revert}`;
    $('biq-as-fields').innerHTML = `<div class="w-full">
        <input id="biq-as-pick" class="biq-in w-full mb-1" placeholder="Search ${escH(label.toLowerCase())}… (any words)" value="${escH(it[field] || '')}" autocomplete="off">
        <div id="biq-as-results" class="border border-slate-200 rounded-md max-h-56 overflow-auto bg-white"></div></div>`;
    $('biq-as-save').style.display = 'none';
    renderPickResults(cat, scope);
    $('biq-as-pick').addEventListener('input', () => renderPickResults(cat, scope));
    show('biq-assignmodal'); setTimeout(() => $('biq-as-pick').focus(), 50);
}
function applyProductPick(name) {
    if (!assignCtx || !assignCtx.product) return;
    const { idx, field, cat, original } = assignCtx;
    const it = order.items[idx]; if (!it) return;
    it[field] = name;
    // resolve the picked name's ID, then learn the original customer wording -> that ID
    let res, id;
    if (field === 'range') { res = biqResolveRange(MAPS, it.blindType, name); id = res.id; }
    else if (field === 'colour') { res = biqResolveColour(MAPS, it.range, name); id = res.id; }
    else { res = biqResolve(MAPS, cat, name); id = res.id; }
    if (id != null && biqLc(original) && biqLc(original) !== biqLc(name)) {
        let saved = null;
        if (field === 'range') { const bt = biqResolve(MAPS, 'blindTypes', it.blindType); if (bt.known) { MAPS.rangesScoped[bt.id + '|' + biqLc(original)] = id; saved = 'rangesScoped'; } }
        else if (field === 'colour') { MAPS.colours['|' + biqLc(original)] = id; saved = 'colours'; }
        else { MAPS[cat][biqLc(original)] = id; saved = cat; }
        if (saved) saveCategory(saved);
    }
    if (it._ai) delete it._ai[field];
    if (it._aiOrig) delete it._aiOrig[field];
    hide('biq-assignmodal'); assignCtx = null;
    $('biq-as-save').style.display = '';
    refresh();
    D.showToast('Applied "' + name + '"' + (id != null && biqLc(original) !== biqLc(name) ? ' and learned "' + original + '" for next time.' : '.'), 'success');
}
function openAssign(cat, name, scopeBlindType, sundryRow) {
    $('biq-as-save').style.display = '';
    assignCtx = { cat, name, scopeBlindType: scopeBlindType, sundryRow };
    const meta = BIQ_MAPPING_CATEGORIES[cat];
    if (cat === 'sundries') {
        $('biq-as-note').innerHTML = `Search the ${Object.keys(MAPS.sundries || {}).length} BlindIQ sundries (motors, remotes, adapters, components…) by name or stock code. Click a result, then Save to fill the line.`;
        $('biq-as-fields').innerHTML = `<div class="w-full">
            <input id="biq-as-pick" class="biq-in w-full mb-1" placeholder="Search sundries… (any words, any order)" value="${escH(name || '')}" autocomplete="off">
            <div id="biq-as-results" class="border border-slate-200 rounded-md max-h-44 overflow-auto mb-2 bg-white"></div>
            <div class="flex gap-2"><input id="biq-as-styp" class="biq-in" style="width:110px" placeholder="Type ID"><input id="biq-as-sid" class="biq-in" style="width:110px" placeholder="Sundry ID"><input id="biq-as-sname" class="biq-in flex-1" placeholder="Description" value="${escH(name || '')}"></div></div>`;
        renderPickResults('sundries', null);
        $('biq-as-pick').addEventListener('input', () => renderPickResults('sundries', null));
        show('biq-assignmodal'); setTimeout(() => $('biq-as-pick').focus(), 50);
        return;
    }
    if (cat === 'customers') {
        const key = biqLc(name);
        const cur = MAPS.customers[key] || { customer: '', address: '', operator: '' };
        $('biq-as-note').innerHTML = `Name on order: <b>${escH(name)}</b><br>Start typing to pick the matching BlindIQ customer account — IDs, default delivery and operator come along automatically. Saved for the whole team.`;
        const opSelect = (e) => (e && e.ops && e.ops.length)
            ? `<select id="biq-as-o" class="biq-in flex-1"><option value="">— choose operator —</option>${e.ops.map(o => `<option value="${o[0]}" ${String(e.operator) === String(o[0]) ? 'selected' : ''}>${escH(o[1])} (${o[0]})</option>`).join('')}</select>`
            : `<input id="biq-as-o" class="biq-in flex-1" placeholder="Operator ID" value="${escH(e ? e.operator : '')}">`;
        $('biq-as-fields').innerHTML = `<div class="w-full">
            <input id="biq-as-pick" class="biq-in w-full mb-1" placeholder="Search the ${Object.keys(MAPS.customers).length} BlindIQ customers… (any words, any order)" value="${escH(MAPS.customers[key] ? key : '')}" autocomplete="off">
            <div id="biq-as-results" class="border border-slate-200 rounded-md max-h-44 overflow-auto mb-2 bg-white"></div>
            <div class="flex gap-2">
              <input id="biq-as-c" class="biq-in flex-1" placeholder="Customer ID" value="${escH(cur.customer)}">
              <input id="biq-as-a" class="biq-in flex-1" placeholder="Address ID" value="${escH(cur.address)}">
              ${opSelect(MAPS.customers[key])}
            </div></div>`;
        renderPickResults('customers', null);
        $('biq-as-pick').addEventListener('input', () => renderPickResults('customers', null));
    } else {
        const cur = MAPS[cat] && MAPS[cat][biqLc(name)];
        $('biq-as-note').innerHTML = `<b>${escH(meta.label)}</b> → <code>${escH(meta.xml)}</code><br>Name on order: <b>${escH(name)}</b>${cat === 'ranges' && scopeBlindType ? ` &nbsp;·&nbsp; blind type: <b>${escH(scopeBlindType)}</b>` : ''}<br>Pick the matching BlindIQ name (the ID fills in automatically), or type the ID directly.`;
        $('biq-as-fields').innerHTML = `<div class="w-full"><input id="biq-as-pick" class="biq-in w-full mb-1" placeholder="Search BlindIQ ${escH(meta.label.toLowerCase())}… (any words, any order)" autocomplete="off">
            <div id="biq-as-results" class="border border-slate-200 rounded-md max-h-44 overflow-auto mb-2 bg-white"></div>
            <input id="biq-as-id" class="biq-in" style="width:140px" placeholder="BlindIQ ID" value="${cur != null ? escH(cur) : ''}"></div>`;
        renderPickResults(cat, scopeBlindType);
        $('biq-as-pick').addEventListener('input', () => renderPickResults(cat, scopeBlindType));
    }
    show('biq-assignmodal'); setTimeout(() => { const e = $('biq-as-pick') || $('biq-as-id'); e && e.focus(); }, 50);
}
async function saveAssign() {
    if (!assignCtx) return;
    const { cat, name } = assignCtx;
    if (cat === 'sundries') {
        const ty = val('biq-as-styp'), sid = val('biq-as-sid'), nm = val('biq-as-sname');
        if (!/^\d+$/.test(ty) || !/^\d+$/.test(sid)) { D.showToast('Pick a sundry from the list (or enter both IDs).', 'error'); return; }
        if (assignCtx.sundryRow != null && order && order.sundries[assignCtx.sundryRow]) {
            const su = order.sundries[assignCtx.sundryRow];
            su.type = ty; su.sundry = sid; if (nm) su.notes = nm;
            // learn the dealer's phrasing: next time this exact text auto-resolves
            const srcTxt = biqLc(su._src || name || '');
            if (srcTxt && !(MAPS.sundries || {})[srcTxt]) { MAPS.sundries[srcTxt] = { sundry: +sid, type: +ty }; await saveCategory('sundries'); }
        }
        hide('biq-assignmodal'); assignCtx = null; refresh();
        return;
    }
    if (cat === 'customers') {
        const c = val('biq-as-c'), a = val('biq-as-a'), o = val('biq-as-o');
        if (!/^\d+$/.test(c) || !/^\d+$/.test(a)) { D.showToast('Customer ID and Address ID must be numbers.', 'error'); return; }
        if (o && !/^\d+$/.test(o)) { D.showToast('Operator ID must be a number (or leave it empty — it\'s optional).', 'error'); return; }
        const pickedKey = biqLc($('biq-as-pick') ? $('biq-as-pick').value : '');
        const srcKey = biqLc(name);
        if (pickedKey && MAPS.customers[pickedKey] && !MAPS.customers[pickedKey].alias && pickedKey !== srcKey) {
            // one name per account: source phrasing becomes a pointer; edits update the canonical record
            MAPS.customers[pickedKey] = Object.assign({}, MAPS.customers[pickedKey], { customer: +c, address: +a, operator: o ? +o : (MAPS.customers[pickedKey].operator || '') });
            MAPS.customers[srcKey] = { alias: pickedKey };
        } else {
            MAPS.customers[srcKey] = Object.assign({}, MAPS.customers[srcKey] || {}, { customer: +c, address: +a, operator: o ? +o : '' });
            delete MAPS.customers[srcKey].alias;
        }
    } else {
        const v = val('biq-as-id');
        if (!/^-?\d+$/.test(v)) { D.showToast('The BlindIQ ID must be a number.', 'error'); return; }
        MAPS[cat][biqLc(name)] = +v;
    }
    await saveCategory(cat);
    hide('biq-assignmodal'); assignCtx = null; refresh();
}
function openFabricSplit(i) {
    const it = order.items[i]; if (!it) return;
    const fabric = biqNorm(it._origFabric || it.range);
    fsCtx = { i, fabric, words: fabric.split(' '), cut: 0 };
    const fl = biqLc(fabric);
    fsCtx.blindType = it.blindType;
    for (const r of biqRangeNamesFor(MAPS, it.blindType)) {
        if (fl.startsWith(r + ' ')) { fsCtx.cut = r.split(' ').length; break; }
    }
    if (!fsCtx.cut) fsCtx.cut = Math.max(1, fsCtx.words.length - 2);
    renderFsWords(); show('biq-fsplitmodal');
}
function renderFsWords() {
    $('biq-fs-words').innerHTML = fsCtx.words.map((w, k) =>
        `<button class="biq-btn-sm ${k < fsCtx.cut ? 'biq-btn-on' : ''}" data-biq-fscut="${k + 1}">${escH(w)}</button>`).join(' ');
    const range = fsCtx.words.slice(0, fsCtx.cut).join(' ');
    const colour = fsCtx.words.slice(fsCtx.cut).join(' ');
    $('biq-fs-range').textContent = range || '—'; $('biq-fs-colour').textContent = colour || '—';
    const rr = biqResolveRange(MAPS, fsCtx.blindType, range); $('biq-fs-rid').value = rr.known ? rr.id : '';
    const rc = biqResolveColour(MAPS, range, colour); $('biq-fs-cid').value = rc.known ? rc.id : '';
}
async function saveFabricSplit() {
    if (!fsCtx) return;
    const range = fsCtx.words.slice(0, fsCtx.cut).join(' ');
    const colour = fsCtx.words.slice(fsCtx.cut).join(' ');
    const rid = val('biq-fs-rid'), cid = val('biq-fs-cid');
    if (rid && !/^-?\d+$/.test(rid)) { D.showToast('Range ID must be a number (or leave empty).', 'error'); return; }
    if (cid && !/^-?\d+$/.test(cid)) { D.showToast('Colour ID must be a number (or leave empty).', 'error'); return; }
    MAPS.fabricSplits[biqLc(fsCtx.fabric)] = { range, colour };
    const saves = [saveCategory('fabricSplits')];
    if (rid) { MAPS.ranges[biqLc(range)] = +rid; saves.push(saveCategory('ranges')); }
    if (cid && colour) { MAPS.colours[biqLc(range) + '|' + biqLc(colour)] = +cid; saves.push(saveCategory('colours')); }
    order.items.forEach(it => { if (biqLc(it._origFabric || '') === biqLc(fsCtx.fabric)) { it.range = range; it.colour = colour; } });
    await Promise.all(saves);
    hide('biq-fsplitmodal'); fsCtx = null; refresh();
}
function openMappings() { renderMapTabs(); renderMapBody(); show('biq-mapmodal'); }
function renderMapTabs() {
    $('biq-mtabs').innerHTML = Object.keys(BIQ_MAPPING_CATEGORIES).filter(c => c !== 'fabricSplits').map(c =>
        `<button class="biq-btn-sm ${c === mapTab ? 'biq-btn-on' : ''}" data-biq-maptab="${c}">${BIQ_MAPPING_CATEGORIES[c].label.split(' (')[0]}</button>`).join(' ');
}
function renderMapBody() {
    const cat = mapTab, meta = BIQ_MAPPING_CATEGORIES[cat];
    let h = `<div class="text-xs text-slate-500 mb-2">XML field: <code>${escH(meta.xml)}</code> — changes sync live to every PC via Firestore.</div>`;
    if (cat === 'customers') {
        h += '<table class="biq-maptable"><tr><th>Customer name</th><th>Customer ID</th><th>Address ID</th><th>Operator ID</th><th></th></tr>';
        for (const [k, v] of Object.entries(MAPS.customers)) h += `<tr><td>${escH(k)}</td><td>${escH(v.customer)}</td><td>${escH(v.address)}</td><td>${escH(v.operator)}</td><td><button class="biq-btn-sm biq-btn-danger" data-biq-delmap='${escH(JSON.stringify([cat, k]))}'>✕</button></td></tr>`;
        h += `<tr><td><input id="biq-nm-name" class="biq-in w-full" placeholder="new customer name"></td><td><input id="biq-nm-c" class="biq-in" style="width:80px"></td><td><input id="biq-nm-a" class="biq-in" style="width:80px"></td><td><input id="biq-nm-o" class="biq-in" style="width:80px"></td><td><button class="biq-btn-sm biq-btn-on" id="biq-addcust">Add</button></td></tr></table>`;
    } else {
        const entries = Object.entries(MAPS[cat] || {});
        const filter = biqLc(($('biq-mapsearch') && mapTab === $('biq-mapsearch').dataset.cat) ? $('biq-mapsearch').value : '');
        const shown = entries.filter(([k]) => !filter || k.includes(filter)).slice(0, 150);
        if (entries.length > 150) h += `<input id="biq-mapsearch" data-cat="${cat}" class="biq-in w-full mb-2" placeholder="Search ${entries.length} entries…" value="${escH(filter)}">`;
        h += '<table class="biq-maptable"><tr><th>Name on order forms' + (cat === 'colours' ? ' (range|colour)' : '') + '</th><th>BlindIQ ID</th><th></th></tr>';
        for (const [k, v] of shown) h += `<tr><td>${escH(k)}</td><td>${escH(typeof v === 'object' ? JSON.stringify(v) : v)}</td><td><button class="biq-btn-sm biq-btn-danger" data-biq-delmap='${escH(JSON.stringify([cat, k]))}'>✕</button></td></tr>`;
        if (entries.length > shown.length && !filter) h += `<tr><td colspan="3" class="text-slate-400">…${entries.length - shown.length} more — use search</td></tr>`;
        h += `<tr><td><input id="biq-nm-name" class="biq-in w-full" placeholder="new name"></td><td><input id="biq-nm-id" class="biq-in" style="width:80px" placeholder="ID"></td><td><button class="biq-btn-sm biq-btn-on" id="biq-addmap">Add</button></td></tr></table>`;
        h += `<div class="text-xs text-slate-500 mt-3 mb-1"><b>Bulk paste</b> — one per line: "Name, ID" / "Name = ID" / tab-separated (straight from Excel):</div>
              <textarea id="biq-bulk" class="biq-in w-full" rows="4"></textarea>
              <button class="biq-btn-sm biq-btn-on mt-1" id="biq-bulkbtn">Import pasted lines</button>`;
    }
    $('biq-mapbody').innerHTML = h;
}
function show(id) { $(id).classList.remove('hidden'); $(id).classList.add('flex'); }
function hide(id) { $(id).classList.add('hidden'); $(id).classList.remove('flex'); }

// ---------------------------------------------------------------- init
export function initBiqConverter(deps) {
    D = deps;
    injectMarkup();
    bindEvents();
    loadMappings();
}
function bindEvents() {
    const root = $('biq-converter-content');
    // file intake
    const dz = $('biq-dropzone'), fp = $('biq-fpick');
    ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag-over'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag-over'); }));
    dz.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
    // (no click handler needed — the drop zone is a <label> wrapping the file input)
    fp.addEventListener('change', e => { handleFiles(e.target.files); fp.value = ''; });
    $('biq-newblank').addEventListener('click', newBlankOrder);
    $('biq-openmaps').addEventListener('click', openMappings);
    $('biq-additem').addEventListener('click', () => { order = order || biqBlankOrder(); order.items.push(biqBlankItem()); $('biq-editor').classList.remove('hidden'); refresh(); });
    $('biq-addsundry').addEventListener('click', () => { if (!order) return; order.sundries.push({ code: '', qty: '1', type: '', sundry: '', notes: '' }); refresh(); });
    $('biq-runchecks').addEventListener('click', runChecks);
    $('biq-aimatch').addEventListener('click', () => aiDiscern(true));
    $('biq-help').addEventListener('click', () => { $('biq-helppanel').classList.toggle('hidden'); fitCollapsible(); });
    $('biq-helpclose').addEventListener('click', () => { $('biq-helppanel').classList.add('hidden'); fitCollapsible(); });
    $('biq-download').addEventListener('click', downloadXML);
    $('biq-copyxml').addEventListener('click', () => { navigator.clipboard.writeText(biqGenerateXML(MAPS, order)).then(() => D.showToast('XML copied.', 'success')); });
    $('biq-reqplus').addEventListener('click', () => { const base = val('biq-h-orderdate') || new Date().toISOString().slice(0, 10); const d = new Date(base); d.setDate(d.getDate() + 14); $('biq-h-reqdate').value = d.toISOString().slice(0, 10); refresh(); });
    // tab switch preview/xml
    $('biq-tab-prev').addEventListener('click', () => { $('biq-preview').classList.remove('hidden'); $('biq-xmlwrap').classList.add('hidden'); $('biq-tab-prev').classList.add('biq-btn-on'); $('biq-tab-xml').classList.remove('biq-btn-on'); });
    $('biq-tab-xml').addEventListener('click', () => { $('biq-preview').classList.add('hidden'); $('biq-xmlwrap').classList.remove('hidden'); $('biq-tab-xml').classList.add('biq-btn-on'); $('biq-tab-prev').classList.remove('biq-btn-on'); });
    // header inputs
    root.querySelectorAll('.biq-h').forEach(el => el.addEventListener('input', scheduleRefresh));
    // mappings search (lives inside the modal, delegated)
    document.addEventListener('input', e => { if (e.target.id === 'biq-mapsearch') { const v = e.target.value, p = e.target.selectionStart; renderMapBody(); const el = $('biq-mapsearch'); if (el) { el.value = v; el.focus(); el.setSelectionRange(p, p); } } });
    // delegated grid events
    root.addEventListener('change', e => {
        const t = e.target;
        if (t.dataset.biqItem != null && t.dataset.biqField) {
            const it = order.items[+t.dataset.biqItem];
            it[t.dataset.biqField] = t.value;
            if (it._ai && it._ai[t.dataset.biqField]) delete it._ai[t.dataset.biqField]; // manual edit overrides AI
            if (t.dataset.biqField === 'controlDrop') it._cdAuto = !t.value.trim();
            if (t.dataset.biqField === 'blindType') { if (!it.variants.length) it.variants = biqTemplateFor2(MAPS, it.blindType); else biqMergeTemplate(MAPS, it); }
            refresh();
        }
        else if (t.dataset.biqSundry != null && t.dataset.biqField) {
            const su = order.sundries[+t.dataset.biqSundry];
            su[t.dataset.biqField] = t.value;
            if (t.dataset.biqField === 'notes') {
                const hit = biqResolveSundry(MAPS, t.value);
                if (hit) { su.sundry = String(hit.sundry); su.type = String(hit.type); D.showToast('Sundry recognised — IDs filled in.', 'success'); }
            }
            refresh();
        }
        else if (t.dataset.biqVar) { const [i, vi, w] = t.dataset.biqVar.split(':'); order.items[+i].variants[+vi][+w] = t.value; scheduleRefresh(); }
    });
    document.addEventListener('click', e => {
        const t = e.target.closest('[data-biq-assign],[data-biq-pickval],[data-biq-sundrysearch],[data-biq-split],[data-biq-togglevars],[data-biq-delitem],[data-biq-addvar],[data-biq-delvar],[data-biq-delsundry],[data-biq-fscut],[data-biq-maptab],[data-biq-delmap],[data-biq-acceptai],[data-biq-revertai],[data-biq-prodsearch],[data-biq-prodrevert],[data-biq-copyopts],#biq-addmap,#biq-addcust,#biq-bulkbtn,#biq-copy-apply,#biq-copy-cancel,#biq-copy-all,#biq-copy-same');
        if (!t) return;
        if (t.dataset.biqAssign) { const [c, n, bt] = JSON.parse(t.dataset.biqAssign); openAssign(c, n, bt); }
        else if (t.dataset.biqPickval != null) { if (assignCtx && assignCtx.product) applyProductPick(t.dataset.biqPickval); else applyPick(t.dataset.biqPickval); }
        else if (t.dataset.biqSundrysearch != null) { const i = +t.dataset.biqSundrysearch; openAssign('sundries', order.sundries[i].notes || '', null, i); }
        else if (t.dataset.biqCopyopts != null) openCopyOptions(+t.dataset.biqCopyopts);
        else if (t.id === 'biq-copy-cancel') hide('biq-copymodal');
        else if (t.id === 'biq-copy-all') document.querySelectorAll('#biq-copy-targets input[type=checkbox]').forEach(cb => cb.checked = true);
        else if (t.id === 'biq-copy-same') { const bt = biqLc(order.items[copySrc] ? order.items[copySrc].blindType : ''); document.querySelectorAll('#biq-copy-targets input[type=checkbox]').forEach(cb => cb.checked = biqLc(order.items[+cb.value].blindType) === bt); }
        else if (t.id === 'biq-copy-apply') applyCopyOptions();
        else if (t.dataset.biqProdsearch) { const [i, f] = t.dataset.biqProdsearch.split(':'); openProductPicker(+i, f); }
        else if (t.dataset.biqProdrevert) { const [i, f] = t.dataset.biqProdrevert.split(':'); const it = order.items[+i]; if (it._ai && it._ai[f]) { if (it._aiOrig && it._aiOrig[f] !== undefined) it[f] = it._aiOrig[f]; delete it._ai[f]; delete it._aiOrig[f]; } hide('biq-assignmodal'); assignCtx = null; $('biq-as-save').style.display = ''; refresh(); }
        else if (t.dataset.biqAcceptai) { const [i, f] = t.dataset.biqAcceptai.split(':'); biqAcceptSuggestion(order, +i, f); refresh(); }
        else if (t.dataset.biqRevertai) { const [i, f] = t.dataset.biqRevertai.split(':'); const it = order.items[+i]; if (it._ai && it._ai[f]) { if (it._aiOrig && it._aiOrig[f] !== undefined) it[f] = it._aiOrig[f]; delete it._ai[f]; } refresh(); }
        else if (t.dataset.biqSplit != null) openFabricSplit(+t.dataset.biqSplit);
        else if (t.dataset.biqTogglevars != null) { const it = order.items[+t.dataset.biqTogglevars]; it.open = !it.open; renderItems(); }
        else if (t.dataset.biqDelitem != null) { order.items.splice(+t.dataset.biqDelitem, 1); refresh(); }
        else if (t.dataset.biqAddvar != null) { order.items[+t.dataset.biqAddvar].variants.push(['', '']); renderItems(); }
        else if (t.dataset.biqDelvar) { const [i, vi] = t.dataset.biqDelvar.split(':'); order.items[+i].variants.splice(+vi, 1); renderItems(); }
        else if (t.dataset.biqDelsundry != null) { order.sundries.splice(+t.dataset.biqDelsundry, 1); refresh(); }
        else if (t.dataset.biqFscut) { fsCtx.cut = +t.dataset.biqFscut; renderFsWords(); }
        else if (t.dataset.biqMaptab) { mapTab = t.dataset.biqMaptab; renderMapTabs(); renderMapBody(); }
        else if (t.dataset.biqDelmap) { const [c, k] = JSON.parse(t.dataset.biqDelmap); delete MAPS[c][k]; saveCategory(c); renderMapBody(); if (order) refresh(); }
        else if (t.id === 'biq-addmap') { const n = biqLc($('biq-nm-name').value), v = val('biq-nm-id'); if (!n || !/^-?\d+$/.test(v)) { D.showToast('Enter a name and numeric ID.', 'error'); return; } MAPS[mapTab][n] = +v; saveCategory(mapTab); renderMapBody(); if (order) refresh(); }
        else if (t.id === 'biq-addcust') { const n = biqLc($('biq-nm-name').value), c = val('biq-nm-c'), a = val('biq-nm-a'), o = val('biq-nm-o'); if (!n || !/^\d+$/.test(c) || !/^\d+$/.test(a) || !/^\d+$/.test(o)) { D.showToast('Enter a name and three numeric IDs.', 'error'); return; } MAPS.customers[n] = { customer: +c, address: +a, operator: +o }; saveCategory('customers'); renderMapBody(); if (order) refresh(); }
        else if (t.id === 'biq-bulkbtn') { let n = 0; $('biq-bulk').value.split(/\n/).forEach(l => { const m = l.match(/^\s*(.+?)\s*[,=\t]\s*(-?\d+)\s*$/); if (m) { MAPS[mapTab][biqLc(m[1])] = +m[2]; n++; } }); saveCategory(mapTab); renderMapBody(); if (order) refresh(); D.showToast(n + ' mapping(s) imported.', 'success'); }
    });
    // modal buttons
    $('biq-as-save').addEventListener('click', saveAssign);
    $('biq-as-cancel').addEventListener('click', () => { hide('biq-assignmodal'); assignCtx = null; $('biq-as-save').style.display = ''; });
    $('biq-fs-save').addEventListener('click', saveFabricSplit);
    $('biq-fs-cancel').addEventListener('click', () => { hide('biq-fsplitmodal'); fsCtx = null; });
    $('biq-map-close').addEventListener('click', () => hide('biq-mapmodal'));
    $('biq-map-export').addEventListener('click', exportMappingsFile);
    $('biq-map-import').addEventListener('click', () => $('biq-mapimp').click());
    $('biq-mapimp').addEventListener('change', e => { importMappingsFile(e.target.files[0]); e.target.value = ''; });
}

// ---------------------------------------------------------------- markup
function injectMarkup() {
    const css = `<style id="biq-css">
#biq-converter-content .biq-in{padding:4px 6px;border:1px solid #cbd5e1;border-radius:5px;font-size:12.5px}
#biq-converter-content table.biq-items{width:100%;border-collapse:collapse;font-size:12px}
#biq-converter-content table.biq-items th{background:#f1f5f9;color:#475569;text-align:left;padding:5px 5px;border-bottom:2px solid #e2e8f0;font-size:10.5px;text-transform:uppercase;white-space:nowrap}
#biq-converter-content table.biq-items td{border-bottom:1px solid #f1f5f9;padding:3px 3px;vertical-align:top}
#biq-converter-content .biq-row-alert td{background:#fef2f2}
#biq-converter-content .biq-row-warn td{background:#fffbeb}
.biq-tag{display:inline-block;font-size:10px;border-radius:4px;padding:1px 5px;margin-top:2px;cursor:pointer;white-space:nowrap}
.biq-tag-ok{background:#dcfce7;color:#166534;border:1px solid #bbf7d0}
.biq-tag-miss{background:#fee2e2;color:#b91c1c;border:1px solid #fecaca;font-weight:700}
.biq-tag-na{background:#f1f5f9;color:#94a3b8;border:1px solid #e2e8f0}
#biq-converter-content .biq-row-ai td{background:#fffbeb}
.biq-ai{display:inline-block;font-size:10px;border-radius:4px;padding:1px 5px;margin-top:2px;margin-left:3px;cursor:pointer;white-space:nowrap}
.biq-ai-auto{background:#fef3c7;color:#92400e;border:1px solid #fde68a}
.biq-ai-sug{background:#ede9fe;color:#5b21b6;border:1px solid #ddd6fe;font-weight:600}
.biq-btn-sm{padding:3px 9px;font-size:12px;border:1px solid #cbd5e1;border-radius:5px;background:#fff;cursor:pointer}
.biq-btn-sm:hover{background:#f1f5f9}
.biq-btn-on{background:#4f46e5!important;border-color:#4f46e5!important;color:#fff!important}
.biq-btn-danger{color:#b91c1c;border-color:#fecaca}
.biq-fixlink{color:#4f46e5;cursor:pointer;text-decoration:underline}
.biq-varbox{background:#f8fafc;border:1px dashed #cbd5e1;border-radius:6px;margin:2px 0 6px;padding:6px 8px}
.biq-vk{flex:0 0 220px}
.biq-maptable{width:100%;border-collapse:collapse;font-size:12.5px}
.biq-maptable th{text-align:left;padding:4px 8px;background:#f1f5f9;font-size:10.5px;text-transform:uppercase;color:#475569}
.biq-maptable td{padding:3px 8px;border-bottom:1px solid #f1f5f9}
#biq-xmlout{white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,Consolas,monospace;font-size:11px;background:#0f172a;color:#cbe7f7;border-radius:8px;padding:12px;max-height:480px;overflow:auto}
</style>`;
    document.head.insertAdjacentHTML('beforeend', css);
    $('biq-converter-content').innerHTML = `
    <div class="p-4 border-t border-slate-200">
      <div class="flex flex-wrap gap-3 items-center mb-3">
        <label id="biq-dropzone" class="drop-zone !min-h-0 flex-1 p-4 rounded-lg flex flex-col items-center justify-center cursor-pointer bg-white shadow-sm text-center">
          <h3 class="text-base font-semibold text-slate-700">Drop a customer order here (any format)</h3>
          <p class="text-xs text-slate-500">Blind Guys .xlsx · Mathéo .pdf · BD order form .pdf — parsed instantly. Anything else (incl. scans & handwriting) → AI extraction.</p>
          <input type="file" id="biq-fpick" class="hidden" accept=".xlsx,.xls,.pdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.webp">
        </label>
        <div class="flex flex-col gap-2">
          <button id="biq-newblank" class="biq-btn-sm">+ New blank order</button>
          <button id="biq-openmaps" class="biq-btn-sm">⚙ BlindIQ ID mappings</button>
          <button id="biq-help" class="biq-btn-sm">❔ How to use</button>
        </div>
      </div>
      <div id="biq-status" class="text-sm font-semibold text-indigo-600 mb-2"></div>
      <div id="biq-helppanel" class="hidden mb-3 p-4 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-700">
        <div class="flex justify-between items-start"><h4 class="font-bold text-slate-800 mb-1">BlindIQ Order Converter — how it works</h4><button id="biq-helpclose" class="biq-btn-sm">Close</button></div>
        <p class="mb-2"><b>1. Drop the customer's order file</b> in the box above — Blind Guys spreadsheets, Mathéo PDFs and our own order forms are read instantly; anything else (incl. scans/photos) is read by AI. Or click <b>+ New blank order</b> to type one in.</p>
        <p class="mb-2"><b>2. Check the grid.</b> Each product name carries a tag:
          <span class="biq-tag biq-tag-ok">✓ 25</span> = mapped to a BlindIQ ID (good);
          <span class="biq-tag biq-tag-miss">? assign</span> = not known yet — click it to search &amp; pick the right BlindIQ name (remembered for next time);
          <span class="biq-ai biq-ai-auto">AI 96%</span> = AI matched it for you (amber row — <b>please glance and confirm</b>; click the chip to undo);
          <span class="biq-ai biq-ai-sug">AI? … - accept</span> = AI's best guess, click to accept.</p>
        <p class="mb-2"><b>3. Clear the red banner.</b> It lists everything still needed before import — required date is optional, but customer, sizes, and any unmapped names must be sorted. Motors/remotes/adapters appear as <b>Sundries</b>; the 🔍 button searches the parts catalogue. Adapter kits ask for a colour — that's expected.</p>
        <p class="mb-2"><b>4. Run torque &amp; spec checks</b> (optional) to catch fabric-width, chain-weight and motor-power issues before manufacturing.</p>
        <p class="mb-2"><b>5. Download .xml</b> and import it into BlindIQ. The download is blocked only if a numeric field is still empty (which would crash the importer).</p>
        <p class="mb-1 font-semibold text-slate-800">What it can&apos;t do (yet):</p>
        <ul class="list-disc pl-5 mb-1">
          <li>It won&apos;t pick the <b>customer/dealer account</b> for you — always search and select that yourself (one-time per customer).</li>
          <li>AI matches are <b>suggestions to verify</b>, not gospel — amber rows mean &quot;check me&quot;. When in doubt, open the order&apos;s original file (in the task repository) and compare.</li>
          <li><b>Handwriting</b> is read best-effort — always verify scanned/photographed orders field-by-field.</li>
          <li>It sets specs, not <b>prices or the required date</b> — those stay with you / BlindIQ.</li>
          <li>Every correction you make is <b>learned for the whole team</b>, so it gets smarter the more it&apos;s used.</li>
        </ul>
      </div>

      <div id="biq-editor" class="hidden">
        <div class="flex items-center gap-2 mb-2"><span class="bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-2 py-0.5 text-xs font-semibold" id="biq-srcbadge"></span></div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-1 text-xs">
          <div class="col-span-2"><label class="font-semibold text-slate-500">Customer (dealer)</label><input id="biq-h-customer" class="biq-in biq-h w-full"><div id="biq-custtag"></div></div>
          <div class="col-span-2"><label class="font-semibold text-slate-500">Order number / reference</label><input id="biq-h-ordernum" class="biq-in biq-h w-full"></div>
          <div><label class="font-semibold text-slate-500">Order date</label><input id="biq-h-orderdate" type="date" class="biq-in biq-h w-full"></div>
          <div><label class="font-semibold text-slate-500">Required date *</label><input id="biq-h-reqdate" type="date" class="biq-in biq-h w-full"><button id="biq-reqplus" class="biq-btn-sm mt-1">+14 days</button></div>
          <div><label class="font-semibold text-slate-500">Delivery method</label><input id="biq-h-delmethod" class="biq-in biq-h w-full" list="biq-dl-dm"><div id="biq-delmtag"></div></div>
          <div><label class="font-semibold text-slate-500">Packing type</label><input id="biq-h-packing" class="biq-in biq-h w-full" list="biq-dl-pt"><div id="biq-packtag"></div></div>
          <div class="col-span-2"><label class="font-semibold text-slate-500">End client / job</label><input id="biq-h-client" class="biq-in biq-h w-full"></div>
          <div><label class="font-semibold text-slate-500">BlindIQ Order ID</label><input id="biq-h-orderid" class="biq-in biq-h w-full" value="0" title="BlindIQ assigns the real ID on import"></div>
          <div class="col-span-2 md:col-span-3"><label class="font-semibold text-slate-500">Delivery address</label><textarea id="biq-h-address" rows="2" class="biq-in biq-h w-full"></textarea></div>
          <div class="col-span-2 md:col-span-4"><label class="font-semibold text-slate-500">Order notes</label><input id="biq-h-notes" class="biq-in biq-h w-full"></div>
        </div>

        <div class="flex items-center justify-between mt-3 mb-1">
          <h4 class="font-bold text-slate-700 text-sm">Blind items <span class="font-normal text-slate-400 text-xs">— click red tags to assign BlindIQ IDs (saved for everyone)</span></h4>
          <button id="biq-additem" class="biq-btn-sm">+ Add item</button>
        </div>
        <div class="overflow-x-auto"><table class="biq-items"><thead><tr>
          <th>Code</th><th>Qty</th><th>Location</th><th>Blind type</th><th>Range</th><th>Colour</th><th>Width</th><th>Drop</th><th>Fix</th><th>Control L</th><th>Control R</th><th>Ctrl drop</th><th></th>
        </tr></thead><tbody id="biq-itemrows"></tbody></table></div>

        <div class="flex items-center justify-between mt-3 mb-1">
          <h4 class="font-bold text-slate-700 text-sm">Sundries <span class="font-normal text-slate-400 text-xs">— IDs from BlindIQ (SundryType_Link / Sundry_Link)</span></h4>
          <button id="biq-addsundry" class="biq-btn-sm">+ Add sundry</button>
        </div>
        <div class="overflow-x-auto"><table class="biq-items"><thead><tr><th>Code</th><th>Qty</th><th>Type ID</th><th>Sundry ID</th><th>Notes</th><th></th></tr></thead><tbody id="biq-sundryrows"></tbody></table></div>

        <div id="biq-problems" class="mt-3"></div>

        <div class="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <div class="flex items-center justify-between">
            <h4 class="font-bold text-slate-700 text-sm">Torque & spec checks <span class="font-normal text-slate-400 text-xs">— uses your Fabric / Motor / Tube Properties</span></h4>
            <button id="biq-aimatch" class="bg-violet-600 text-white font-bold py-1.5 px-4 rounded-lg hover:bg-violet-700 text-sm mr-2">✨ AI match names</button><button id="biq-runchecks" class="bg-indigo-600 text-white font-bold py-1.5 px-4 rounded-lg hover:bg-indigo-700 text-sm">Run torque & spec checks</button>
          </div>
          <div id="biq-checks" class="mt-2"></div>
        </div>

        <div class="mt-4 flex gap-2 items-center">
          <button id="biq-tab-prev" class="biq-btn-sm biq-btn-on">Order preview</button>
          <button id="biq-tab-xml" class="biq-btn-sm">BlindIQ XML</button>
          <span class="flex-1"></span>
          <button id="biq-copyxml" class="biq-btn-sm">Copy XML</button>
          <button id="biq-download" class="bg-green-600 text-white font-bold py-1.5 px-5 rounded-lg hover:bg-green-700 text-sm">⬇ Download .xml</button>
        </div>
        <div id="biq-preview" class="mt-2"></div>
        <div id="biq-xmlwrap" class="mt-2 hidden"><div id="biq-xmlout"></div></div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', `
    <div id="biq-assignmodal" class="fixed inset-0 bg-black bg-opacity-50 z-50 hidden items-center justify-center p-4 modal-backdrop" role="dialog" aria-modal="true">
      <div class="modal-content bg-white rounded-lg shadow-xl w-full max-w-lg">
        <div class="p-5 border-b"><h3 class="text-lg font-semibold text-slate-800">Assign BlindIQ ID</h3><p id="biq-as-note" class="text-sm text-slate-500 mt-1"></p></div>
        <div class="p-5"><div id="biq-as-fields" class="flex gap-2"></div></div>
        <div class="px-5 py-3 bg-slate-50 rounded-b-lg flex justify-end gap-2">
          <button id="biq-as-cancel" class="biq-btn-sm">Cancel</button>
          <button id="biq-as-save" class="bg-indigo-600 text-white font-bold py-1.5 px-4 rounded-md hover:bg-indigo-700 text-sm">Save mapping</button>
        </div>
      </div>
    </div>
    <div id="biq-fsplitmodal" class="fixed inset-0 bg-black bg-opacity-50 z-50 hidden items-center justify-center p-4 modal-backdrop" role="dialog" aria-modal="true">
      <div class="modal-content bg-white rounded-lg shadow-xl w-full max-w-lg">
        <div class="p-5 border-b"><h3 class="text-lg font-semibold text-slate-800">Split fabric into range + colour</h3>
        <p class="text-sm text-slate-500 mt-1">Click the <b>last word of the RANGE</b> — everything after it becomes the colour.</p></div>
        <div class="p-5">
          <div id="biq-fs-words" class="flex flex-wrap gap-1 mb-3"></div>
          <div class="flex gap-4 text-sm mb-3"><div><b>Range:</b> <span id="biq-fs-range" class="text-indigo-600 font-bold">—</span></div><div><b>Colour:</b> <span id="biq-fs-colour" class="text-indigo-600 font-bold">—</span></div></div>
          <div class="flex gap-2"><input id="biq-fs-rid" class="biq-in flex-1" placeholder="BlindIQ Range ID (optional)"><input id="biq-fs-cid" class="biq-in flex-1" placeholder="BlindIQ Colour ID (optional)"></div>
          <p class="text-xs text-slate-400 mt-2">Once the Range ID is saved, every future fabric starting with this range splits automatically for the whole team.</p>
        </div>
        <div class="px-5 py-3 bg-slate-50 rounded-b-lg flex justify-end gap-2">
          <button id="biq-fs-cancel" class="biq-btn-sm">Cancel</button>
          <button id="biq-fs-save" class="bg-indigo-600 text-white font-bold py-1.5 px-4 rounded-md hover:bg-indigo-700 text-sm">Save split</button>
        </div>
      </div>
    </div>
    <div id="biq-mapmodal" class="fixed inset-0 bg-black bg-opacity-50 z-50 hidden items-start justify-center p-4 overflow-auto modal-backdrop" role="dialog" aria-modal="true">
      <div class="modal-content bg-white rounded-lg shadow-xl w-full max-w-4xl my-8">
        <div class="p-5 border-b flex items-center justify-between"><div><h3 class="text-lg font-semibold text-slate-800">BlindIQ ID mappings</h3>
          <p class="text-sm text-slate-500">Stored in Firestore — every change syncs live to all users.</p></div>
          <button id="biq-map-close" class="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button></div>
        <div class="p-5">
          <div class="flex gap-2 mb-3">
            <button id="biq-map-export" class="biq-btn-sm">⬇ Export mappings file</button>
            <button id="biq-map-import" class="biq-btn-sm">⬆ Import mappings file</button>
            <input type="file" id="biq-mapimp" accept=".json" class="hidden">
          </div>
          <div id="biq-mtabs" class="flex flex-wrap gap-1 mb-3"></div>
          <div id="biq-mapbody"></div>
        </div>
      </div>
    </div>
    <div id="biq-copymodal" class="fixed inset-0 bg-black bg-opacity-50 z-50 hidden items-center justify-center p-4 modal-backdrop" role="dialog" aria-modal="true">
      <div class="modal-content bg-white rounded-lg shadow-xl w-full max-w-md">
        <div class="p-5 border-b"><h3 class="text-lg font-semibold text-slate-800">Copy options to other lines</h3><p id="biq-copy-note" class="text-sm text-slate-500 mt-1"></p></div>
        <div class="p-5">
          <div class="flex gap-2 mb-2"><button id="biq-copy-same" class="biq-btn-sm">Same blind type</button><button id="biq-copy-all" class="biq-btn-sm">Select all</button></div>
          <div id="biq-copy-targets" class="max-h-56 overflow-auto border border-slate-200 rounded-md p-2 mb-3"></div>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="biq-copy-overwrite"> Overwrite values already set on the target lines (otherwise only fill blanks)</label>
        </div>
        <div class="px-5 py-3 bg-slate-50 rounded-b-lg flex justify-end gap-2">
          <button id="biq-copy-cancel" class="biq-btn-sm">Cancel</button>
          <button id="biq-copy-apply" class="bg-indigo-600 text-white font-bold py-1.5 px-4 rounded-md hover:bg-indigo-700 text-sm">Copy</button>
        </div>
      </div>
    </div>`);
}
