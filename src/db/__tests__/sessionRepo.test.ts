import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createMock, findUniqueMock, updateMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    session: {
      create: createMock,
      findUnique: findUniqueMock,
      update: updateMock,
    },
  },
}));

vi.mock('../../lib/retry.js', () => ({
  withRetry: (fn: () => unknown) => fn(),
}));

import { createSession, findById, markSdkStarted, updateStatus, touchLastActivity } from '../sessionRepo.js';

describe('sessionRepo', () => {
  beforeEach(() => {
    createMock.mockReset();
    findUniqueMock.mockReset();
    updateMock.mockReset();
  });

  describe('createSession', () => {
    it('creates a row with the given sessionId', async () => {
      const row = { sessionId: 's1', status: 'running', sdkStarted: false, lastActivityAt: null, createdAt: new Date() };
      createMock.mockResolvedValue(row);

      const result = await createSession('s1');

      expect(createMock).toHaveBeenCalledWith({ data: { sessionId: 's1' } });
      expect(result).toBe(row);
    });
  });

  describe('findById', () => {
    it('returns the row when found', async () => {
      const row = { sessionId: 's1', status: 'running', sdkStarted: false, lastActivityAt: null, createdAt: new Date() };
      findUniqueMock.mockResolvedValue(row);

      const result = await findById('s1');

      expect(findUniqueMock).toHaveBeenCalledWith({ where: { sessionId: 's1' } });
      expect(result).toBe(row);
    });

    it('returns null when not found (does not go through withRetry)', async () => {
      findUniqueMock.mockResolvedValue(null);
      const result = await findById('missing');
      expect(result).toBeNull();
    });
  });

  describe('markSdkStarted', () => {
    it('sets sdkStarted to true', async () => {
      updateMock.mockResolvedValue({});
      await markSdkStarted('s1');
      expect(updateMock).toHaveBeenCalledWith({ where: { sessionId: 's1' }, data: { sdkStarted: true } });
    });
  });

  describe('updateStatus', () => {
    it('updates the status field', async () => {
      updateMock.mockResolvedValue({});
      await updateStatus('s1', 'stopped');
      expect(updateMock).toHaveBeenCalledWith({ where: { sessionId: 's1' }, data: { status: 'stopped' } });
    });
  });

  describe('touchLastActivity', () => {
    it('updates lastActivityAt to a Date', async () => {
      updateMock.mockResolvedValue({});
      await touchLastActivity('s1');

      expect(updateMock).toHaveBeenCalledTimes(1);
      const [[arg]] = updateMock.mock.calls;
      expect(arg.where).toEqual({ sessionId: 's1' });
      expect(arg.data.lastActivityAt).toBeInstanceOf(Date);
    });
  });
});
