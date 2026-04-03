// js/app.js
// Entry point: Firebase init, state wiring, upload pair management,
// event listener setup, and initial page load.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

import { state } from './state.js';
import { dom } from './dom-refs.js';
import { setupDropZone, setupCollapsible } from './utils.js';
import { runAllComparisons } from './comparison.js';
import { setupFeedback } from './feedback.js';
import { setupGuidelines, loadAndDisplayGuidelines } from './guidelines.js';
import { setupHistory } from './history.js';
import { setupConfirmModal } from './modals.js';
import { createPropertyCRUD } from './property-crud.js';

// =============================================================================
// Firebase Configuration
// =============================================================================
const firebaseConfig = {
    apiKey: 'AIzaSyB3x__sOsj8EPS9KnpweD6uWIhVt9ACNBM',
    authDomain: 'orderbot-2b212.firebaseapp.com',
    projectId: 'orderbot-2b212',
    storageBucket: 'orderbot-2b212.firebasestorage.app',
    messagingSenderId: '51064902388',
    appId: '1:51064902388:web:20d2d93c682a537ebc04a1',
    measurementId: 'G-5RM4TC6BD6',
};

try {
    const app = initializeApp(firebaseConfig);
    state.db = getFirestore(app);
    const auth = getAuth(app);
    await signInAnonymously(auth);
    state.userId = auth.currentUser?.uid;
    console.log('Firebase initialized and user signed in. UID:', state.userId);
} catch (error) {
    console.error('Firebase initialization failed.', error);
    alert('Could not connect to the database.');
}

// =============================================================================
// Upload pair management
// =============================================================================

function checkCompareButtonState() {
    const allPairsValid = state.comparisonPairs.every(pair => pair.customerFiles.length > 0 && pair.blindIQFiles.length > 0);
    dom.compareBtn().disabled = !allPairsValid;
}

function addNewPair() {
    if (state.comparisonPairs.length >= 10) {
        dom.addPairBtn().disabled = true;
        return;
    }

    const newPair = { customerFiles: [], blindIQFiles: [] };
    state.comparisonPairs.push(newPair);
    const index = state.comparisonPairs.length - 1;

    const template = dom.uploadPairTemplate().content.cloneNode(true);
    const pairElement = template.querySelector('.upload-pair');
    pairElement.dataset.index = index;

    const customerDropZone = pairElement.querySelector('.drop-zone:first-child');
    const customerFileInput = pairElement.querySelector('.customer-file-input');
    const customerFileList  = pairElement.querySelector('.customer-file-list');
    setupDropZone(customerDropZone, customerFileInput, customerFileList, newPair.customerFiles, checkCompareButtonState);

    const blindiqDropZone = pairElement.querySelector('.drop-zone:last-child');
    const blindiqFileInput = pairElement.querySelector('.blindiq-file-input');
    const blindiqFileList  = pairElement.querySelector('.blindiq-file-list');
    setupDropZone(blindiqDropZone, blindiqFileInput, blindiqFileList, newPair.blindIQFiles, checkCompareButtonState);

    dom.uploadPairsContainer().appendChild(template);
    checkCompareButtonState();
}

function resetUI() {
    if (state.comparisonAbortController) {
        state.comparisonAbortController.abort();
        state.comparisonAbortController = null;
    }
    dom.uploadSection().classList.remove('hidden');
    dom.reportSection().classList.add('hidden');
    dom.newComparisonBtn().classList.add('hidden');
    dom.clearHistoryBtn().classList.add('hidden');
    dom.historyResults().innerHTML = '';
    dom.historySearchInput().value = '';

    state.comparisonPairs = [];
    dom.uploadPairsContainer().innerHTML = '';
    addNewPair();
    checkCompareButtonState();
}

// =============================================================================
// Event listeners
// =============================================================================

dom.addPairBtn().addEventListener('click', addNewPair);
dom.compareBtn().addEventListener('click', runAllComparisons);
dom.newComparisonBtn().addEventListener('click', resetUI);

// =============================================================================
// Property CRUD config objects
// =============================================================================

// --- CSV parsing helpers ---

