FROM rust:slim AS base
RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt \
    apt-get update && \
    apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates && \
    rm -rf /var/lib/apt/lists/*
RUN cargo install cargo-chef
WORKDIR /app

FROM base AS planner
COPY api-gateway-service ./api-gateway-service
WORKDIR /app/api-gateway-service
RUN cargo chef prepare --recipe-path recipe.json

FROM base AS build
WORKDIR /app/api-gateway-service
COPY --from=planner /app/api-gateway-service/recipe.json ./recipe.json
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/app/target \
    cargo chef cook --release --recipe-path recipe.json
COPY api-gateway-service/ .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/app/target \
    cargo build --release

FROM debian:trixie-slim AS runner
RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt \
    apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd -r gateway -g 101 && \
    useradd -r -g gateway -u 101 gateway
WORKDIR /app
COPY --from=build /app/api-gateway-service/target/release/api-gateway-service /usr/local/bin/api-gateway-service

ENV RUST_LOG=info
EXPOSE 8080
USER gateway
ENTRYPOINT ["/usr/local/bin/api-gateway-service"]
