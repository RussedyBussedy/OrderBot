// File: index.js

const express = require('express');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

const app = express();
// Increased the JSON payload limit to handle large image data
app.use(express.json({ limit: '10mb' }));

// --- Secret Manager Configuration ---
const secretManagerClient = new SecretManagerServiceClient();
const secretName = 'projects/orderbot-2b212/secrets/gemini-api-key/versions/latest';
let cachedSecret;

async function getApiKey() {
  if (cachedSecret) return cachedSecret;
  const [version] = await secretManagerClient.accessSecretVersion({ name: secretName });
  const apiKey = version.payload.data.toString('utf8');
  cachedSecret = apiKey;
  return apiKey;
}

// --- CORS Configuration ---
const allowedOrigins = [
    'https://russedybussedy.github.io',    // Your live GitHub Pages site
    'https://app.lab-pa.googleapis.com', // The Canvas preview environment
    'https://blinddesignscoza.sharepoint.com' // Your SharePoint site
];

const handleCors = (req, res, next) => {
    const origin = req.headers.origin;
    
    // ADDED: Log the origin of every request for debugging
    console.log(`Request received from origin: ${origin}`);

    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        // ADDED: Log if the origin is not allowed
        console.warn(`Origin ${origin} not in allowed list.`);
    }

    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
};

// --- Routes ---
// Use the CORS handler for all routes
app.use(handleCors);

app.options('/', (req, res) => {
    // The handleCors middleware already sets the headers.
    // Just send a success status for the preflight request.
    res.status(204).send('');
});

app.post('/', async (req, res) => {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) {
        console.error("API Key not found in Secret Manager.");
        return res.status(500).json({ error: "API Key is not configured on the server." });
    }

    let { model, payload } = req.body;
    if (!model || !payload) {
        return res.status(400).json({ error: "Request body must include 'model' and 'payload' keys." });
    }
    
    const safetySettings = [
        { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
        { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
        { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
        { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" }
    ];

    payload.safetySettings = safetySettings;

    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    const apiResponse = await fetch(geminiApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const responseBody = await apiResponse.text();
    res.status(apiResponse.status);
    res.send(responseBody);

  } catch (error) {
    console.error("Error in Cloud Run service:", error);
    res.status(500).json({ error: `Internal Server Error: ${error.message}` });
  }
});

// --- Start the server ---
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

