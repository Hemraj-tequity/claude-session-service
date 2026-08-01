import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZodError, z } from 'zod';

const { queryRaw, getCachedAuthStatus, createSession, submitInput, attach, stop } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  getCachedAuthStatus: vi.fn(),
  createSession: vi.fn(),
  submitInput: vi.fn(),
  attach: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('../lib/logger.js', async () => {
  const pinoModule = await import('pino');
  // A real pino instance (not 'silent') so its logging methods stay spy-able,
  // writing to a stream that discards output instead of the test's stdout.
  return { logger: pinoModule.default({ level: 'error' }, { write: () => true }) };
});

vi.mock('../lib/prisma.js', () => ({ prisma: { $queryRaw: queryRaw } }));
vi.mock('../startup/authCheck.js', () => ({ getCachedAuthStatus }));
vi.mock('../sessions/SessionManager.js', () => ({ createSession, submitInput, attach, stop }));

import { buildApp } from '../app.js';

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('buildApp', () => {
  beforeEach(() => {
    queryRaw.mockReset().mockResolvedValue([{}]);
    getCachedAuthStatus.mockReset().mockReturnValue({ ok: true, method: 'api_key' });
    createSession.mockReset();
    submitInput.mockReset();
    attach.mockReset();
    stop.mockReset();
  });

  it('registers the health route', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('registers the session routes under the /api/v1 prefix', async () => {
    createSession.mockResolvedValue({ session_id: 's1', status: 'running', created_at: '2026-01-01T00:00:00.000Z' });

    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/sessions' });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ session_id: 's1', status: 'running', created_at: '2026-01-01T00:00:00.000Z' });
  });

  it('returns 404 for unregistered routes', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
  });

  describe('error handler', () => {
    it('converts a thrown AppError into its mapped status code and JSON body', async () => {
      stop.mockRejectedValue(new (await import('../lib/errors.js')).AppError('SESSION_NOT_FOUND', 'Session x not found'));

      const app = await buildApp();
      const res = await app.inject({ method: 'DELETE', url: `/api/v1/sessions/${VALID_UUID}` });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({
        error: { code: 'SESSION_NOT_FOUND', message: 'Session x not found' },
      });
    });

    it('converts a thrown ZodError into a 400 INVALID_INPUT body with treeified details', async () => {
      const schema = z.object({ foo: z.string() });
      const zodError = schema.safeParse({}).error as ZodError;
      createSession.mockRejectedValue(zodError);

      const app = await buildApp();
      const res = await app.inject({ method: 'POST', url: '/api/v1/sessions' });

      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: { code: string; message: string; details?: unknown } }>();
      expect(body.error.code).toBe('INVALID_INPUT');
      expect(body.error.message).toBe('Malformed request body');
      expect(body.error.details).toBeDefined();
    });

    it("maps Fastify's own schema-validation failures (statusCode < 500) to INVALID_INPUT", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: '/api/v1/sessions/not-a-uuid/attach' });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } });
      expect(attach).not.toHaveBeenCalled();
    });

    it('maps an unrecognized thrown error to a 500 INTERNAL_ERROR body', async () => {
      attach.mockRejectedValue(new Error('boom'));

      const app = await buildApp();
      const res = await app.inject({ method: 'GET', url: `/api/v1/sessions/${VALID_UUID}/attach` });

      expect(res.statusCode).toBe(500);
      expect(res.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
    });
  });
});
