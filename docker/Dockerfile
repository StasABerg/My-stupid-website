FROM node:24-alpine AS build
WORKDIR /app
COPY app/package.json ./package.json
COPY app/package-lock.json ./package-lock.json
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY app/ .
RUN npm run build 

FROM nginx:stable-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
RUN mkdir -p /var/cache/nginx /var/run /var/log/nginx \
 && chown -R nginx:nginx /var/cache/nginx /var/run /var/log/nginx /etc/nginx/conf.d \
 && sed -i '/^user /d' /etc/nginx/nginx.conf
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html
USER nginx
CMD ["nginx","-g","daemon off;"]