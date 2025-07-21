// File: index.js

const express = require('express');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

const app = express();
app.use(express.json()); // Middleware to parse JSON bodies

// --- Secret Manager Configuration ---
const secretManagerClient = new SecretManagerServiceClient();
// Updated with your Project ID and Secret Name
const secretName = 'projects/orderbot-2b212/secrets/gemini-api-key/versions/latest';
let cachedSecret;

async function getApiKey() {
  if (cachedSecret) return cachedSecret;
  const [version] = await secretManagerClient.accessSecretVersion({ name: secretName });
  const apiKey = version.payload.data.toString('utf8');
  cachedSecret = apiKey;
  return apiKey;
}

// --- Main Proxy Route ---
app.post('/', async (req, res) => {
  // Set CORS headers to allow your website to call this endpoint
  res.set('Access-Control-Allow-Origin', 'https://RussedyBussedy.github.io');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  try {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error("API Key not found in Secret Manager.");

    // The frontend now sends the full payload, including the model name in the URL
    // This makes the proxy more flexible. We will construct the URL here.
    const { model, payload } = req.body;
    if (!model || !payload) {
        return res.status(400).json({ error: "Request body must include 'model' and 'payload' keys." });
    }

    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    const apiResponse = await fetch(geminiApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload) // Pass the inner payload to Gemini
    });

    // Improved error handling: get the response body regardless of status
    const responseBody = await apiResponse.text();
    if (!apiResponse.ok) {
        console.error("Gemini API Error:", responseBody);
        // Forward the exact error and status from Gemini
        return res.status(apiResponse.status).send(responseBody);
    }
    
    // If successful, forward the JSON response
    res.status(200).json(JSON.parse(responseBody));

  } catch (error) {
    console.error("Error in Cloud Run service:", error);
    res.status(500).send(`Internal Server Error: ${error.message}`);
  }
});

// --- CORS Preflight Handling ---
app.options('/', (req, res) => {
    res.set('Access-Control-Allow-Origin', 'https://RussedyBussedy.github.io');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).send('');
});


// --- Start the server ---
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
