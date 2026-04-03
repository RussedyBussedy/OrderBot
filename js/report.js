// js/report.js
// Report rendering: summary cards, detailed line item table, interaction setup.

import { dom } from './dom-refs.js';
import { state } from './state.js';

const ALERT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.21 3.03-1.742 3.03H4.42c-1.532 0-2.492-1.696-1.742-3.03l5.58-9.92zM10 13a1 1 0 110-2 1 1 0 010 2zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>`;

// -----------------------------------------------------------------------
// renderSummaryReport — renders the batch summary cards into the report section
// -----------------------------------------------------------------------
export function renderSummaryReport(results) {
    let summaryHtml = '';
    results.forEach((result, index) => {
        if (result.status === 'success') {
            const data = result.data;
            let status = 'match';
            let hasMismatch = false;
            let hasLowConfidence = false;
            let hasAlert = false;

            if (data.motorValidation) hasAlert = true;
            if (data._missingOrderNumberWarning) hasAlert = true;
            (data.lineItems || []).forEach(item => {
                if (item.fabricValidation || item.colourValidation || item.motorValidation || item.torqueValidation || item.controlValidation || item._duplicateItemWarning) hasAlert = true;
                Object.values(item).forEach(field => {
                    if (field && (field.result === 'MISMATCH' || field.result === 'OMISSION')) hasMismatch = true;
                });
                (item.specifications || []).forEach(spec => {
                    if (spec.specComparison.result === 'MISMATCH' || spec.specComparison.result === 'OMISSION') hasMismatch = true;
                });
            });
            (data.sundries || []).forEach(sundry => {
                if (sundry.validationLog && sundry.validationLog.some(log => log.status === 'FAIL')) hasAlert = true;
            });

            if (!hasMismatch && !hasAlert) {
                (data.lineItems || []).forEach(item => {
                    Object.values(item).forEach(field => {
                        if (field && (field.confidence * 100) < 90) hasLowConfidence = true;
                    });
                    (item.specifications || []).forEach(spec => {
                        if ((spec.specComparison.confidence * 100) < 90) hasLowConfidence = true;
                    });
                });
            }

            if (hasMismatch || hasAlert) status = 'mismatch';
            else if (hasLowConfidence) status = 'low-confidence';

            const statusClasses = {
                'match':          'bg-green-100 text-green-800',
                'mismatch':       'bg-red-100 text-red-800',
                'low-confidence': 'bg-orange-100 text-orange-800',
            }[status];

            summaryHtml += `
                <div class="summary-item border rounded-lg overflow-hidden">
                    <div class="summary-item-header p-4 cursor-pointer flex justify-between items-center ${statusClasses}" data-summary-index="${index}">
                        <div class="flex items-center gap-3">
                            <span class="font-bold">${data.bdoOrderNumber || 'Unknown Order'}</span>
                            <span class="text-[10px] bg-white/60 text-slate-600 px-2 py-0.5 rounded-full border border-slate-300 font-mono uppercase shadow-sm tracking-wider">
                                ${data.modelUsed || 'GEMINI-2.5-PRO'}
                            </span>
                        </div>
                        <span class="text-sm font-semibold">${status.replace('-', ' ').toUpperCase()}${hasAlert ? ' (ACTION REQUIRED)' : ''}</span>
                    </div>
                    <div class="summary-item-details p-4 border-t border-slate-200">
                        <!-- Detailed report will be injected here -->
                    </div>
                </div>
            `;
        } else {
            summaryHtml += `
                <div class="summary-item border rounded-lg overflow-hidden">
                    <div class="p-4 bg-gray-100 text-gray-800">
                        <span class="font-bold">${result.orderNumber} - FAILED</span>
                        <p class="text-sm">${result.error}</p>
                    </div>
                </div>
            `;
        }
    });

    dom.reportContent().innerHTML = `<div class="space-y-4">${summaryHtml}</div>`;

    dom.reportContent().querySelectorAll('.summary-item-header').forEach(header => {
        header.addEventListener('click', () => {
            const details     = header.nextElementSibling;
            const summaryIndex = header.dataset.summaryIndex;
            const reportData  = state.summaryResultsCache[summaryIndex].data;

            if (details.innerHTML.trim() === '<!-- Detailed report will be injected here -->') {
                details.innerHTML = renderReportTable(reportData);
                setupReportInteraction(details, reportData);
            }

            if (details.style.maxHeight) {
                details.style.maxHeight = null;
            } else {
                details.style.maxHeight = `${details.scrollHeight}px`;
            }
        });
    });
}

// -----------------------------------------------------------------------
// renderReportTable — produces the full HTML for one comparison result
// -----------------------------------------------------------------------
export function renderReportTable(data) {
    const getIndicator = (result) => ({ 'MISMATCH': '🔴', 'OMISSION': '🟡', 'MATCH': '🟢', 'NOTE': '🔵' }[result] || '');

    const renderCell = (field, fieldName, label) => {
        const isMismatch     = field && field.result === 'MISMATCH';
        const isLowConfidence = field && (field.confidence * 100) < 90;
        const value          = field ? field.blindIQValue : 'N/A';
        const customerVal    = field ? field.customerValue : 'N/A';
        let content = value;
        if (isMismatch) content = `${value} <span class="text-xs font-normal">(vs ${customerVal})</span>`;
        let cellClasses = 'px-2 py-1 reportable-cell';
        let textClasses = 'text-sm text-slate-800';
        let tooltip = '';
        if (isMismatch) {
            cellClasses += ' bg-red-50';
            textClasses += ' font-bold text-red-700';
        } else if (isLowConfidence) {
            cellClasses += ' bg-orange-50';
            textClasses += ' text-orange-700';
            tooltip = `<div class="tooltip">Confidence: ${Math.round(field.confidence * 100)}%</div>`;
        }
        return `<div class="${cellClasses}" data-field-name="${fieldName}"><div class="text-xs font-semibold text-slate-500">${label}</div><div class="${textClasses}">${content}</div>${tooltip}</div>`;
    };

    let globalValidationHtml = '';
    if (data._missingOrderNumberWarning) {
        globalValidationHtml += `<div class="mb-2 p-2 text-sm font-semibold bg-orange-100 text-orange-800 rounded-lg flex items-center gap-2">${ALERT_ICON} Warning: AI could not extract a BDO order number — result may be from an unrecognised document.</div>`;
    }
    if (data.motorValidation && data.motorValidation.global) {
        globalValidationHtml += `<div class="mb-4 p-2 text-sm font-semibold bg-red-100 text-red-800 rounded-lg flex items-center gap-2">${ALERT_ICON} ${data.motorValidation.global}</div>`;
    }

    const orderNumberRow = `
        ${globalValidationHtml}
        <div class="mb-4 p-4 rounded-lg ${data.customerOrderNumber?.result === 'MATCH' ? 'bg-green-100' : 'bg-red-100'}">
            <div class="flex items-center gap-3 mb-1">
                <h3 class="font-bold text-lg ${data.customerOrderNumber?.result === 'MATCH' ? 'text-green-800' : 'text-red-800'}">Order Number Comparison</h3>
            </div>
            <p class="text-sm ${data.customerOrderNumber?.result === 'MATCH' ? 'text-green-700' : 'text-red-700'}">
                Customer O/N: <strong>${data.customerOrderNumber?.customerValue || 'N/A'}</strong> | Blind IQ O/N: <strong>${data.customerOrderNumber?.blindIQValue || 'N/A'}</strong>
                <span class="font-bold ml-2">${getIndicator(data.customerOrderNumber?.result)} ${data.customerOrderNumber?.result || ''}</span>
            </p>
        </div>
    `;

    let specialInstructionsRow = '';
    if (data.specialInstructions && (data.specialInstructions.customerValue || data.specialInstructions.blindIQValue)) {
        specialInstructionsRow = `<div class="mb-4 p-4 rounded-lg bg-amber-100"><h3 class="font-bold text-lg text-amber-800">Special Instructions</h3><p class="text-sm text-amber-700">Customer Doc: <strong>${data.specialInstructions.customerValue || 'None'}</strong></p><p class="text-sm text-amber-700">Blind IQ Doc: <strong>${data.specialInstructions.blindIQValue || 'None'}</strong></p></div>`;
    }

    const lineItemsHtml = (data.lineItems || []).map((lineItem, index) => {
        let validationHtml = '';
        if (lineItem.fabricValidation) {
            const cls = lineItem.fabricValidation.type === 'error' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800';
            validationHtml += `<div class="p-2 text-sm font-semibold ${cls} flex items-center gap-2">${ALERT_ICON} ${lineItem.fabricValidation.message}</div>`;
        }
        if (lineItem.colourValidation)  validationHtml += `<div class="p-2 text-sm font-semibold bg-red-100 text-red-800 flex items-center gap-2">${ALERT_ICON} ${lineItem.colourValidation.message}</div>`;
        if (lineItem.controlValidation) validationHtml += `<div class="p-2 text-sm font-semibold bg-red-100 text-red-800 flex items-center gap-2">${ALERT_ICON} ${lineItem.controlValidation.message}</div>`;
        if (lineItem.torqueValidation)  validationHtml += `<div class="p-2 text-sm font-semibold bg-red-100 text-red-800 flex items-center gap-2">${ALERT_ICON} ${lineItem.torqueValidation.message}</div>`;
        else if (lineItem.requiredTorque) validationHtml += `<div class="p-2 text-sm font-semibold bg-blue-100 text-blue-800 flex items-center gap-2"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" /></svg> RQD Torque: ${lineItem.requiredTorque} Nm</div>`;
        if (lineItem._duplicateItemWarning) validationHtml += `<div class="p-2 text-sm font-semibold bg-orange-100 text-orange-800 flex items-center gap-2">${ALERT_ICON} ${lineItem._duplicateItemWarning}</div>`;

        const specHtml = (lineItem.specifications || []).map((spec, specIndex) => {
            const isMismatch     = spec.specComparison.result === 'MISMATCH';
            const isOmission     = spec.specComparison.result === 'OMISSION';
            const isLowConf      = (spec.specComparison.confidence * 100) < 90;
            let resultClass = 'spec-match';
            if (isMismatch) resultClass = 'spec-mismatch';
            else if (isLowConf) resultClass = 'spec-low-confidence';
            let text = `${spec.specName}=${spec.specComparison.blindIQValue}`;
            if (isMismatch) text += ` (vs ${spec.specComparison.customerValue})`;
            if (isOmission) text += ' (Omission)';
            let tooltip = '';
            if (isLowConf && !isMismatch) tooltip = `<div class="tooltip">Confidence: ${Math.round(spec.specComparison.confidence * 100)}%</div>`;
            return `<span class="spec-text ${resultClass}" data-spec-index="${specIndex}">${text}${tooltip}</span>`;
        }).join(' | ');

        const reasoningHtml = lineItem.reasoning ? `
            <div class="border-t border-slate-200">
                <div class="reasoning-toggle p-2 bg-indigo-50/40 cursor-pointer flex justify-between items-center text-xs text-indigo-800 hover:bg-indigo-100 transition-colors">
                    <strong><span class="mr-2">🧠</span> AI Reasoning Log</strong>
                    <svg class="chevron-icon w-4 h-4 transition-transform duration-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                </div>
                <div class="reasoning-content max-h-0 overflow-hidden transition-all duration-300 ease-in-out bg-white text-xs text-slate-700">
                    <div class="p-3 italic whitespace-pre-wrap">${lineItem.reasoning}</div>
                </div>
            </div>
        ` : '';

        return `
            <div class="line-item-container border border-slate-200 rounded-lg mb-4" data-row-index="${index}">
                ${validationHtml}
                <div class="grid grid-cols-11 bg-slate-50 font-semibold text-sm text-slate-700 border-b border-slate-200 divide-x divide-slate-200">
                    ${renderCell(lineItem.item,      'item',      'Item')}
                    ${renderCell(lineItem.qty,       'qty',       'QTY')}
                    ${renderCell(lineItem.location,  'location',  'Location')}
                    ${renderCell(lineItem.blindType, 'blindType', 'Blind Type')}
                    ${renderCell(lineItem.range,     'range',     'Range')}
                    ${renderCell(lineItem.colour,    'colour',    'Colour')}
                    ${renderCell(lineItem.width,     'width',     'Width')}
                    ${renderCell(lineItem.drop,      'drop',      'Drop')}
                    ${renderCell(lineItem.control1,  'control1',  'Control 1')}
                    ${renderCell(lineItem.control2,  'control2',  'Control 2')}
                    ${renderCell(lineItem.fix,       'fix',       'Fix')}
                </div>
                <div class="p-3 bg-white text-xs text-slate-600">${specHtml}</div>
                ${reasoningHtml}
            </div>
        `;
    }).join('');

    let sundriesHtml = '';
    if (data.sundries && data.sundries.length > 0) {
        sundriesHtml = '<h3 class="font-bold text-lg text-slate-800 mt-6 mb-2">Sundries Comparison</h3><div class="space-y-2 text-sm">';
        data.sundries.forEach(sundry => {
            if (sundry.validationLog) {
                const hasErrors  = sundry.validationLog.some(log => log.status === 'FAIL');
                const headerCls  = hasErrors ? 'bg-red-50' : 'bg-green-50';
                const badgeCls   = hasErrors ? 'bg-red-200 text-red-800' : 'bg-green-200 text-green-800';
                let detailsHtml  = '<ul class="p-2 space-y-1 text-xs">';
                sundry.validationLog.forEach(log => {
                    const icon = log.status === 'PASS' ? '<span class="text-green-500">✔</span>' : '<span class="text-red-500">✖</span>';
                    detailsHtml += `<li class="flex items-start gap-2">${icon} <div><strong>${log.check}:</strong> ${log.details}</div></li>`;
                });
                detailsHtml += '</ul>';
                sundriesHtml += `<div class="border rounded-md overflow-hidden"><div class="sundry-header p-2 flex justify-between items-center cursor-pointer ${headerCls}"><span>${sundry.quantity} x ${sundry.item.blindIQValue}</span><span class="text-xs font-bold px-2 py-1 rounded-full ${badgeCls}">${hasErrors ? 'ERRORS FOUND' : 'VALIDATED'}</span></div><div class="sundry-details bg-white border-t">${detailsHtml}</div></div>`;
            } else {
                const result    = sundry.item.result;
                let resultClass = 'text-slate-500';
                if (result === 'MATCH')    resultClass = 'text-green-700';
                if (result === 'MISMATCH') resultClass = 'text-red-700 font-semibold';
                sundriesHtml += `<div class="flex justify-between items-center bg-slate-50 p-2 rounded-md"><span>${sundry.quantity} x ${sundry.item.blindIQValue}</span><span class="font-medium ${resultClass}">${result}</span></div>`;
            }
        });
        sundriesHtml += '</div>';
    }

    return `${orderNumberRow}${specialInstructionsRow}${lineItemsHtml}${sundriesHtml}`;
}

