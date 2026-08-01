import type { FastifyInstance } from 'fastify';
import { treeifyError } from 'zod';
import { InputBodySchema, UUID_PATTERN } from '../../schemas/sessions.schema.js';
import { AppError, sendError } from '../../lib/errors.js';
import { extractClaudeToken } from '../../lib/auth.js';
import * as SessionManager from '../../sessions/SessionManager.js';

const sessionIdParamSchema = {
  type: 'object',
  required: ['sessionId'],
  properties: {
    sessionId: { type: 'string', pattern: UUID_PATTERN },
  },
} as const;

export function sessionRoutes(app: FastifyInstance): void {
  app.decorateRequest('claudeToken', '');
  app.addHook('onRequest', (request, _reply, done) => {
    // Every request authenticates as its own caller; there is no shared
    // fallback credential, so this must run before any handler in this scope.
    request.claudeToken = extractClaudeToken(request.headers);
    done();
  });

  app.post('/sessions', async (_request, reply) => {
    const result = await SessionManager.createSession();
    reply.code(201).send(result);
  });

  app.post<{ Params: { sessionId: string }; Body: { content?: unknown } }>(
    '/sessions/:sessionId/input',
    { schema: { params: sessionIdParamSchema } },
    async (request, reply) => {
      const parsed = InputBodySchema.safeParse(request.body);
      if (!parsed.success) {
        sendError(reply, new AppError('INVALID_INPUT', 'Body must be { content: string }', treeifyError(parsed.error)));
        return;
      }
      // submitInput hijacks the reply itself once validation/persistence
      // succeeds; any AppError thrown before that point is still a normal
      // JSON response via the global error handler.
      await SessionManager.submitInput(request.params.sessionId, parsed.data.content, reply, request.claudeToken);
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId/attach',
    { schema: { params: sessionIdParamSchema } },
    async (request, reply) => {
      await SessionManager.attach(request.params.sessionId, reply, request.claudeToken);
    },
  );

  app.delete<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId',
    { schema: { params: sessionIdParamSchema } },
    async (request, reply) => {
      const result = await SessionManager.stop(request.params.sessionId);
      reply.send(result);
    },
  );
}
