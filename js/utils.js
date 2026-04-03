// js/utils.js
// Shared utility functions: file encoding, drop zone setup, retry fetch.

import { PROXY_API_URL, COMPARISON_MAX_RETRIES, COMPARISON_INITIAL_DELAY, COMPARISON_TIMEOUT_MS, MAX_BACKOFF_MS } from './config.js';

// -----------------------------------------------------------------------
// fileToB64 — converts a File object to a base64-encoded object
// -----------------------------------------------------------------------
export function fileToB64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve({
            name: file.name,
            type: file.type,
            data: reader.result.split(',')[1],
        });
        reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    });
}

// -----------------------------------------------------------------------
// setupDropZone — attaches drag/drop and click-to-browse to a drop zone
// -----------------------------------------------------------------------
export function setupDropZone(dropZone, fileInput, fileList, fileArray, onFilesChanged) {
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        handleFiles(e.dataTransfer.files, fileList, fileArray, onFilesChanged);
    });
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files, fileList, fileArray, onFilesChanged));
}

function handleFiles(files, fileListElem, fileArray, onFilesChanged) {
    fileArray.length = 0;
    [...files].forEach(file => {
        if (['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) fileArray.push(file);
    });
    updateFileList(fileListElem, fileArray);
    if (onFilesChanged) onFilesChanged();
}

export function updateFileList(listElement, fileArray) {
    listElement.innerHTML = '';
    fileArray.forEach(file => {
        const li = document.createElement('li');
        li.className = 'file-item flex items-center justify-between bg-slate-100 p-2 rounded-md mt-2';
        li.innerHTML = `<span class="text-sm text-slate-700 truncate">${file.name}</span> <span class="text-xs text-slate-500">${(file.size / 1024).toFixed(1)} KB</span>`;
        listElement.appendChild(li);
    });
}

// -----------------------------------------------------------------------
// setupCollapsible — toggles max-height on a collapsible section
// -----------------------------------------------------------------------
export function setupCollapsible(header, content) {
    header.addEventListener('click', () => {
        header.classList.toggle('open');
        content.style.maxHeight = content.style.maxHeight ? null : `${content.scrollHeight}px`;
    });
}

// -----------------------------------------------------------------------
// fetchWithRetry — shared retry/timeout wrapper for all Gemini proxy calls.
//
// Options:
//   maxRetries   — total attempts before throwing (default COMPARISON_MAX_RETRIES)
//   initialDelay — starting backoff in ms (default COMPARISON_INITIAL_DELAY)
//   timeoutMs    — AbortController hard timeout per attempt
//   signal       — external AbortSignal for user-initiated cancellation
//
// Returns { resultText } on success; throws on final failure.
// -----------------------------------------------------------------------
export async function fetchWithRetry(proxyPayload, {
    maxRetries   = COMPARISON_MAX_RETRIES,
    initialDelay = COMPARISON_INITIAL_DELAY,
    timeoutMs    = COMPARISON_TIMEOUT_MS,
    signal: externalSignal,
} = {}) {
    let delay = initialDelay;
    let resultText;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (externalSignal?.aborted) throw new Error('Comparison cancelled by user.');

        const controller = new AbortController();
        const timeoutId  = setTimeout(() => controller.abort(), timeoutMs);

        // Propagate external cancellation into the per-request AbortController.
        const onExternalAbort = () => controller.abort();
        externalSignal?.addEventListener('abort', onExternalAbort);

        try {
            const response = await fetch(PROXY_API_URL, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(proxyPayload),
                signal:  controller.signal,
            });
            clearTimeout(timeoutId);
            resultText = await response.text();

            if (response.ok) break;

            if (response.status === 503 || response.status === 429 || response.status >= 500) {
                if (attempt === maxRetries) throw new Error(`API Error: ${response.status} ${response.statusText} - ${resultText}`);
                const jitter = Math.random() * 1000;
                console.warn(`Attempt ${attempt} encountered ${response.status}. Retrying in ${((delay + jitter) / 1000).toFixed(1)}s...`);
                await new Promise(r => setTimeout(r, delay + jitter));
                delay = Math.min(delay * 2, MAX_BACKOFF_MS);
            } else {
                throw new Error(`API Error: ${response.status} ${response.statusText} - ${resultText}`);
            }
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                if (externalSignal?.aborted) throw new Error('Comparison cancelled by user.');
                throw new Error(`Request timed out after ${timeoutMs / 1000} seconds. The document may be too complex — try with fewer files.`);
            }
            if (attempt === maxRetries) throw error;
            const jitter = Math.random() * 1000;
            console.warn(`Network error on attempt ${attempt}: ${error.message}. Retrying in ${((delay + jitter) / 1000).toFixed(1)}s...`);
            await new Promise(r => setTimeout(r, delay + jitter));
            delay = Math.min(delay * 2, MAX_BACKOFF_MS);
        } finally {
            externalSignal?.removeEventListener('abort', onExternalAbort);
        }
    }

    return { resultText };
}
