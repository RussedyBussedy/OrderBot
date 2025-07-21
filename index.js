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

// --- CORS Preflight Handling ---
// This must come before the main route to handle OPTIONS requests correctly.
app.options('/', (req, res) => {
    res.set('Access-Control-Allow-Origin', 'https://russedybussedy.github.io');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).send('');
});

// --- Main Proxy Route ---
app.post('/', async (req, res) => {
  res.set('Access-Control-Allow-Origin', 'https://russedybussedy.github.io');
  res.set('Access-Control-Allow-Methods', 'POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

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
    
    // ADDED: Safety settings to reduce the chance of the AI blocking the response.
    const safetySettings = [
        { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
        { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
        { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
        { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" }
    ];

    // Add safety settings to the payload sent to Gemini
    payload.safetySettings = safetySettings;

    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    const apiResponse = await fetch(geminiApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const responseBody = await apiResponse.text();
    
    // Set the same status code as the Gemini API response
    res.status(apiResponse.status);
    
    // Forward the exact response body (whether it's an error or success)
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
