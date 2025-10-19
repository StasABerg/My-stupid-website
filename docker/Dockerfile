FROM node:25-alpine AS build
WORKDIR /app
COPY app/package.json ./package.json
RUN --mount=type=cache,target=/root/.npm npm install --package-lock-only --no-audit --no-fund
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY app/ .
RUN npm run build
#test
FROM nginx:stable-alpine
RUN apk add --no-cache nginx-mod-http-js
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY deploy/sitemap.js  /etc/nginx/sitemap.js
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html
RUN mkdir -p /var/cache/nginx /var/run /var/log/nginx \
 && chown -R nginx:nginx /var/cache/nginx /var/run /var/log/nginx /etc/nginx/conf.d \
 && sed -i '/^user /d' /etc/nginx/nginx.conf
USER nginx
CMD ["nginx","-g","daemon off;"]
