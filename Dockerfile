# Backend Dockerfile
FROM node:22-alpine

WORKDIR /app

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files first for layer caching
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Create runtime directories
RUN mkdir -p logs \
    uploads/admin-profiles \
    uploads/profile-pictures \
    uploads/payment-receipts \
    uploads/advertisements \
    uploads/worker-verification

EXPOSE 5000

# Application health endpoint is /health (not /api/health)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => process.exit(1))"

CMD ["node", "index.js"]
