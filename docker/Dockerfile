FROM node:20-alpine AS build
WORKDIR /app
COPY app/package.json ./package.json
COPY app/package-lock.json ./package-lock.json
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY app/ .
RUN npm run build 

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html
USER nginx
CMD ["nginx","-g","daemon off;"]