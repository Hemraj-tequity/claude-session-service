import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { logger } from "./lib/logger.js";
import { fastifyErrorHandler } from "./lib/errors.js";
import { registerSessionRoutes } from "./routes/v1/sessions.js";
import { API_PREFIX_V1 } from "./constants/index.js";

// Assembles the Fastify app: logging, the global error handler, and the versioned session routes.
export const buildApp = async (): Promise<FastifyInstance> => {
  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
  });

  app.setErrorHandler(fastifyErrorHandler);

  await app.register(registerSessionRoutes, { prefix: API_PREFIX_V1 });

  return app;
};
