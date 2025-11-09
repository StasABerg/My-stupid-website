use sqlx::{
    postgres::{PgConnectOptions, PgPoolOptions, PgSslMode},
    PgPool,
};

use crate::config::{PostgresConfig, SslMode};

pub async fn create_postgres_pool(config: &PostgresConfig) -> Result<PgPool, sqlx::Error> {
    let mut options: PgConnectOptions = config.connection_string.parse()?;
    options = options.application_name(&config.application_name);

    let ssl_mode = match config.ssl_mode {
        SslMode::Disable => PgSslMode::Disable,
        SslMode::Prefer => PgSslMode::Prefer,
        SslMode::Require => PgSslMode::Require,
    };
    options = options.ssl_mode(ssl_mode);

    PgPoolOptions::new()
        .max_connections(config.max_connections)
        .connect_with(options)
        .await
}
