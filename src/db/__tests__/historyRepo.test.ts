import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('../../lib/prisma.js', () => ({
  prisma: { sessionHistory: { create: createMock } },
}));

vi.mock('../../lib/retry.js', () => ({
  withRetry: (fn: () => unknown) => fn(),
}));

import { insertMessage } from '../historyRepo.js';

describe('historyRepo.insertMessage', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('creates a session_history row with the given fields', async () => {
    const row = { id: 1, sessionId: 's1', role: 'user', content: 'hi', createdAt: new Date() };
    createMock.mockResolvedValue(row);

    const result = await insertMessage('s1', 'user', 'hi');

    expect(createMock).toHaveBeenCalledWith({ data: { sessionId: 's1', role: 'user', content: 'hi' } });
    expect(result).toBe(row);
  });

  it('propagates a rejection from the underlying create call', async () => {
    const err = new Error('db down');
    createMock.mockRejectedValue(err);

    await expect(insertMessage('s1', 'assistant', 'hello')).rejects.toBe(err);
  });
});
