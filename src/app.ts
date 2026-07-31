import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError, treeifyError } from 'zod';
import { logger } from './lib/logger.js';
import { AppError, errorBody, sendError } from './lib/errors.js';
import { healthRoutes } from './routes/health.js';
import { sessionRoutes } from './routes/v1/sessions.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ loggerInstance: logger as unknown as FastifyBaseLogger });

  app.setErrorHandler((err: FastifyError | AppError | ZodError, request, reply) => {
    if (err instanceof AppError) {
      sendError(reply, err);
      return;
    }
    if (err instanceof ZodError) {
      reply.code(400).send(errorBody('INVALID_INPUT', 'Malformed request body', treeifyError(err)));
      return;
    }
    // Fastify's own validation errors carry a statusCode (e.g. bad params schema).
    const statusCode = (err as FastifyError).statusCode;
    if (typeof statusCode === 'number' && statusCode < 500) {
      reply.code(statusCode).send(errorBody('INVALID_INPUT', err.message));
      return;
    }
    request.log.error({ err }, 'unhandled error');
    reply.code(500).send(errorBody('INTERNAL_ERROR', 'An unexpected error occurred'));
  });

  await app.register(healthRoutes);
  await app.register(sessionRoutes, { prefix: '/api/v1' });

  return app;
}
