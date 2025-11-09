FROM rust:slim AS build
RUN apt-get update && \
    apt-get install -y --no-install-recommends pkg-config libssl-dev ca-certificates && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app/radio-service-rs
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
