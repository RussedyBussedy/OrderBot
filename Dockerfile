# Use a pinned Node.js version for reproducible builds
FROM node:20.18.0-slim

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Bundle app source
COPY . .

# Drop root privileges — run as the built-in non-root 'node' user
USER node

# Your app binds to port 8080
EXPOSE 8080

# Health check so Cloud Run knows the container is ready
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Define the command to run the app
CMD [ "npm", "start" ]
