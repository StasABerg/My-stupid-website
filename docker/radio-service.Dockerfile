FROM rust:slim AS base
RUN apt-get update && \
    apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates && \
    rm -rf /var/lib/apt/lists/*
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
    cargo chef cook --release --recipe-path recipe.json
COPY radio-service-rs/ .
COPY radio-service/migrations ../radio-service/migrations
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    cargo build --release

FROM debian:trixie-slim AS runner
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    useradd -r -u 1000 radio
WORKDIR /app
COPY --from=build /app/radio-service-rs/target/release/radio-service-rs /usr/local/bin/radio-service
COPY radio-service/migrations ./migrations
ENV RUST_LOG=info
USER radio
EXPOSE 4010
ENTRYPOINT ["/usr/local/bin/radio-service"]
