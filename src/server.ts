import { buildApp } from "./app.js";
import { config } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { DEFAULT_HOST, ERROR_MESSAGES } from "./constants/index.js";

// Builds the app and starts listening for HTTP connections, exiting the process on failure.
const startServer = async (): Promise<void> => {
  const app = await buildApp();

  try {
    await app.listen({
      host: DEFAULT_HOST,
      port: config.port,
    });
  } catch (error) {
    logger.fatal({ error }, ERROR_MESSAGES.FAILED_TO_START_HTTP_SERVER);
    process.exit(1);
  }
};

void startServer();
