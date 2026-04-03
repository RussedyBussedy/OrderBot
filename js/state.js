// js/state.js
// Centralized mutable application state.
// All modules import this object and mutate its properties directly.
// No reactive framework is needed — the app is purely event-driven.

export const state = {
    comparisonPairs: [],         // Array of { customerFiles, blindIQFiles }
    itemToCorrect: null,         // The report field currently open in the feedback modal
    pastedImageB64: null,        // Base64 image pasted into the feedback textarea
    historyDataCache: [],        // Most recently retrieved history documents
    summaryResultsCache: [],     // Results from the current batch comparison
    confirmCallback: null,       // Pending callback for the confirmation modal
    comparisonAbortController: null, // AbortController for the active comparison batch
    db: null,                    // Firestore instance, set by app.js after Firebase init
    userId: null,                // Anonymous auth UID, set by app.js after sign-in
};
