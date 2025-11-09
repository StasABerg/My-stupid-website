import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { config } from "../config/index.js";
import { logger } from "../logger.js";

let pool;

function getMigrationsDir() {
  return fileURLToPath(new URL("../../migrations", import.meta.url));
}

export function getPostgresPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: config.postgres.connectionString,
      max: config.postgres.maxConnections,
      statement_timeout: config.postgres.statementTimeoutMs || undefined,
      ssl: config.postgres.ssl,
      application_name: config.postgres.applicationName,
    });

    pool.on("error", (error) => {
      logger.error("postgres.pool_error", { error });
    });
  }

  return pool;
}

export async function withPgClient(handler) {
  const client = await getPostgresPool().connect();
  try {
    return await handler(client);
  } finally {
    client.release();
  }
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function readMigrations() {
  const dir = getMigrationsDir();
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => ({
        version: file.replace(/\.sql$/, ""),
        path: path.join(dir, file),
      }));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function runMigrations() {
  const migrations = await readMigrations();
  if (migrations.length === 0) {
    return;
  }

  await withPgClient(async (client) => {
    await ensureMigrationsTable(client);

    for (const migration of migrations) {
      const { rows } = await client.query(
        "SELECT 1 FROM schema_migrations WHERE version = $1",
        [migration.version],
      );
      if (rows.length > 0) {
        continue;
      }

      const sql = await fs.readFile(migration.path, "utf-8");
      logger.info("postgres.migration.applying", { version: migration.version });

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version, applied_at) VALUES ($1, NOW())",
          [migration.version],
        );
        await client.query("COMMIT");
        logger.info("postgres.migration.applied", { version: migration.version });
      } catch (error) {
        await client.query("ROLLBACK");
        logger.error("postgres.migration.failed", { version: migration.version, error });
        throw error;
      }
    }
  });
}
