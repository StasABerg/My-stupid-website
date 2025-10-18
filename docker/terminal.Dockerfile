FROM node:25-alpine AS build
WORKDIR /app
COPY terminal-service/package.json terminal-service/package-lock.json* ./
RUN npm install --omit=dev

FROM node:25-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    SANDBOX_ROOT=/sandbox \
    COMMAND_TIMEOUT_MS=3000 \
    MAX_PAYLOAD_BYTES=2048 \
    MAX_OUTPUT_BYTES=16384
COPY --from=build /app/node_modules ./node_modules
COPY terminal-service/package.json ./package.json
COPY terminal-service/src ./src
RUN mkdir -p "$SANDBOX_ROOT" && chown node:node "$SANDBOX_ROOT"
EXPOSE 8080
USER node
CMD ["node", "src/index.js"]
