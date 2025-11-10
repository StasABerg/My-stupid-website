use sqlx::PgPool;

pub async fn run_migrations(pool: &PgPool) -> anyhow::Result<()> {
    sqlx::migrate!("../radio-service/migrations")
        .run(pool)
        .await?;
    Ok(())
}
