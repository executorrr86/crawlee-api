FROM node:20-slim

# Cache bust: v2 - Install curl and procps
RUN apt-get update && apt-get install -y curl procps && rm -rf /var/lib/apt/lists/*

# Install Playwright with Chromium
RUN npx playwright install --with-deps chromium

WORKDIR /app

COPY package*.json ./
RUN npm install
COPY . .

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

EXPOSE 3001
CMD ["npm", "start"]
