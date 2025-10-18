FROM node:25-alpine

WORKDIR /app

COPY terminal-service/package.json ./package.json
COPY terminal-service/src ./src

ENV NODE_ENV=production \
    PORT=8080 \
    SANDBOX_ROOT=/sandbox \
    COMMAND_TIMEOUT_MS=3000 \
    MAX_PAYLOAD_BYTES=2048 \
    MAX_OUTPUT_BYTES=16384


#test
RUN mkdir -p "$SANDBOX_ROOT" && chown node:node "$SANDBOX_ROOT"

USER node

CMD ["node", "src/index.js"]
