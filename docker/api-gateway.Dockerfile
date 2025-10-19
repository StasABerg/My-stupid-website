FROM node:25-alpine

WORKDIR /app

COPY --chown=node:node api-gateway-service/package.json ./package.json
COPY --chown=node:node api-gateway-service/src ./src

USER node

EXPOSE 8080

CMD ["node", "src/server.js"]
