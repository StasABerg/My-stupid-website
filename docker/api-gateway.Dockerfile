FROM node:25-alpine

WORKDIR /app

COPY --chown=node:node api-gateway-service/package.json ./package.json

USER node

RUN --mount=type=cache,target=/home/node/.npm npm install --package-lock-only --no-audit --no-fund
RUN --mount=type=cache,target=/home/node/.npm npm ci --omit=dev --no-audit --no-fund

COPY --chown=node:node api-gateway-service/src ./src

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "src/server.js"]
