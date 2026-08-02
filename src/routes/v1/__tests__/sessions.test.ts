import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyReply } from 'fastify';

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
  const { registerSessionRoutes } = await import('../sessions.js');
  const app = Fastify();
  await app.register(registerSessionRoutes);
  await app.ready();
  return app;
}

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';
const AUTH_TOKEN = 'caller-token';
const AUTH_HEADERS = { authorization: `Bearer ${AUTH_TOKEN}` };

describe('registerSessionRoutes', () => {
  beforeEach(() => {
    createSessionMock.mockReset();
    submitInputMock.mockReset().mockImplementation((_id: string, _content: string, reply: FastifyReply) => {
      reply.send({ streamed: true });
    });
    attachMock.mockReset().mockImplementation((_id: string, reply: FastifyReply) => {
      reply.send({ attached: true });
    });
    stopMock.mockReset();
  });

  describe('authentication', () => {
    it('rejects a request with no Authorization header with a 401, without calling SessionManager', async () => {
      const app = await buildSessionsApp();
      const res = await app.inject({ method: 'POST', url: '/sessions' });

      expect(res.statusCode).toBe(401);
      expect(createSessionMock).not.toHaveBeenCalled();
    });

    it('rejects a non-Bearer Authorization header with a 401', async () => {
      const app = await buildSessionsApp();
      const res = await app.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: AUTH_TOKEN },
      });

      expect(res.statusCode).toBe(401);
      expect(createSessionMock).not.toHaveBeenCalled();
    });

    it('rejects an empty Bearer token with a 401', async () => {
      const app = await buildSessionsApp();
      const res = await app.inject({
        method: 'POST',
        url: '/sessions',
        headers: { authorization: 'Bearer ' },
      });

      expect(res.statusCode).toBe(401);
      expect(createSessionMock).not.toHaveBeenCalled();
    });

    it('applies the same auth check to every route in this scope', async () => {
      const app = await buildSessionsApp();

      const results = await Promise.all([
        app.inject({ method: 'POST', url: `/sessions/${VALID_UUID}/input`, payload: { content: 'hi' } }),
        app.inject({ method: 'GET', url: `/sessions/${VALID_UUID}/attach` }),
        app.inject({ method: 'DELETE', url: `/sessions/${VALID_UUID}` }),
      ]);

      for (const res of results) expect(res.statusCode).toBe(401);
      expect(submitInputMock).not.toHaveBeenCalled();
      expect(attachMock).not.toHaveBeenCalled();
      expect(stopMock).not.toHaveBeenCalled();
    });
  });

  describe('POST /sessions', () => {
    it('creates a session and returns 201 with the result', async () => {
      createSessionMock.mockResolvedValue({ session_id: 's1', status: 'running', created_at: '2026-01-01T00:00:00.000Z' });

      const app = await buildSessionsApp();
      const res = await app.inject({ method: 'POST', url: '/sessions', headers: AUTH_HEADERS });

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
        headers: AUTH_HEADERS,
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
        headers: AUTH_HEADERS,
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
        headers: AUTH_HEADERS,
        payload: { content: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(submitInputMock).not.toHaveBeenCalled();
    });

    it("forwards valid input and the caller's token to SessionManager.submitInput", async () => {
      const app = await buildSessionsApp();
      const res = await app.inject({
        method: 'POST',
        url: `/sessions/${VALID_UUID}/input`,
        headers: AUTH_HEADERS,
        payload: { content: 'hello' },
      });

      expect(submitInputMock).toHaveBeenCalledWith(VALID_UUID, 'hello', expect.anything(), AUTH_TOKEN);
      expect(res.json()).toEqual({ streamed: true });
    });
  });

  describe('GET /sessions/:sessionId/attach', () => {
    it('rejects a malformed sessionId with a 400', async () => {
      const app = await buildSessionsApp();
      const res = await app.inject({ method: 'GET', url: '/sessions/bad-id/attach', headers: AUTH_HEADERS });

      expect(res.statusCode).toBe(400);
      expect(attachMock).not.toHaveBeenCalled();
    });

    it("forwards a valid sessionId and the caller's token to SessionManager.attach", async () => {
      const app = await buildSessionsApp();
      const res = await app.inject({ method: 'GET', url: `/sessions/${VALID_UUID}/attach`, headers: AUTH_HEADERS });

      expect(attachMock).toHaveBeenCalledWith(VALID_UUID, expect.anything(), AUTH_TOKEN);
      expect(res.json()).toEqual({ attached: true });
    });
  });

  describe('DELETE /sessions/:sessionId', () => {
    it('rejects a malformed sessionId with a 400', async () => {
      const app = await buildSessionsApp();
      const res = await app.inject({ method: 'DELETE', url: '/sessions/bad-id', headers: AUTH_HEADERS });

      expect(res.statusCode).toBe(400);
      expect(stopMock).not.toHaveBeenCalled();
    });

    it('stops a valid session and returns the result', async () => {
      stopMock.mockResolvedValue({ session_id: VALID_UUID, status: 'stopped' });

      const app = await buildSessionsApp();
      const res = await app.inject({ method: 'DELETE', url: `/sessions/${VALID_UUID}`, headers: AUTH_HEADERS });

      expect(stopMock).toHaveBeenCalledWith(VALID_UUID);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ session_id: VALID_UUID, status: 'stopped' });
    });
  });
});
