import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const { createSessionMock, submitInputMock, attachMock, stopMock } = vi.hoisted(() => ({
  createSessionMock: vi.fn(),
  submitInputMock: vi.fn(),
  attachMock: vi.fn(),
  stopMock: vi.fn(),
}));

vi.mock('../../../sessions/SessionManager.js', () => ({
  createSession: createSessionMock,
  submitInput: submitInputMock,
  attach: attachMock,
  stop: stopMock,
}));

async function buildSessionsApp() {
  vi.resetModules();
  const { sessionRoutes } = await import('../sessions.js');
  const app = Fastify();
  await app.register(sessionRoutes);
  await app.ready();
  return app;
}

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('sessionRoutes', () => {
  beforeEach(() => {
    createSessionMock.mockReset();
    submitInputMock.mockReset().mockImplementation(async (_id, _content, reply) => {
      reply.send({ streamed: true });
    });
    attachMock.mockReset().mockImplementation(async (_id, reply) => {
      reply.send({ attached: true });
    });
    stopMock.mockReset();
  });

  describe('POST /sessions', () => {
    it('creates a session and returns 201 with the result', async () => {
      createSessionMock.mockResolvedValue({ session_id: 's1', status: 'running', created_at: '2026-01-01T00:00:00.000Z' });

      const app = await buildSessionsApp();
      const res = await app.inject({ method: 'POST', url: '/sessions' });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ session_id: 's1', status: 'running', created_at: '2026-01-01T00:00:00.000Z' });
      expect(createSessionMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /sessions/:sessionId/input', () => {
    it('rejects a malformed sessionId with a 400', async () => {
      const app = await buildSessionsApp();
      const res = await app.inject({
        method: 'POST',
        url: '/sessions/not-a-uuid/input',
        payload: { content: 'hi' },
      });

      expect(res.statusCode).toBe(400);
      expect(submitInputMock).not.toHaveBeenCalled();
    });

    it('returns 400 INVALID_INPUT when content is missing', async () => {
      const app = await buildSessionsApp();
      const res = await app.inject({
        method: 'POST',
        url: `/sessions/${VALID_UUID}/input`,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } });
      expect(submitInputMock).not.toHaveBeenCalled();
    });

    it('returns 400 INVALID_INPUT when content is an empty string', async () => {
      const app = await buildSessionsApp();
      const res = await app.inject({
        method: 'POST',
        url: `/sessions/${VALID_UUID}/input`,
        payload: { content: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(submitInputMock).not.toHaveBeenCalled();
    });

    it('forwards valid input to SessionManager.submitInput', async () => {
      const app = await buildSessionsApp();
      const res = await app.inject({
        method: 'POST',
        url: `/sessions/${VALID_UUID}/input`,
        payload: { content: 'hello' },
      });

      expect(submitInputMock).toHaveBeenCalledWith(VALID_UUID, 'hello', expect.anything());
      expect(res.json()).toEqual({ streamed: true });
    });
  });

  describe('GET /sessions/:sessionId/attach', () => {
    it('rejects a malformed sessionId with a 400', async () => {
      const app = await buildSessionsApp();
      const res = await app.inject({ method: 'GET', url: '/sessions/bad-id/attach' });

      expect(res.statusCode).toBe(400);
      expect(attachMock).not.toHaveBeenCalled();
    });

    it('forwards a valid sessionId to SessionManager.attach', async () => {
      const app = await buildSessionsApp();
      const res = await app.inject({ method: 'GET', url: `/sessions/${VALID_UUID}/attach` });

      expect(attachMock).toHaveBeenCalledWith(VALID_UUID, expect.anything());
      expect(res.json()).toEqual({ attached: true });
    });
  });

  describe('DELETE /sessions/:sessionId', () => {
    it('rejects a malformed sessionId with a 400', async () => {
      const app = await buildSessionsApp();
      const res = await app.inject({ method: 'DELETE', url: '/sessions/bad-id' });

      expect(res.statusCode).toBe(400);
      expect(stopMock).not.toHaveBeenCalled();
    });

    it('stops a valid session and returns the result', async () => {
      stopMock.mockResolvedValue({ session_id: VALID_UUID, status: 'stopped' });

      const app = await buildSessionsApp();
      const res = await app.inject({ method: 'DELETE', url: `/sessions/${VALID_UUID}` });

      expect(stopMock).toHaveBeenCalledWith(VALID_UUID);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ session_id: VALID_UUID, status: 'stopped' });
    });
  });
});
