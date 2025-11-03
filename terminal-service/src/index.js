import { config } from "./config.js";
import { createCommandHandlers } from "./commands/index.js";
import { logger } from "./logger.js";
import { ensureSandboxFilesystem } from "./sandbox/filesystem.js";
import { createServer } from "./server/create-server.js";

const commandHandlers = createCommandHandlers();
const fastify = createServer({ logger, commandHandlers });

async function start() {
  try {
    await ensureSandboxFilesystem();
  } catch (error) {
    logger.error("sandbox.init_failed", { error });
    process.exitCode = 1;
    return null;
  }

  try {
    await fastify.listen({ port: config.port, host: "0.0.0.0" });
    logger.info("server.started", {
      port: config.port,
      sandboxRoot: config.sandboxRoot,
    });
    return fastify;
  } catch (error) {
    logger.error("server.start_failed", { error });
    process.exit(1);
    return null;
  }
}

const fastifyInstance = await start();

async function shutdown(signal) {
  logger.info("signal.received", { signal });
  if (!fastifyInstance) {
    process.exit(0);
    return;
  }
  try {
    await fastifyInstance.close();
  } catch (error) {
    logger.warn("server.close_failed", { error });
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch((error) => {
    logger.error("shutdown.unhandled_error", { error });
    process.exit(1);
  });
});

process.on("SIGINT", () => {
  shutdown("SIGINT").catch((error) => {
    logger.error("shutdown.unhandled_error", { error });
    process.exit(1);
  });
});

