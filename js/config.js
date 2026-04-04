// js/config.js
// Central configuration — all constants, model names, thresholds, and blind type arrays.
// Update this file when adopting new Gemini models or changing business rules.

export const PROXY_API_URL = 'https://gemini-secure-proxy-51064902388.africa-south1.run.app';

// Models
export const MODEL_COMPARISON = 'gemini-2.5-pro';
export const MODEL_FLASH      = 'gemini-3-flash-preview';

// AI call thresholds
export const COMPARISON_MAX_RETRIES   = 3;
export const COMPARISON_INITIAL_DELAY = 2000;   // ms
export const COMPARISON_TIMEOUT_MS    = 300000; // 300 s — match Cloud Run's timeout
export const FLASH_MAX_RETRIES        = 2;
export const FLASH_INITIAL_DELAY      = 1000;   // ms
export const FLASH_TIMEOUT_MS         = 30000;  // 30 s
export const MAX_BACKOFF_MS           = 16000;  // cap for exponential backoff

// Payload size guards
export const PAYLOAD_WARN_MB  = 9;
export const PAYLOAD_MAX_MB   = 10;

// Comparison limits
export const FEEDBACK_FETCH_LIMIT = 10;
export const MAX_LINE_ITEMS       = 100;
export const HISTORY_FETCH_LIMIT  = 10;
export const MAX_ORDER_PAIRS      = 10;

// Motor torque constants
export const BOTTOM_BAR_WEIGHT_KG_PER_M = 0.280; // 280 g/m bottom bar
export const GRAVITY                    = 9.81;   // m/s²

// Blind types that do NOT require a colour to be specified.
export const BLIND_TYPE_EXCLUSIONS_FOR_COLOUR_CHECK = [
    'element double roller',
    'curtain glide curtain ripple',
    'curtain somfy',
    'curtain motion',
];

// Blind types that require BOTH control columns to be populated.
export const BLIND_TYPES_REQUIRING_DUAL_CONTROL = [
    'element roller sys 40',
    'roller system 55',
    'element double roller',
    'outdoor free hang',
    'element vision',
    'vision blind',
];

// Blind types that must have a chain, motor, or dual control keyword.
export const BLIND_TYPES_REQUIRING_CONTROL_VALIDATION = [
    'element roller',
    'roller system 40',
    'roller system 55',
    'element vison',
    'vision blind',
    'romashade',
    'outdoor channel x',
    'outdoor free hang',
    'outdoor zip x',
    'outdoor wire x',
    'outdoor widescreen',
];

// Fields every line item must have after extraction.
export const REQUIRED_LINE_ITEM_FIELDS = [
    'item', 'location', 'qty', 'width', 'drop',
    'colour', 'control1', 'control2', 'blindType', 'range', 'fix',
];
