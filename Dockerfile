# Multi-stage build for production
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
# Copy package files and prisma schema first so postinstall can run prisma generate
COPY package*.json pnpm-lock.yaml ./
COPY prisma ./prisma

# Install pnpm and dependencies
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile
RUN pnpm exec prisma generate || true

# Copy source code and build
COPY . .
RUN pnpm run build

# Production image
FROM node:18-alpine AS production

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files and install only production dependencies
# Copy package files and prisma schema
COPY package*.json pnpm-lock.yaml ./
COPY --from=builder /app/prisma ./prisma

# Install only production dependencies (approve builds may be required on CI)
RUN pnpm install --frozen-lockfile --prod

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# Expose port
EXPOSE 3333

# Start command
CMD ["pnpm", "start"]