function parseFabricCsv(text) {
    const rows = text.replace(/\r\n/g, '\n').split('\n').filter(row => row.trim() !== '');
    if (rows.length < 2) return [];
    const delimiter = rows[0].includes(';') ? ';' : ',';
    const data = [];
    for (let i = 1; i < rows.length; i++) {
        const columns = rows[i].split(delimiter).map(cell => cell.trim().replace(/^"|"$/g, ''));
        if (columns.length >= 4) {
            const name   = columns[0];
            const weight = parseFloat(columns[1].replace(',', '.'));
            const width  = parseInt(columns[2], 10);
            const canTurn = columns[3];
            if (name && !isNaN(weight) && !isNaN(width) && canTurn) {
                data.push({ fabricName: name, fabricWeight: weight, fabricWidth: width, canTurn });
            } else {
                console.warn('Skipping malformed fabric CSV row:', rows[i]);
            }
        }
    }
    return data;
}

function parseMotorCsv(text) {
    const rows = text.replace(/\r\n/g, '\n').split('\n').filter(row => row.trim() !== '');
    if (rows.length < 2) return [];
    const delimiter = rows[0].includes(';') ? ';' : ',';
    const data = [];
    for (let i = 1; i < rows.length; i++) {
        const rowText = rows[i];
        if (!rowText.trim()) continue;
        const columns = rowText.match(new RegExp(`(\\${delimiter}|\\r?\\n|\\r|^)(?:"([^"]*(?:""[^"]*)*)"|([^"\\${delimiter}\\r\\n]*))`, 'gi'));
        if (!columns) continue;
        const cleanColumns = columns.map(col => {
            let c = col.trim();
            if (c.startsWith(delimiter)) c = c.substring(1);
            if (c.startsWith('"') && c.endsWith('"')) c = c.substring(1, c.length - 1);
            return c.replace(/""/g, '"');
        });
        if (cleanColumns.length >= 8) {
            const motorName    = cleanColumns[0];
            const torque       = parseFloat(cleanColumns[1].replace(',', '.'));
            const blindType    = cleanColumns[2];
            const adapterKit   = cleanColumns[3];
            const accessories  = cleanColumns[4];
            const otherDependencies = cleanColumns[5];
            const blindControl = cleanColumns[6];
            const controlOptions = cleanColumns[7];
            if (motorName && !isNaN(torque) && blindType) {
                data.push({ motorName, torque, blindType, adapterKit, accessories, otherDependencies, blindControl, controlOptions });
            } else {
                console.warn('Skipping malformed motor CSV row:', rowText);
            }
        }
    }
    return data;
}

function parseTubeCsv(text) {
    const rows = text.replace(/\r\n/g, '\n').split('\n').filter(row => row.trim() !== '');
    if (rows.length < 2) return [];
    const delimiter = rows[0].includes(';') ? ';' : ',';
    const data = [];
    for (let i = 1; i < rows.length; i++) {
        const columns = rows[i].split(delimiter).map(cell => cell.trim().replace(/^"|"$/g, ''));
        if (columns.length >= 2) {
            const blindType    = columns[0];
            const tubeDiameter = parseInt(columns[1], 10);
            if (blindType && !isNaN(tubeDiameter)) {
                data.push({ blindType, tubeDiameter });
            } else {
                console.warn('Skipping malformed tube CSV row:', rows[i]);
            }
        }
    }
    return data;
}

// --- Row HTML renderers ---

function renderFabricRowHtml(data, isNew) {
    return `
        <div class="fabric-row p-2 bg-slate-50 rounded-lg grid grid-cols-[1fr,auto,auto,auto,auto] items-center gap-2">
            <input type="text" value="${data.fabricName || ''}" placeholder="Fabric Name" class="w-full p-1 border rounded text-sm font-semibold text-slate-800">
            <div class="flex items-center gap-1">
                <label class="text-xs text-slate-500">Weight:</label>
                <input type="number" step="0.001" value="${data.fabricWeight || ''}" class="w-20 p-1 border rounded text-sm">
            </div>
            <div class="flex items-center gap-1">
                <label class="text-xs text-slate-500">Width:</label>
                <input type="number" value="${data.fabricWidth || ''}" class="w-20 p-1 border rounded text-sm">
            </div>
            <div class="flex items-center gap-1">
                <label class="text-xs text-slate-500">Turn:</label>
                <input type="text" value="${data.canTurn || ''}" placeholder="Yes/No/Out" class="w-20 p-1 border rounded text-sm">
            </div>
            <div class="flex gap-2">
                <button class="save-btn bg-blue-500 text-white text-xs font-bold py-1 px-3 rounded hover:bg-blue-600">${isNew ? 'Add' : 'Save'}</button>
                ${isNew
                    ? `<button class="cancel-btn bg-gray-200 text-gray-700 text-xs font-bold py-1 px-3 rounded hover:bg-gray-300">Cancel</button>`
                    : `<button class="delete-btn text-red-400 hover:text-red-600 font-bold text-lg">&times;</button>`}
            </div>
        </div>`;
}

