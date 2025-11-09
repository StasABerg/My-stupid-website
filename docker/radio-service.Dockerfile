FROM rust:slim AS build
RUN apt-get update && \
    apt-get install -y --no-install-recommends pkg-config libssl-dev && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY radio-service-rs/Cargo.toml radio-service-rs/Cargo.lock ./radio-service-rs/
COPY radio-service-rs/src ./radio-service-rs/src
COPY radio-service-rs/openapi.json ./radio-service-rs/openapi.json
COPY radio-service/migrations ./radio-service/migrations
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cd radio-service-rs && \
    CARGO_TARGET_DIR=/app/target cargo build --release && \
    cp /app/target/release/radio-service-rs /tmp/radio-service

FROM debian:trixie-slim AS runner
RUN useradd -r -u 1000 radio
WORKDIR /app
COPY --from=build /tmp/radio-service /usr/local/bin/radio-service
COPY radio-service/migrations ./migrations
ENV RUST_LOG=info
USER radio
EXPOSE 4010
ENTRYPOINT ["/usr/local/bin/radio-service"]
