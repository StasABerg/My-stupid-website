FROM rust:slim AS base
ENV DEBIAN_FRONTEND=noninteractive
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    bash -c 'set -eux; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*.deb /var/cache/apt/archives/partial/*; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        clang \
        lld \
        pkg-config \
        libssl-dev \
        sccache; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*.deb /var/cache/apt/archives/partial/*'
ENV RUSTC_WRAPPER="/usr/bin/sccache"
ENV SCCACHE_DIR="/sccache"
ENV SCCACHE_CACHE_SIZE="10G"
ENV RUSTFLAGS="-C linker=clang -C link-arg=-fuse-ld=lld"
RUN cargo install cargo-chef
WORKDIR /app

FROM base AS planner
COPY radio-service-rs ./radio-service-rs
WORKDIR /app/radio-service-rs
RUN cargo chef prepare --recipe-path recipe.json

FROM base AS build
WORKDIR /app/radio-service-rs
COPY --from=planner /app/radio-service-rs/recipe.json ./recipe.json
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/app/target \
    --mount=type=cache,target=/sccache \
    cargo chef cook --release --recipe-path recipe.json
COPY radio-service-rs/ .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/app/target \
    --mount=type=cache,target=/sccache \
    cargo build --release

FROM debian:trixie-slim AS runner
RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt \
    apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    useradd -r -u 1000 radio
WORKDIR /app
COPY --from=build /app/radio-service-rs/target/release/radio-service-rs /usr/local/bin/radio-service
COPY --from=build /app/radio-service-rs/migrations ./migrations
ENV RUST_LOG=info
USER radio
EXPOSE 4010
ENTRYPOINT ["/usr/local/bin/radio-service"]
