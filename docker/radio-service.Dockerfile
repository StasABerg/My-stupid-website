FROM node:25-alpine AS build
WORKDIR /app
COPY radio-service/package.json ./
RUN --mount=type=cache,target=/root/.npm npm install --package-lock-only --omit=dev --no-audit --no-fund
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund

FROM node:25-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY radio-service/package.json ./package.json
COPY radio-service/src ./src
COPY radio-service/migrations ./migrations
RUN chown -R node:node /app
USER node
EXPOSE 4010
CMD ["node", "src/server/index.js"]
