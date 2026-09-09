# Multi-stage build for production
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
# Copy package files, prisma schema and scripts first so postinstall can run prisma generate
COPY package*.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY scripts ./scripts

# Install pnpm and dependencies
# Pin pnpm to the version in package.json's "packageManager" — pnpm >=10.16
# refuses to run if the installed binary can't be verified against that field.
RUN npm install -g pnpm@10.6.3
RUN pnpm install --frozen-lockfile
RUN pnpm exec prisma generate || true

# Copy source code and build
COPY . .
RUN pnpm run build

# Production image
FROM node:18-alpine AS production

WORKDIR /app

# Install pnpm (same pinned version as the builder stage)
RUN npm install -g pnpm@10.6.3

# Copy package files and install only production dependencies
# Copy package files, prisma schema and scripts
COPY package*.json pnpm-lock.yaml ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts

# Install only production dependencies (approve builds may be required on CI)
RUN pnpm install --frozen-lockfile --prod

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# Expose port
EXPOSE 3333

# Start command
CMD ["pnpm", "start"]