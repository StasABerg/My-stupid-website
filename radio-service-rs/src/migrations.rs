use sqlx::PgPool;

pub async fn run_migrations(pool: &PgPool) -> anyhow::Result<()> {
    sqlx::migrate!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../radio-service/migrations"
    ))
    .run(pool)
    .await?;
    Ok(())
}
