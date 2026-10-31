# API image for Cloud Run (apps/api). It lives at the repository root because the API
# imports the workspace package packages/contracts, so the build needs the whole workspace.
FROM oven/bun:1.4.2-slim

# Outbound HTTPS (Supabase, Gemini) needs ca-certificates.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api
# The web app's manifest is part of the workspace lockfile; its source isn't needed here.
COPY apps/web/package.json apps/web/package.json

# Also runs `prisma generate` (apps/api postinstall) for this Linux image.
RUN bun install --frozen-lockfile

WORKDIR /app/apps/api
ENV NODE_ENV=production
# Cloud Run sets PORT (8080).
CMD ["bun", "src/server.ts"]
