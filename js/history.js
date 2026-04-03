// js/history.js
// History search: queries Firestore by order number, deduplicates, renders results.

import { collection, getDocs, query, where, orderBy, limit } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

import { HISTORY_FETCH_LIMIT } from './config.js';
import { state } from './state.js';
import { dom } from './dom-refs.js';
import { renderReportTable, setupReportInteraction } from './report.js';

export function setupHistory() {
    dom.historySearchBtn().addEventListener('click', findHistory);
    dom.clearHistoryBtn().addEventListener('click', () => {
        dom.historyResults().innerHTML = '';
        dom.historySearchInput().value = '';
        dom.clearHistoryBtn().classList.add('hidden');
    });
}

export async function findHistory() {
    const searchTerm = dom.historySearchInput().value.trim();
    if (!searchTerm) { alert('Please enter an order number to search.'); return; }
    if (!state.db) { alert('History feature is unavailable. Database not connected.'); return; }

    dom.historyResults().innerHTML = `<div class="flex items-center gap-2 text-slate-600"><div class="loader !w-6 !h-6"></div>Searching for history...</div>`;

    try {
        const bdoQuery = query(
            collection(state.db, 'orderbot_comparisons'),
            where('bdoOrderNumber', '==', searchTerm),
            orderBy('timestamp', 'desc'),
            limit(HISTORY_FETCH_LIMIT)
        );
        const customerQuery = query(
            collection(state.db, 'orderbot_comparisons'),
            where('customerOrderNumber.customerValue', '==', searchTerm),
            orderBy('timestamp', 'desc'),
            limit(HISTORY_FETCH_LIMIT)
        );

        const [bdoSnapshot, customerSnapshot] = await Promise.all([getDocs(bdoQuery), getDocs(customerQuery)]);

        const seen = new Set();
        const allDocs = [];
        [bdoSnapshot, customerSnapshot].forEach(snapshot => {
            snapshot.forEach(d => {
                if (!seen.has(d.id)) {
                    seen.add(d.id);
                    allDocs.push(d.data());
                }
            });
        });

        state.historyDataCache = allDocs;

        if (allDocs.length === 0) {
            dom.historyResults().innerHTML = `<p class="text-slate-500">No history found for order number: <strong>${searchTerm}</strong></p>`;
            dom.clearHistoryBtn().classList.remove('hidden');
            return;
        }

        _renderHistoryResults(allDocs);
    } catch (error) {
        console.error('Error fetching history:', error);
        if (error.code === 'failed-precondition' || error.message?.includes('index')) {
            console.warn('Composite index not ready — falling back to client-side filter. Create the Firestore index for bdoOrderNumber+timestamp and customerOrderNumber.customerValue+timestamp to improve performance.');
            await _findHistoryFallback(searchTerm);
        } else {
            dom.historyResults().innerHTML = `<p class="text-red-500">Failed to fetch history. Please check the console.</p>`;
            dom.clearHistoryBtn().classList.remove('hidden');
        }
    }
}

function _renderHistoryResults(allDocs) {
    const latestComparisons = new Map();
    allDocs.forEach(data => {
        const orderNum = data.bdoOrderNumber || (data.customerOrderNumber ? data.customerOrderNumber.customerValue : null);
        if (orderNum) {
            const existing = latestComparisons.get(orderNum);
            if (!existing || new Date(data.timestamp) > new Date(existing.timestamp)) {
                latestComparisons.set(orderNum, data);
            }
        }
    });

    const finalResults = Array.from(latestComparisons.values())
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    dom.historyResults().innerHTML = '';
    finalResults.forEach((data, index) => {
        const historyItemDiv = document.createElement('div');
        historyItemDiv.className = 'history-item border border-slate-200 rounded-lg p-4';
        historyItemDiv.dataset.historyIndex = index;
        historyItemDiv.innerHTML = `<h4 class="font-bold text-md text-slate-700">Comparison from: ${new Date(data.timestamp).toLocaleString('en-ZA')}</h4>`;
        historyItemDiv.innerHTML += renderReportTable(data);
        dom.historyResults().appendChild(historyItemDiv);
    });

    dom.historyResults().querySelectorAll('.history-item').forEach(item => {
        const historyIndex = item.dataset.historyIndex;
        setupReportInteraction(item, finalResults[historyIndex]);
    });

    dom.clearHistoryBtn().classList.remove('hidden');
}

async function _findHistoryFallback(searchTerm) {
    try {
        const lowerTerm = searchTerm.toLowerCase();
        const historyQuery = query(collection(state.db, 'orderbot_comparisons'), orderBy('timestamp', 'desc'), limit(200));
        const querySnapshot = await getDocs(historyQuery);
        const filteredDocs = [];
        querySnapshot.forEach(d => {
            const data = d.data();
            if (
                (data.bdoOrderNumber && String(data.bdoOrderNumber).toLowerCase().includes(lowerTerm)) ||
                (data.customerOrderNumber?.customerValue && data.customerOrderNumber.customerValue.toLowerCase().includes(lowerTerm))
            ) filteredDocs.push(data);
        });
        state.historyDataCache = filteredDocs;
        if (filteredDocs.length === 0) {
            dom.historyResults().innerHTML = `<p class="text-slate-500">No history found for: <strong>${searchTerm}</strong></p>`;
            dom.clearHistoryBtn().classList.remove('hidden');
            return;
        }
        _renderHistoryResults(filteredDocs);
    } catch (err) {
        console.error('Fallback history fetch failed:', err);
        dom.historyResults().innerHTML = `<p class="text-red-500">Failed to fetch history.</p>`;
        dom.clearHistoryBtn().classList.remove('hidden');
    }
}
