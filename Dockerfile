FROM node:20-slim

# Install Playwright dependencies
RUN npx playwright install --with-deps chromium

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Expose API port
EXPOSE 3001

CMD ["npm", "start"]
