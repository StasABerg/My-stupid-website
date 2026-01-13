FROM rust:slim AS build
ENV DEBIAN_FRONTEND=noninteractive
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    bash -c 'set -eux; \
    rm -rf /var/lib/apt/lists/*; \
    mkdir -p /var/lib/apt/lists/partial; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        clang \
        lld \
        pkg-config \
        libssl-dev; \
    rm -rf /var/lib/apt/lists/*'
WORKDIR /app
COPY terminal-service-rs ./terminal-service-rs
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/app/target \
    cargo build --release --manifest-path terminal-service-rs/Cargo.toml

FROM debian:trixie-slim
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    bash -c 'set -eux; \
    rm -rf /var/lib/apt/lists/*; \
    mkdir -p /var/lib/apt/lists/partial; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates; \
    rm -rf /var/lib/apt/lists/*' && \
    groupadd -r terminal -g 101 && \
    useradd -r -g terminal -u 101 terminal
WORKDIR /app
COPY --from=build /app/terminal-service-rs/target/release/terminal-service-rs /usr/local/bin/terminal-service-rs
ENV PORT=8080 \
    SANDBOX_ROOT=/sandbox \
    MAX_PAYLOAD_BYTES=2048
RUN mkdir -p "$SANDBOX_ROOT" && chown terminal:terminal "$SANDBOX_ROOT"
EXPOSE 8080
USER terminal
ENTRYPOINT ["/usr/local/bin/terminal-service-rs"]
