// js/guidelines.js
// Guideline management: add, consolidate via Flash model, display, delete.

import { collection, getDocs, query, doc, deleteDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

import { MODEL_FLASH, FLASH_MAX_RETRIES, FLASH_INITIAL_DELAY, FLASH_TIMEOUT_MS } from './config.js';
import { state } from './state.js';
import { dom } from './dom-refs.js';
import { fetchWithRetry } from './utils.js';
import { showConfirmModal } from './modals.js';

export function setupGuidelines() {
    dom.addGuidelineBtn().addEventListener('click', () => {
        dom.guidelineModal().style.display = 'flex';
    });

    dom.cancelGuidelineBtn().addEventListener('click', () => {
        dom.guidelineModal().style.display = 'none';
        dom.guidelineInput().value = '';
    });

    dom.saveGuidelineBtn().addEventListener('click', async () => {
        const guidelineText = dom.guidelineInput().value.trim();
        if (!guidelineText) { alert('Please enter your guideline(s).'); return; }

        const saveBtn = dom.saveGuidelineBtn();
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<div class="loader !w-5 !h-5 !border-2 mx-auto"></div>`;

        try {
            const guidelineQuery = query(collection(state.db, 'orderbot_guidelines'));
            const querySnapshot = await getDocs(guidelineQuery);
            const existingDocs = [];
            querySnapshot.forEach(docSnap => {
                existingDocs.push({ id: docSnap.id, text: docSnap.data().enhancedGuideline });
            });
            const existingText = existingDocs.map(d => `- ${d.text}`).join('\n');

            const consolidationPrompt = `You are an expert AI system architect.
            Existing System Guidelines:
            ${existingText ? existingText : 'None.'}

            New Rule(s) provided by the user:
            "${guidelineText}"

            Your task:
            1. Integrate the new rule(s) into the existing guidelines.
            2. Review the ENTIRE combined list to find and resolve any contradictions. If the new rule contradicts an old rule, the NEW rule takes precedence. Remove or modify the old rule to ensure perfect mathematical logic.
            3. Merge any redundant rules to prevent cognitive overload.
            4. Return a highly optimized, unified master list of instructions.
            5. Output strictly as a JSON array of strings.`;

            const enhancementSchema = { type: 'OBJECT', properties: { guidelines: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['guidelines'] };
            const geminiPayload = {
                contents: [{ role: 'user', parts: [{ text: consolidationPrompt }] }],
                generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: enhancementSchema },
            };
            const proxyPayload = { model: MODEL_FLASH, payload: geminiPayload };

            const { resultText: consolidateText } = await fetchWithRetry(proxyPayload, {
                maxRetries: FLASH_MAX_RETRIES,
                initialDelay: FLASH_INITIAL_DELAY,
                timeoutMs: FLASH_TIMEOUT_MS,
            });
            const result = JSON.parse(consolidateText);
            if (!result.candidates?.[0]?.content?.parts?.[0]?.text) {
                throw new Error('Failed to enhance guidelines. API returned empty or invalid JSON.');
            }

            const data = JSON.parse(result.candidates[0].content.parts[0].text);
            const unifiedGuidelines = data.guidelines;

            // Atomic batch: delete old guidelines and add new unified ones in one commit.
            const batch = writeBatch(state.db);
            existingDocs.forEach(d => batch.delete(doc(state.db, 'orderbot_guidelines', d.id)));
            unifiedGuidelines.forEach(guideline => {
                const newDocRef = doc(collection(state.db, 'orderbot_guidelines'));
                batch.set(newDocRef, {
                    userId: state.userId,
                    timestamp: new Date().toISOString(),
                    originalUserInput: guidelineText,
                    enhancedGuideline: guideline,
                });
            });
            await batch.commit();

            dom.cancelGuidelineBtn().click();
            loadAndDisplayGuidelines();
        } catch (error) {
            console.error('Error saving/consolidating guideline:', error);
            alert('Failed to save and unify guideline(s).');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Integrate Guideline/s';
        }
    });

    dom.guidelinesList().addEventListener('click', async (e) => {
        if (e.target.classList.contains('delete-guideline-btn')) {
            const docId = e.target.dataset.id;
            showConfirmModal('Are you sure you want to delete this guideline?', async () => {
                try {
                    await deleteDoc(doc(state.db, 'orderbot_guidelines', docId));
                    loadAndDisplayGuidelines();
                } catch (error) {
                    console.error('Error deleting guideline:', error);
                    alert('Could not delete the guideline.');
                }
            });
        }
    });
}

export async function loadAndDisplayGuidelines() {
    if (!state.db) return;
    const guidelineQuery = query(collection(state.db, 'orderbot_guidelines'));
    const querySnapshot = await getDocs(guidelineQuery);
    dom.guidelinesList().innerHTML = '';
    if (querySnapshot.empty) {
        dom.guidelinesList().innerHTML = '<p class="text-slate-400 italic">No custom guidelines have been added yet.</p>';
        return;
    }
    querySnapshot.forEach(d => {
        const guidelineData = d.data();
        const div = document.createElement('div');
        div.className = 'flex items-center justify-between bg-indigo-50 p-2 rounded';
        div.innerHTML = `<span>- ${guidelineData.enhancedGuideline}</span><button data-id="${d.id}" class="delete-guideline-btn text-red-400 hover:text-red-600 font-bold text-lg">&times;</button>`;
        dom.guidelinesList().appendChild(div);
    });
}