function parseFabricRowData(rowEl) {
    const inputs = rowEl.querySelectorAll('input');
    return {
        fabricName:   inputs[0].value.trim(),
        fabricWeight: parseFloat(inputs[1].value),
        fabricWidth:  parseInt(inputs[2].value, 10),
        canTurn:      inputs[3].value.trim(),
    };
}

function validateFabricData(data) {
    if (!data.fabricName || isNaN(data.fabricWeight) || isNaN(data.fabricWidth) || !data.canTurn) {
        return 'Please provide valid Name, Weight, Width, and Turn values.';
    }
    return null;
}

function renderMotorRowHtml(data, isNew) {
    return `
        <div class="motor-row p-2 bg-slate-50 rounded-lg grid grid-cols-[1fr,auto,1fr,1fr,1fr,1fr,1fr,1fr,auto] items-center gap-2">
            <input type="text" value="${data.motorName || ''}" placeholder="Motor Name" class="w-full p-1 border rounded text-sm font-semibold">
            <input type="number" step="0.1" value="${data.torque || ''}" placeholder="Torque" class="w-20 p-1 border rounded text-sm">
            <input type="text" value="${data.blindType || ''}" placeholder="Blind Type" class="w-full p-1 border rounded text-sm">
            <input type="text" value="${data.adapterKit || ''}" placeholder="Adapter Kit" class="w-full p-1 border rounded text-sm">
            <input type="text" value="${data.accessories || ''}" placeholder="Accessories" class="w-full p-1 border rounded text-sm">
            <input type="text" value="${data.otherDependencies || ''}" placeholder="Other Dependencies" class="w-full p-1 border rounded text-sm">
            <input type="text" value="${data.blindControl || ''}" placeholder="Blind Control" class="w-full p-1 border rounded text-sm">
            <input type="text" value="${data.controlOptions || ''}" placeholder="Control Options" class="w-full p-1 border rounded text-sm">
            <div class="flex gap-2">
                <button class="save-btn bg-blue-500 text-white text-xs font-bold py-1 px-3 rounded hover:bg-blue-600">${isNew ? 'Add' : 'Save'}</button>
                ${isNew
                    ? `<button class="cancel-btn bg-gray-200 text-gray-700 text-xs font-bold py-1 px-3 rounded hover:bg-gray-300">Cancel</button>`
                    : `<button class="delete-btn text-red-400 hover:text-red-600 font-bold text-lg">&times;</button>`}
            </div>
        </div>`;
}

function parseMotorRowData(rowEl) {
    const inputs = rowEl.querySelectorAll('input');
    return {
        motorName:         inputs[0].value.trim(),
        torque:            parseFloat(inputs[1].value),
        blindType:         inputs[2].value.trim(),
        adapterKit:        inputs[3].value.trim(),
        accessories:       inputs[4].value.trim(),
        otherDependencies: inputs[5].value.trim(),
        blindControl:      inputs[6].value.trim(),
        controlOptions:    inputs[7].value.trim(),
    };
}

function validateMotorData(data) {
    if (!data.motorName || isNaN(data.torque) || !data.blindType) {
        return 'Please provide valid Name, Torque, and Blind Type values.';
    }
    return null;
}

