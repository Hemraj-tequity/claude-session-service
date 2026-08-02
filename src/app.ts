import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { logger } from "./lib/logger.js";
import { fastifyErrorHandler, fastifyNotFoundHandler } from "./lib/errors.js";
import { registerSessionRoutes } from "./routes/v1/sessions.js";

// Assembles the Fastify app: logging, the global error handler, and the versioned session routes.
export const buildApp = async (): Promise<FastifyInstance> => {
  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
  });

  app.setErrorHandler(fastifyErrorHandler);
  app.setNotFoundHandler(fastifyNotFoundHandler);

  await app.register(registerSessionRoutes, { prefix: "/api/v1" });

  return app;
};
