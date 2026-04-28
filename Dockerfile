FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* .npmrc ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && npm ci --build-from-source=better-sqlite3 \
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
ENV DB_PATH=/data/triage.db
RUN addgroup --system triage && adduser --system --ingroup triage triage && mkdir -p /data && chown -R triage:triage /data
COPY --from=build --chown=triage:triage /app/build ./build
COPY --from=build --chown=triage:triage /app/package.json ./package.json
COPY --from=deps --chown=triage:triage /app/node_modules ./node_modules
USER triage
EXPOSE 3000
CMD ["node", "build"]
