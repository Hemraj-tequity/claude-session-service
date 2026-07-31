import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createMock, aggregateMock, findManyMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  aggregateMock: vi.fn(),
  findManyMock: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    sessionTranscript: {
      create: createMock,
      aggregate: aggregateMock,
      findMany: findManyMock,
    },
  },
}));

vi.mock('../../lib/retry.js', () => ({
  withRetry: (fn: () => unknown) => fn(),
}));

import { append, maxSequence, findSince } from '../transcriptRepo.js';

describe('transcriptRepo', () => {
  beforeEach(() => {
    createMock.mockReset();
    aggregateMock.mockReset();
    findManyMock.mockReset();
  });

  describe('append', () => {
    it('creates a transcript row with the given fields', async () => {
      const row = { id: 1, sessionId: 's1', subpath: 'root', sequence: 0, eventType: 'assistant', entry: {}, createdAt: new Date() };
      createMock.mockResolvedValue(row);

      const result = await append('s1', 'root', 0, 'assistant', { foo: 'bar' });

      expect(createMock).toHaveBeenCalledWith({
        data: { sessionId: 's1', subpath: 'root', sequence: 0, eventType: 'assistant', entry: { foo: 'bar' } },
      });
      expect(result).toBe(row);
    });
  });

  describe('maxSequence', () => {
    it('returns the aggregated max sequence when present', async () => {
      aggregateMock.mockResolvedValue({ _max: { sequence: 5 } });
      const result = await maxSequence('s1');
      expect(aggregateMock).toHaveBeenCalledWith({ where: { sessionId: 's1' }, _max: { sequence: true } });
      expect(result).toBe(5);
    });

    it('returns -1 when there are no rows yet', async () => {
      aggregateMock.mockResolvedValue({ _max: { sequence: null } });
      const result = await maxSequence('s1');
      expect(result).toBe(-1);
    });
  });

  describe('findSince', () => {
    it('queries rows with sequence greater than the given value, ordered ascending', async () => {
      const rows = [{ id: 1 }];
      findManyMock.mockResolvedValue(rows);

      const result = await findSince('s1', -1);

      expect(findManyMock).toHaveBeenCalledWith({
        where: { sessionId: 's1', sequence: { gt: -1 } },
        orderBy: { sequence: 'asc' },
      });
      expect(result).toBe(rows);
    });
  });
});
