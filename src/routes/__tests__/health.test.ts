import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';

const { queryRawMock, getCachedAuthStatusMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
  getCachedAuthStatusMock: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: { $queryRaw: queryRawMock },
}));

vi.mock('../../startup/authCheck.js', () => ({
  getCachedAuthStatus: getCachedAuthStatusMock,
}));

async function buildHealthApp() {
  vi.resetModules();
  const { healthRoutes } = await import('../health.js');
  const app = Fastify();
  await app.register(healthRoutes);
  await app.ready();
  return app;
}

describe('healthRoutes', () => {
  beforeEach(() => {
    queryRawMock.mockReset();
    getCachedAuthStatusMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 200 ok when the DB responds and auth is present', async () => {
    queryRawMock.mockResolvedValue([{ '?column?': 1 }]);
    getCachedAuthStatusMock.mockReturnValue({ ok: true, method: 'api_key' });

    const app = await buildHealthApp();
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ok',
      db: 'ok',
      claudeAuth: 'ok',
      uptimeSeconds: 0,
    });
  });

  it('returns 503 degraded when the DB query throws', async () => {
    queryRawMock.mockRejectedValue(new Error('connection refused'));
    getCachedAuthStatusMock.mockReturnValue({ ok: true, method: 'api_key' });

    const app = await buildHealthApp();
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', db: 'unreachable', claudeAuth: 'ok' });
  });

  it('returns 503 degraded when Claude auth is missing', async () => {
    queryRawMock.mockResolvedValue([{ '?column?': 1 }]);
    getCachedAuthStatusMock.mockReturnValue({ ok: false });

    const app = await buildHealthApp();
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', db: 'ok', claudeAuth: 'missing' });
  });

  it('returns 503 when both the DB and auth are unhealthy', async () => {
    queryRawMock.mockRejectedValue(new Error('down'));
    getCachedAuthStatusMock.mockReturnValue({ ok: false });

    const app = await buildHealthApp();
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: 'degraded', db: 'unreachable', claudeAuth: 'missing' });
  });

  it('reports elapsed uptimeSeconds since module load', async () => {
    queryRawMock.mockResolvedValue([{}]);
    getCachedAuthStatusMock.mockReturnValue({ ok: true });

    const app = await buildHealthApp();
    vi.advanceTimersByTime(5000);

    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json<{ uptimeSeconds: number }>().uptimeSeconds).toBe(5);
  });
});
