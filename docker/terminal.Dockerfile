FROM node:25-alpine AS base
WORKDIR /app

COPY terminal-service/package*.json ./
ENV NODE_ENV=production
RUN npm ci --omit=dev

COPY --chown=node:node terminal-service/src ./src

ENV PORT=8080 \
    SANDBOX_ROOT=/sandbox \
    COMMAND_TIMEOUT_MS=3000 \
    MAX_PAYLOAD_BYTES=2048 \
    MAX_OUTPUT_BYTES=16384

RUN mkdir -p "$SANDBOX_ROOT" && chown node:node "$SANDBOX_ROOT"

USER node
EXPOSE 8080
CMD ["node", "src/index.js"]
