import { buildApp } from "./app.js";
import { config } from "./config/env.js";
import { logger } from "./lib/logger.js";

// Builds the app and starts listening for HTTP connections, exiting the process on failure.
const startServer = async (): Promise<void> => {
  const app = await buildApp();

  try {
    await app.listen({
      host: "0.0.0.0",
      port: config.port,
    });
  } catch (error) {
    logger.fatal({ error }, "Failed to start HTTP server");
    process.exit(1);
  }
};

void startServer();
