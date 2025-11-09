FROM rust:slim AS build
RUN apt-get update && \
    apt-get install -y --no-install-recommends pkg-config libssl-dev && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY radio-service-rs/Cargo.toml radio-service-rs/Cargo.lock ./radio-service-rs/
COPY radio-service-rs/src ./radio-service-rs/src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/radio-service-rs/target \
    cd radio-service-rs && cargo build --release

FROM debian:trixie-slim AS runner
RUN useradd -r -u 1000 radio
WORKDIR /app
COPY --from=build /app/radio-service-rs/target/release/radio-service-rs /usr/local/bin/radio-service
COPY radio-service/migrations ./migrations
ENV RUST_LOG=info
USER radio
EXPOSE 4010
ENTRYPOINT ["/usr/local/bin/radio-service"]
