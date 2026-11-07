# Multi-stage production build for ABARSO AI
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies needed for node-gyp if necessary
RUN apk add --no-cache python3 make g++

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# Production runtime stage
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Create persistent storage directories
RUN mkdir -p /app/data /app/baileys_auth_info

VOLUME ["/app/data", "/app/baileys_auth_info"]

CMD ["node", "dist/index.js"]

