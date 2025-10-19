FROM node:25-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    SANDBOX_ROOT=/sandbox \
    COMMAND_TIMEOUT_MS=3000 \
    MAX_PAYLOAD_BYTES=2048 \
    MAX_OUTPUT_BYTES=16384
COPY terminal-service/package.json ./
RUN --mount=type=cache,target=/root/.npm npm install --package-lock-only --omit=dev --no-audit --no-fund
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund
COPY terminal-service/src ./src
RUN mkdir -p "$SANDBOX_ROOT" && chown node:node "$SANDBOX_ROOT"
EXPOSE 8080
USER node
CMD ["node", "src/index.js"]
