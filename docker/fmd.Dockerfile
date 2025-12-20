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
COPY fmd ./fmd
WORKDIR /app/fmd
RUN cargo chef prepare --recipe-path recipe.json

FROM base AS build
WORKDIR /app/fmd
COPY --from=planner /app/fmd/recipe.json ./recipe.json
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/app/target \
    --mount=type=cache,target=/sccache \
    cargo chef cook --release --recipe-path recipe.json
COPY fmd/ .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/app/target \
    --mount=type=cache,target=/sccache \
    cargo build --release

FROM lightpanda/browser:nightly AS lightpanda

FROM debian:trixie-slim AS runner
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    bash -c 'set -eux; \
    rm -rf /var/lib/apt/lists/*; \
    mkdir -p /var/lib/apt/lists/partial; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates; \
    rm -rf /var/lib/apt/lists/*' && \
    groupadd -r fmd -g 101 && \
    useradd -r -g fmd -u 101 fmd
WORKDIR /app
COPY --from=build /app/fmd/target/release/fmd /usr/local/bin/fmd
COPY --from=lightpanda /bin/lightpanda /usr/local/bin/lightpanda

ENV RUST_LOG=info
ENV PORT=4020
ENV LIGHTPANDA_DISABLE_TELEMETRY=true
EXPOSE 4020
USER fmd
ENTRYPOINT ["/usr/local/bin/fmd"]
