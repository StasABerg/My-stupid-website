FROM node:25-alpine AS build
WORKDIR /app
COPY radio-service/package.json radio-service/package-lock.json* ./
RUN npm install --omit=dev

FROM node:25-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY radio-service/package.json ./package.json
COPY radio-service/src ./src
EXPOSE 4010
CMD ["node", "src/server.js"]
