import { config } from './config/env.js';
import { logger } from './lib/logger.js';
import { runStartupChecks } from './startup/authCheck.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  runStartupChecks();

  const app = await buildApp();

  try {
    await app.listen({ host: '0.0.0.0', port: config.port });
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
