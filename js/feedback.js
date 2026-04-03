// js/feedback.js
// Feedback modal: submit corrections, paste images, enhance via Flash model.

import { collection, addDoc } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

import { MODEL_FLASH, FLASH_MAX_RETRIES, FLASH_INITIAL_DELAY, FLASH_TIMEOUT_MS } from './config.js';
import { state } from './state.js';
import { dom } from './dom-refs.js';
import { fetchWithRetry } from './utils.js';

export function setupFeedback() {
    dom.cancelFeedbackBtn().addEventListener('click', () => {
        dom.feedbackModal().style.display = 'none';
        dom.feedbackExplanation().value = '';
        state.pastedImageB64 = null;
        dom.feedbackImageContainer().classList.add('hidden');
        dom.feedbackImagePreview().src = '';
        dom.feedbackExplanation().style.paddingLeft = '0.5rem';
    });

    dom.submitFeedbackBtn().addEventListener('click', async () => {
        if (!state.itemToCorrect || !dom.feedbackExplanation().value.trim()) {
            alert('Please provide an explanation.');
            return;
        }
        const submitBtn = dom.submitFeedbackBtn();
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<div class="loader !w-5 !h-5 !border-2 mx-auto"></div>`;

        try {
            const enhancementPrompt = `You are an expert prompt engineer. A user has provided a guideline for an AI document comparison tool. Rewrite their text into a clear, precise, and unambiguous rule that the AI can easily follow. User's text: "${dom.feedbackExplanation().value.trim()}"`;
            const enhancementParts = [{ text: enhancementPrompt }];
            if (state.pastedImageB64) {
                enhancementParts.push({ inlineData: { mimeType: 'image/png', data: state.pastedImageB64.split(',')[1] } });
            }

            const geminiPayload = { contents: [{ role: 'user', parts: enhancementParts }] };
            const proxyPayload = { model: MODEL_FLASH, payload: geminiPayload };

            const { resultText: enhanceText } = await fetchWithRetry(proxyPayload, {
                maxRetries: FLASH_MAX_RETRIES,
                initialDelay: FLASH_INITIAL_DELAY,
                timeoutMs: FLASH_TIMEOUT_MS,
            });
            const result = JSON.parse(enhanceText);
            const enhancedExplanation = result.candidates[0].content.parts[0].text;

            const feedbackData = {
                userId: state.userId,
                timestamp: new Date().toISOString(),
                incorrectItem: state.itemToCorrect,
                userExplanation: dom.feedbackExplanation().value.trim(),
                enhancedExplanation,
            };
            if (state.pastedImageB64) feedbackData.imageSnippet = state.pastedImageB64;

            await addDoc(collection(state.db, 'orderbot_feedback'), feedbackData);
            dom.cancelFeedbackBtn().click();
        } catch (error) {
            console.error('Error submitting feedback:', error);
            alert('Failed to submit feedback. The original explanation will be saved.');
            const fallbackData = {
                userId: state.userId,
                timestamp: new Date().toISOString(),
                incorrectItem: state.itemToCorrect,
                userExplanation: dom.feedbackExplanation().value.trim(),
                enhancedExplanation: `RAW: ${dom.feedbackExplanation().value.trim()}`,
            };
            if (state.pastedImageB64) fallbackData.imageSnippet = state.pastedImageB64;
            await addDoc(collection(state.db, 'orderbot_feedback'), fallbackData);
            dom.cancelFeedbackBtn().click();
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Feedback';
        }
    });

    dom.feedbackTextareaContainer().addEventListener('paste', (event) => {
        const items = (event.clipboardData || event.originalEvent.clipboardData).items;
        for (const item of items) {
            if (item.kind === 'file') {
                const blob = item.getAsFile();
                const reader = new FileReader();
                reader.onload = (e) => {
                    state.pastedImageB64 = e.target.result;
                    dom.feedbackImagePreview().src = state.pastedImageB64;
                    dom.feedbackImageContainer().classList.remove('hidden');
                    dom.feedbackExplanation().style.paddingLeft = '72px';
                };
                reader.readAsDataURL(blob);
                event.preventDefault();
            }
        }
    });

    dom.feedbackImageDelete().addEventListener('click', () => {
        state.pastedImageB64 = null;
        dom.feedbackImageContainer().classList.add('hidden');
        dom.feedbackImagePreview().src = '';
        dom.feedbackExplanation().style.paddingLeft = '0.5rem';
    });
}
