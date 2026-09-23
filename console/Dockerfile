# syntax=docker/dockerfile:1.7
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-slim
LABEL org.opencontainers.image.title="OpenSnowcat Console" \
      org.opencontainers.image.description="Live good/bad event stream, schema editing and pipeline control for the OpenSnowcat devkit" \
      org.opencontainers.image.source="https://github.com/opensnowcat/opensnowcat-devkit" \
      org.opencontainers.image.licenses="Apache-2.0"
WORKDIR /app
ENV NODE_ENV=production \
    NITRO_HOST=0.0.0.0 \
    NITRO_PORT=3000 \
    NUXT_KAFKA_BROKERS=warp:9092 \
    NUXT_SCHEMAS_DIR=/schemas \
    NUXT_OPENSNOWCAT_DIR=/opensnowcat \
    NUXT_COLLECTOR_URL=http://opensnowcat_collector:8080 \
    NUXT_CONSOLE_REGISTRY_URL=http://console:3000/iglu
COPY --from=build /app/.output ./.output
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
