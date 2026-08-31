FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json package-lock.json* .npmrc ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && npm ci \
  && npx playwright install chromium \
  && apt-get purge -y python3 make g++ \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
ENV DB_PATH=/data/dear-robot.db
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 libgbm1 \
    libgtk-3-0 libnspr4 libnss3 libx11-xcb1 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libxshmfence1 libpango-1.0-0 libxkbcommon0 fonts-liberation \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data /obsidian /ms-playwright \
  && chown -R node:node /data /obsidian /ms-playwright
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=deps --chown=node:node /ms-playwright /ms-playwright
USER node
EXPOSE 3000
CMD ["node", "build"]
