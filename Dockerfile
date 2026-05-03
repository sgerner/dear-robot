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
ENV DB_PATH=/data/dear-robot.db
RUN addgroup --system dear-robot && adduser --system --ingroup dear-robot dear-robot && mkdir -p /data && chown -R dear-robot:dear-robot /data
COPY --from=build --chown=dear-robot:dear-robot /app/build ./build
COPY --from=build --chown=dear-robot:dear-robot /app/package.json ./package.json
COPY --from=deps --chown=dear-robot:dear-robot /app/node_modules ./node_modules
USER dear-robot
EXPOSE 3000
CMD ["node", "build"]