function renderTubeRowHtml(data, isNew) {
    return `
        <div class="tube-row p-2 bg-slate-50 rounded-lg grid grid-cols-[1fr,auto,auto] items-center gap-2">
            <input type="text" value="${data.blindType || ''}" placeholder="Blind Type" class="w-full p-1 border rounded text-sm font-semibold">
            <input type="number" value="${data.tubeDiameter || ''}" placeholder="Diameter (mm)" class="w-32 p-1 border rounded text-sm">
            <div class="flex gap-2">
                <button class="save-btn bg-blue-500 text-white text-xs font-bold py-1 px-3 rounded hover:bg-blue-600">${isNew ? 'Add' : 'Save'}</button>
                ${isNew
                    ? `<button class="cancel-btn bg-gray-200 text-gray-700 text-xs font-bold py-1 px-3 rounded hover:bg-gray-300">Cancel</button>`
                    : `<button class="delete-btn text-red-400 hover:text-red-600 font-bold text-lg">&times;</button>`}
            </div>
        </div>`;
}

function parseTubeRowData(rowEl) {
    const inputs = rowEl.querySelectorAll('input');
    return {
        blindType:    inputs[0].value.trim(),
        tubeDiameter: parseInt(inputs[1].value, 10),
    };
}

function validateTubeData(data) {
    if (!data.blindType || isNaN(data.tubeDiameter)) {
        return 'Please provide a valid Blind Type and Tube Diameter.';
    }
    return null;
}

// =============================================================================
// Module setup & initial load
// =============================================================================

setupConfirmModal();
setupFeedback();
setupGuidelines();
setupHistory();

setupCollapsible(dom.guidelinesHeader(), dom.guidelinesContent());
setupCollapsible(dom.fabricPropertiesHeader(), dom.fabricPropertiesContent());
setupCollapsible(dom.motorPropertiesHeader(), dom.motorPropertiesContent());
setupCollapsible(dom.tubePropertiesHeader(), dom.tubePropertiesContent());

const { loadAndDisplay: loadFabric } = createPropertyCRUD({
    collectionName: 'orderbot_fabric_properties',
    itemLabel:      'fabric',
    listElFn:       dom.fabricPropertiesList,
    csvDropZoneFn:  dom.fabricCsvDropZone,
    csvUploadFn:    dom.fabricCsvUpload,
    addBtnFn:       dom.addFabricBtn,
    parseCsvFn:     parseFabricCsv,
    renderRowHtmlFn: renderFabricRowHtml,
    parseRowDataFn:  parseFabricRowData,
    validateFn:      validateFabricData,
    sortFn:   (a, b) => a.data().fabricName.localeCompare(b.data().fabricName),
    getDisplayName: data => data.fabricName,
});

const { loadAndDisplay: loadMotor } = createPropertyCRUD({
    collectionName: 'orderbot_motor_properties',
    itemLabel:      'motor',
    listElFn:       dom.motorPropertiesList,
    csvDropZoneFn:  dom.motorCsvDropZone,
    csvUploadFn:    dom.motorCsvUpload,
    addBtnFn:       dom.addMotorBtn,
    parseCsvFn:     parseMotorCsv,
    renderRowHtmlFn: renderMotorRowHtml,
    parseRowDataFn:  parseMotorRowData,
    validateFn:      validateMotorData,
    sortFn:   (a, b) => a.data().motorName.localeCompare(b.data().motorName) || a.data().blindType.localeCompare(b.data().blindType),
    getDisplayName: data => `${data.motorName} (${data.blindType})`,
});

const { loadAndDisplay: loadTube } = createPropertyCRUD({
    collectionName: 'orderbot_tube_properties',
    itemLabel:      'tube',
    listElFn:       dom.tubePropertiesList,
    csvDropZoneFn:  dom.tubeCsvDropZone,
    csvUploadFn:    dom.tubeCsvUpload,
    addBtnFn:       dom.addTubeBtn,
    parseCsvFn:     parseTubeCsv,
    renderRowHtmlFn: renderTubeRowHtml,
    parseRowDataFn:  parseTubeRowData,
    validateFn:      validateTubeData,
    sortFn:   (a, b) => a.data().blindType.localeCompare(b.data().blindType),
    getDisplayName: data => data.blindType,
});

addNewPair();

Promise.allSettled([
    loadAndDisplayGuidelines(),
    loadFabric(),
    loadMotor(),
    loadTube(),
]).then(results => {
    results.forEach((result, i) => {
        if (result.status === 'rejected') {
            const labels = ['Guidelines', 'Fabric Properties', 'Motor Properties', 'Tube Properties'];
            console.error(`Failed to load ${labels[i]}:`, result.reason);
        }
    });
});
