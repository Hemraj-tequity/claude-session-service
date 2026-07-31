import { describe, it, expect, vi, beforeEach } from 'vitest';

const { PrismaClientMock } = vi.hoisted(() => ({
  PrismaClientMock: vi.fn(),
}));

vi.mock('@prisma/client', () => ({ PrismaClient: PrismaClientMock }));
vi.mock('../../config/env.js', () => ({ config: { databaseUrl: 'postgresql://test/db' } }));

describe('lib/prisma', () => {
  beforeEach(() => {
    PrismaClientMock.mockClear();
    vi.resetModules();
  });

  it('constructs a single PrismaClient using the configured database URL', async () => {
    const { prisma } = await import('../prisma.js');

    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
    expect(PrismaClientMock).toHaveBeenCalledWith({ datasourceUrl: 'postgresql://test/db' });
    expect(prisma).toBeInstanceOf(PrismaClientMock);
  });

  it('exports the same instance on repeated imports (module singleton)', async () => {
    const first = await import('../prisma.js');
    const second = await import('../prisma.js');

    expect(second.prisma).toBe(first.prisma);
    expect(PrismaClientMock).toHaveBeenCalledTimes(1);
  });
});
