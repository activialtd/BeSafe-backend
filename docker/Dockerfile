# ── Stage 1: builder ─────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# System deps for argon2 (needs C++ toolchain)
RUN apk add --no-cache python3 make g++ 

COPY package.json ./
RUN npm install --no-audit --no-fund --loglevel=error

COPY tsconfig.json nest-cli.json ./
COPY src ./src
COPY drizzle.config.ts ./
RUN npm run build

# ── Stage 2: runner ──────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# Runtime deps only
RUN apk add --no-cache dumb-init

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund --loglevel=error && \
    npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/db/migrations ./src/db/migrations

ENV NODE_ENV=production
EXPOSE 4000

USER node
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