// -----------------------------------------------------------------------
// setupReportInteraction — event delegation for reasoning toggles,
// cell clicks (feedback), and sundry header toggles
// -----------------------------------------------------------------------
export function setupReportInteraction(container, reportData) {
    container.addEventListener('click', (e) => {
        // Reasoning log toggle
        const reasoningToggle = e.target.closest('.reasoning-toggle');
        if (reasoningToggle) {
            const content = reasoningToggle.nextElementSibling;
            const icon    = reasoningToggle.querySelector('.chevron-icon');
            if (content.style.maxHeight) {
                content.style.maxHeight = null;
                if (icon) icon.style.transform = 'rotate(0deg)';
            } else {
                content.style.maxHeight = `${content.scrollHeight}px`;
                if (icon) icon.style.transform = 'rotate(180deg)';
                const parentDetails = reasoningToggle.closest('.summary-item-details');
                if (parentDetails?.style.maxHeight) {
                    parentDetails.style.maxHeight = `${parseInt(parentDetails.style.maxHeight) + content.scrollHeight}px`;
                }
            }
            return;
        }

        // Sundry header toggle
        const target = e.target.closest('.reportable-cell, .spec-text, .sundry-header');
        if (!target) return;

        if (target.classList.contains('sundry-header')) {
            const details = target.nextElementSibling;
            if (details.style.maxHeight) {
                details.style.maxHeight = null;
            } else {
                details.style.maxHeight = `${details.scrollHeight}px`;
                const parentDetails = target.closest('.summary-item-details');
                if (parentDetails?.style.maxHeight) {
                    parentDetails.style.maxHeight = `${parseInt(parentDetails.style.maxHeight) + details.scrollHeight}px`;
                }
            }
            return;
        }

        // Feedback modal trigger
        if (!state.db) { alert("Feedback system is not available."); return; }
        const lineItemElement = target.closest('.line-item-container');
        if (!lineItemElement) return;

        const rowIndex = lineItemElement.dataset.rowIndex;
        const lineItem = reportData.lineItems[rowIndex];
        let fieldName, fieldData;

        if (target.classList.contains('spec-text')) {
            const specIndex = target.dataset.specIndex;
            const spec      = lineItem.specifications[specIndex];
            fieldName = spec.specName;
            fieldData = spec.specComparison;
        } else {
            fieldName = target.dataset.fieldName;
            fieldData = lineItem[fieldName];
        }

        if (!fieldData) return;

        state.itemToCorrect = {
            lineItemIdentifier: { item: lineItem.item.blindIQValue, location: lineItem.location.blindIQValue },
            fieldName,
            fieldData,
        };

        dom.feedbackModalTitle().textContent = `Correcting error for: ${fieldName}`;
        dom.incorrectItemDetails().textContent = JSON.stringify(fieldData, null, 2);
        dom.feedbackModal().style.display = 'flex';
    });
}
