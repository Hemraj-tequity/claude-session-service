import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { getCachedAuthStatus } from '../startup/authCheck.js';

const startedAt = Date.now();

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => {
    const auth = getCachedAuthStatus();

    let dbOk = true;
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbOk = false;
    }

    const ok = dbOk && auth.ok;
    reply.code(ok ? 200 : 503).send({
      status: ok ? 'ok' : 'degraded',
      db: dbOk ? 'ok' : 'unreachable',
      claudeAuth: auth.ok ? 'ok' : 'missing',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    });
  });
}
