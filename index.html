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
  // This is now locked down to your specific GitHub Pages URL
  res.set('Access-Control-Allow-Origin', 'https://RussedyBussedy.github.io');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  try {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error("API Key not found in Secret Manager.");

    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`;

    const apiResponse = await fetch(geminiApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });

    const data = await apiResponse.json();
    if (!apiResponse.ok) {
        console.error("Gemini API Error:", data);
        return res.status(apiResponse.status).json(data);
    }

    res.status(200).json(data);

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
```json
// File: package.json

{
  "name": "cloudrun-gemini-proxy",
  "version": "1.0.0",
  "description": "Secure proxy for Google Gemini API on Cloud Run",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "@google-cloud/secret-manager": "^5.0.1",
    "express": "^4.18.2"
  }
}
```dockerfile
# File: Dockerfile

# Use an official Node.js runtime as a parent image
FROM node:20-slim

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install app dependencies
RUN npm install

# Bundle app source
COPY . .

# Your app binds to port 8080 so you need to expose it
EXPOSE 8080

# Define the command to run your app
CMD [ "npm", "start" ]
