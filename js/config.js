export const firebaseConfig = {
    apiKey: "AIzaSyB3x__sOsj8EPS9KnpweD6uWIhVt9ACNBM",
    authDomain: "orderbot-2b212.firebaseapp.com",
    projectId: "orderbot-2b212",
    storageBucket: "orderbot-2b212.firebasestorage.app",
    messagingSenderId: "51064902388",
    appId: "1:51064902388:web:20d2d93c682a537ebc04a1",
    measurementId: "G-5RM4TC6BD6"
};

export const PROXY_API_URL = 'https://gemini-secure-proxy-51064902388.africa-south1.run.app';
export const PROMPT_VERSION = 'v2.3';   // v2.3 (Oct 2026): standards, NOT_SPECIFIED, converter reading, corrections with the capturer's words

// Oct 2026: both paths migrated to Gemini 3.8 Flash (GA, no shutdown date), from
// gemini-3-flash-preview (extraction) and gemini-2.5-pro (comparison).
// To revert either path, change its constant back — temperatures follow automatically (see isGemini3).
// Document parsing / OCR extraction (converter) + guideline/feedback helpers.
export const EXTRACTION_MODEL = 'gemini-3.8-flash';
// Order comparison, second-pass re-extraction + converter name-matching (discernment).
export const COMPARISON_MODEL = 'gemini-3.8-flash';

// Gemini 3+ models are tuned for their default temperature (1.0); Google warns that lowering it
// can cause looping or degraded output. Call sites only pin a low temperature for older (2.x)
// models, so reverting a model constant above restores that model's original settings too.
export const isGemini3 = (model) => /^gemini-(?:[3-9]|[1-9]\d)/.test(model || '');
