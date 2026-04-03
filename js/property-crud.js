// js/property-crud.js
// Generic CRUD factory for property tables (fabric, motor, tube).
// Call createPropertyCRUD(config) once per property type in app.js.

import { collection, getDocs, addDoc, doc, deleteDoc, updateDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

import { state } from './state.js';
import { showConfirmModal } from './modals.js';

// ---------------------------------------------------------------------------
// createPropertyCRUD
//
// Config fields:
//   collectionName   — Firestore collection (e.g., 'orderbot_fabric_properties')
//   itemLabel        — Human name for messages (e.g., 'fabric')
//   listElFn         — () => HTMLElement  (the <div> that receives rendered rows)
//   csvDropZoneFn    — () => HTMLElement
//   csvUploadFn      — () => HTMLInputElement
//   addBtnFn         — () => HTMLElement
//   parseCsvFn       — (text: string) => object[]
//   renderRowHtmlFn  — (data: object, isNew: boolean) => string
//                      Must include buttons with classes: save-btn, delete-btn (existing), cancel-btn (new)
//   parseRowDataFn   — (rowEl: HTMLElement) => object
//   validateFn       — (data: object) => string | null  (null = valid)
//   sortFn           — (docA, docB) => number  (receives Firestore QueryDocumentSnapshot)
//   getDisplayName   — (data: object) => string  (used in delete confirmation)
//
// Returns: { loadAndDisplay }  — call this on initial page load.
// ---------------------------------------------------------------------------
export function createPropertyCRUD({
    collectionName,
    itemLabel,
    listElFn,
    csvDropZoneFn,
    csvUploadFn,
    addBtnFn,
    parseCsvFn,
    renderRowHtmlFn,
    parseRowDataFn,
    validateFn,
    sortFn,
    getDisplayName,
}) {
    function _setupCsvDropZone() {
        const dropZone = csvDropZoneFn();
        const confirmMsg = `This will delete all existing ${itemLabel} properties and replace them with this file's contents. Are you sure?`;

        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file && file.name.endsWith('.csv')) {
                showConfirmModal(confirmMsg, () => _processFile(file));
            }
        });

        csvUploadFn().addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) showConfirmModal(confirmMsg, () => _processFile(file));
            event.target.value = '';
        });
    }

    function _processFile(file) {
        listElFn().innerHTML = `<div class="flex items-center justify-center gap-2 text-slate-600"><div class="loader !w-5 !h-5 !border-2"></div>Processing CSV...</div>`;
        try {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const parsedData = parseCsvFn(e.target.result);
                if (parsedData.length === 0) throw new Error('CSV is empty or could not be parsed correctly.');
                await _uploadAll(parsedData);
                await loadAndDisplay();
            };
            reader.readAsText(file);
        } catch (error) {
            console.error(`Error processing ${itemLabel} CSV:`, error);
            listElFn().innerHTML = `<p class="text-red-500 text-center">Error: ${error.message}</p>`;
        }
    }

    async function _uploadAll(data) {
        if (!state.db) throw new Error('Database not connected.');
        const propertiesRef = collection(state.db, collectionName);
        const oldDocsSnapshot = await getDocs(propertiesRef);
        const deleteBatch = writeBatch(state.db);
        oldDocsSnapshot.forEach(d => deleteBatch.delete(d.ref));
        await deleteBatch.commit();

        const addBatch = writeBatch(state.db);
        data.forEach(item => addBatch.set(doc(propertiesRef), item));
        await addBatch.commit();
    }

    async function loadAndDisplay() {
        if (!state.db) return;
        const listEl = listElFn();
        listEl.innerHTML = `<div class="flex items-center justify-center gap-2 text-slate-600"><div class="loader !w-5 !h-5 !border-2"></div>Loading ${itemLabel}s...</div>`;
        const snapshot = await getDocs(collection(state.db, collectionName));
        listEl.innerHTML = '';
        if (snapshot.empty) {
            listEl.innerHTML = `<p class="text-slate-400 italic text-center">No ${itemLabel} properties loaded.</p>`;
            return;
        }
        snapshot.docs.sort(sortFn).forEach(d => _renderRow(d.id, d.data()));
    }

    function _renderRow(id, data, isNew = false) {
        const listEl = listElFn();
        const rowEl = document.createElement('div');
        rowEl.dataset.id = id || '';
        rowEl.innerHTML = renderRowHtmlFn(data, isNew);
        listEl.appendChild(rowEl);

        rowEl.querySelector('.save-btn').addEventListener('click', async () => {
            const dataToSave = parseRowDataFn(rowEl);
            const validationError = validateFn(dataToSave);
            if (validationError) { alert(validationError); return; }
            try {
                if (isNew) {
                    await addDoc(collection(state.db, collectionName), dataToSave);
                } else {
                    await updateDoc(doc(state.db, collectionName, id), dataToSave);
                }
                loadAndDisplay();
            } catch (error) {
                console.error(`Error saving ${itemLabel}:`, error);
                alert(`Could not save ${itemLabel} properties.`);
            }
        });

        if (isNew) {
            rowEl.querySelector('.cancel-btn').addEventListener('click', () => rowEl.remove());
        } else {
            rowEl.querySelector('.delete-btn').addEventListener('click', () => {
                showConfirmModal(`Are you sure you want to delete "${getDisplayName(data)}"?`, async () => {
                    try {
                        await deleteDoc(doc(state.db, collectionName, id));
                        loadAndDisplay();
                    } catch (error) {
                        console.error(`Error deleting ${itemLabel}:`, error);
                        alert(`Could not delete ${itemLabel}.`);
                    }
                });
            });
        }
    }

    // Wire up event listeners and return the loadAndDisplay function for initial load.
    _setupCsvDropZone();
    addBtnFn().addEventListener('click', () => _renderRow(null, {}, true));

    return { loadAndDisplay };
}
