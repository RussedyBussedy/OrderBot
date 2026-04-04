// File: index.js

const express = require('express');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');

const app = express();

// --- Security Headers (helmet) ---
// Disable policies that interfere with cross-origin API responses.
app.use(helmet({
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false,
}));

// Increased the JSON payload limit to handle large image data
app.use(express.json({ limit: '10mb' }));

// --- Structured JSON Logging ---
// Outputs JSON to stdout so Cloud Logging can parse severity and metadata automatically.
function log(severity, message, meta = {}) {
    process.stdout.write(JSON.stringify({ severity, message, ...meta }) + '\n');
}

// --- Request ID Middleware ---
// Attaches a unique ID to every request for end-to-end tracing in logs.
app.use((req, res, next) => {
    req.requestId = crypto.randomUUID();
    next();
});

// --- Rate Limiting ---
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30,             // 30 requests per minute per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please wait a moment and try again.' }
});
app.use(limiter);

// --- Secret Manager Configuration ---
const secretManagerClient = new SecretManagerServiceClient();
const secretName = process.env.GEMINI_SECRET_NAME || 'projects/orderbot-2b212/secrets/gemini-api-key/versions/latest';
const SECRET_CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes
let cachedSecret = null;
let cachedSecretExpiry = 0;

async function getApiKey() {
    if (cachedSecret && Date.now() < cachedSecretExpiry) return cachedSecret;
    const [version] = await secretManagerClient.accessSecretVersion({ name: secretName });
    cachedSecret = version.payload.data.toString('utf8');
    cachedSecretExpiry = Date.now() + SECRET_CACHE_TTL_MS;
    return cachedSecret;
}

// --- Model Allowlist ---
// IMPORTANT: Any model referenced in the frontend must appear in this list.
// Can be overridden at runtime via the ALLOWED_MODELS env var (comma-separated).
const ALLOWED_MODELS = process.env.ALLOWED_MODELS
    ? process.env.ALLOWED_MODELS.split(',').map(m => m.trim())
    : [
        'gemini-2.5-pro',
        'gemini-2.5-pro-preview-05-06',
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
        'gemini-1.5-pro',
        'gemini-1.5-flash',
        'gemini-2.5-flash-preview-04-17',
        'gemini-3-flash-preview',
    ];

// --- CORS Configuration ---
// Can be overridden via ALLOWED_ORIGINS env var (comma-separated).
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [
        'https://russedybussedy.github.io',         // Live GitHub Pages site
        'https://app.lab-pa.googleapis.com',        // Canvas preview environment
        'https://blinddesignscoza.sharepoint.com',  // SharePoint site
        'http://localhost:3000',                    // Local dev (npx serve)
        'http://localhost:5000',                    // Local dev (python http.server)
    ];

const handleCors = (req, res, next) => {
    const origin = req.headers.origin;
    log('DEBUG', 'Request received', { requestId: req.requestId, origin });

    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        log('WARNING', 'Origin not in allowed list', { requestId: req.requestId, origin });
    }

    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
};

app.use(handleCors);

// --- Routes ---
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

app.options('/', (req, res) => {
    res.status(204).send('');
});

app.post('/', async (req, res) => {
    const { requestId } = req;
    try {
        const apiKey = await getApiKey();
        if (!apiKey) {
            log('ERROR', 'API Key not found in Secret Manager.', { requestId });
            return res.status(500).json({ error: 'API Key is not configured on the server.' });
        }

        let { model, payload } = req.body;

        if (!model || !payload) {
            return res.status(400).json({ error: "Request body must include 'model' and 'payload' keys." });
        }

        if (!ALLOWED_MODELS.includes(model)) {
            log('WARNING', 'Rejected disallowed model', { requestId, model });
            return res.status(400).json({ error: `Model '${model}' is not permitted.` });
        }

        const safetySettings = [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
        ];
        payload.safetySettings = safetySettings;

        // API key sent as a header (not in the query string) to prevent leaking in logs.
        const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

        // Hard timeout matching the frontend's 120-second AbortController timeout.
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000);

        let apiResponse;
        try {
            apiResponse = await fetch(geminiApiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeoutId);
        }

        const responseBody = await apiResponse.text();
        log('INFO', 'Gemini API call completed', { requestId, model, status: apiResponse.status });
        res.status(apiResponse.status).send(responseBody);

    } catch (error) {
        if (error.name === 'AbortError') {
            log('ERROR', 'Gemini API request timed out', { requestId });
            return res.status(504).json({ error: 'Upstream API request timed out after 120 seconds.' });
        }
        log('ERROR', 'Unhandled error in request handler', { requestId, message: error.message });
        res.status(500).json({ error: 'Internal Server Error.' });
    }
});

// --- Custom 413 error handler ---
app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Payload too large. Maximum request size is 10MB.' });
    }
    log('ERROR', 'Unhandled middleware error', { requestId: req.requestId, message: err.message });
    res.status(500).json({ error: 'Internal Server Error.' });
});

// --- Start the server ---
const port = process.env.PORT || 8080;
const server = app.listen(port, () => {
    log('INFO', `Server listening on port ${port}`);
});

// --- Graceful Shutdown ---
// Cloud Run sends SIGTERM when stopping a container. We close the HTTP server
// to drain in-flight requests before the process exits.
process.on('SIGTERM', () => {
    log('INFO', 'SIGTERM received — shutting down gracefully');
    server.close(() => {
        log('INFO', 'HTTP server closed');
        process.exit(0);
    });
});
