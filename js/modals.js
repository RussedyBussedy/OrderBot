// js/modals.js
// Generic confirmation modal logic.

import { state } from './state.js';
import { dom } from './dom-refs.js';

export function setupConfirmModal() {
    dom.confirmModalCancel().addEventListener('click', () => {
        dom.confirmModal().style.display = 'none';
        state.confirmCallback = null;
    });
    dom.confirmModalConfirm().addEventListener('click', () => {
        if (state.confirmCallback) state.confirmCallback();
        dom.confirmModal().style.display = 'none';
        state.confirmCallback = null;
    });
}

export function showConfirmModal(message, onConfirm) {
    dom.confirmModalBody().textContent = message;
    state.confirmCallback = onConfirm;
    dom.confirmModal().style.display = 'flex';
}
