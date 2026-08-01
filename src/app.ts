import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { logger } from "./lib/logger.js";
import { fastifyErrorHandler } from "./lib/errors.js";
import { sessionRoutes } from "./routes/v1/sessions.js";

export const buildApp = async (): Promise<FastifyInstance> => {
  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
  });

  app.setErrorHandler(fastifyErrorHandler);

  await app.register(sessionRoutes, { prefix: "/api/v1" });

  return app;
};
