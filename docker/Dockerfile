FROM rust:1.91-slim AS dioxus-build

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN rustup target add wasm32-unknown-unknown
RUN mkdir -p /root/.cargo/bin
ENV PATH="/root/.cargo/bin:${PATH}"
RUN curl -sSL http://dioxus.dev/install.sh | sh

WORKDIR /app
COPY dioxus-app/Cargo.toml dioxus-app/Cargo.lock dioxus-app/Dioxus.toml /app/dioxus-app/
COPY dioxus-app/src /app/dioxus-app/src
COPY dioxus-app/assets /app/dioxus-app/assets

RUN cd /app/dioxus-app && dx build --web --release --debug-symbols=false

FROM nginx:stable-alpine
RUN apk add --no-cache nginx-mod-http-js
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY deploy/sitemap.js  /etc/nginx/sitemap.js
COPY --from=dioxus-build --chown=nginx:nginx /app/dioxus-app/target/dx/dioxus-app/release/web/public /usr/share/nginx/html
COPY --from=dioxus-build --chown=nginx:nginx /app/dioxus-app/assets/config.json /usr/share/nginx/html/config.json
RUN mkdir -p /var/cache/nginx /var/run /var/log/nginx \
 && chown -R nginx:nginx /var/cache/nginx /var/run /var/log/nginx /etc/nginx/conf.d \
 && sed -i '/^user /d' /etc/nginx/nginx.conf
USER nginx
CMD ["nginx","-g","daemon off;"]
