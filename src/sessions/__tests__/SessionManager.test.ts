import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply } from 'fastify';

const {
  sessionRepoMock,
  historyRepoMock,
  transcriptRepoMock,
  spawnQueryMock,
  routeMessageMock,
  translateMessageMock,
  writeSseMock,
  startSseMock,
  writeHeartbeatMock,
  endSseMock,
  loggerMock,
} = vi.hoisted(() => ({
  sessionRepoMock: {
    createSession: vi.fn(),
    findById: vi.fn(),
    markSdkStarted: vi.fn(),
    updateStatus: vi.fn(),
    touchLastActivity: vi.fn(),
  },
  historyRepoMock: { insertMessage: vi.fn() },
  transcriptRepoMock: { findSince: vi.fn(), maxSequence: vi.fn() },
  spawnQueryMock: vi.fn(),
  routeMessageMock: vi.fn(),
  translateMessageMock: vi.fn(),
  writeSseMock: vi.fn(),
  startSseMock: vi.fn(),
  writeHeartbeatMock: vi.fn(),
  endSseMock: vi.fn(),
  loggerMock: { warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../db/sessionRepo.js', () => sessionRepoMock);
vi.mock('../../db/historyRepo.js', () => historyRepoMock);
vi.mock('../../db/transcriptRepo.js', () => transcriptRepoMock);
vi.mock('../../sdk/claudeClient.js', () => ({ spawnQuery: spawnQueryMock }));
vi.mock('../messageRouter.js', () => ({
  routeMessage: routeMessageMock,
  translateMessage: translateMessageMock,
}));
vi.mock('../../lib/logger.js', () => ({ logger: loggerMock }));
vi.mock('../../lib/sse.js', async () => {
  const actual = await vi.importActual<typeof import('../../lib/sse.js')>('../../lib/sse.js');
  return {
    ...actual,
    startSse: startSseMock,
    writeSse: writeSseMock,
    writeHeartbeat: writeHeartbeatMock,
    endSse: endSseMock,
  };
});

type Action = { msg: unknown } | { error: Error } | { done: true };

function createFakeQuery() {
  const buffer: Action[] = [];
  let waiting: { resolve: (r: IteratorResult<unknown>) => void; reject: (e: unknown) => void } | null = null;

  function deliver(action: Action) {
    if (waiting) {
      const w = waiting;
      waiting = null;
      if ('error' in action) w.reject(action.error);
      else if ('done' in action) w.resolve({ value: undefined, done: true });
      else w.resolve({ value: action.msg, done: false });
    } else {
      buffer.push(action);
    }
  }

  const close = vi.fn();
  const interrupt = vi.fn().mockResolvedValue(undefined);

  const query = {
    close,
    interrupt,
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<unknown>> {
          if (buffer.length) {
            const action = buffer.shift()!;
            if ('error' in action) return Promise.reject(action.error);
            if ('done' in action) return Promise.resolve({ value: undefined, done: true });
            return Promise.resolve({ value: action.msg, done: false });
          }
          return new Promise((resolve, reject) => {
            waiting = { resolve, reject };
          });
        },
      };
    },
  };

  return {
    query,
    close,
    interrupt,
    push: (msg: unknown) => deliver({ msg }),
    fail: (error: Error) => deliver({ error }),
    end: () => deliver({ done: true }),
  };
}

function fakeReply() {
  const closeHandlers: Array<() => void> = [];
  const once = vi.fn((event: string, cb: () => void) => {
    if (event === 'close') closeHandlers.push(cb);
  });
  const reply = {
    raw: { once },
    triggerClose: () => closeHandlers.forEach((cb) => cb()),
    onceMock: once,
  };
  return reply as unknown as FastifyReply & { triggerClose: () => void; onceMock: typeof once };
}

function runningRow(overrides: Partial<{ sdkStarted: boolean; status: string }> = {}) {
  return {
    sessionId: 's1',
    status: overrides.status ?? 'running',
    sdkStarted: overrides.sdkStarted ?? false,
    lastActivityAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

async function freshSessionManager() {
  vi.resetModules();
  return import('../SessionManager.js');
}

describe('SessionManager', () => {
  beforeEach(() => {
    Object.values(sessionRepoMock).forEach((fn) => fn.mockReset());
    historyRepoMock.insertMessage.mockReset().mockResolvedValue({});
    transcriptRepoMock.findSince.mockReset().mockResolvedValue([]);
    transcriptRepoMock.maxSequence.mockReset().mockResolvedValue(-1);
    spawnQueryMock.mockReset();
    routeMessageMock.mockReset().mockResolvedValue({});
    translateMessageMock.mockReset().mockReturnValue({ events: [] });
    writeSseMock.mockReset();
    startSseMock.mockReset();
    writeHeartbeatMock.mockReset();
    endSseMock.mockReset();
    loggerMock.warn.mockReset();
    loggerMock.error.mockReset();
    sessionRepoMock.updateStatus.mockResolvedValue(undefined);
    sessionRepoMock.markSdkStarted.mockResolvedValue(undefined);
    sessionRepoMock.touchLastActivity.mockResolvedValue(undefined);
  });

  describe('createSession', () => {
    it('creates a DB row and returns the session summary', async () => {
      const { createSession } = await freshSessionManager();
      sessionRepoMock.createSession.mockResolvedValue({
        sessionId: 'generated-id',
        status: 'running',
        sdkStarted: false,
        lastActivityAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      const result = await createSession();

      expect(sessionRepoMock.createSession).toHaveBeenCalledWith(expect.any(String));
      expect(result).toEqual({
        session_id: 'generated-id',
        status: 'running',
        created_at: '2026-01-01T00:00:00.000Z',
      });
    });
  });

  describe('submitInput', () => {
    it('throws SESSION_NOT_FOUND when the session does not exist', async () => {
      const { submitInput } = await freshSessionManager();
      sessionRepoMock.findById.mockResolvedValue(null);

      await expect(submitInput('missing', 'hi', fakeReply(), 'token')).rejects.toMatchObject({
        type: 'SESSION_NOT_FOUND',
      });
    });

    it('throws SESSION_STOPPED when the session is not running', async () => {
      const { submitInput } = await freshSessionManager();
      sessionRepoMock.findById.mockResolvedValue(runningRow({ status: 'stopped' }));

      await expect(submitInput('s1', 'hi', fakeReply(), 'token')).rejects.toMatchObject({
        type: 'SESSION_STOPPED',
      });
    });

    it('spawns fresh when the session has never started the SDK, streams to completion', async () => {
      const { submitInput } = await freshSessionManager();
      sessionRepoMock.findById.mockResolvedValue(runningRow({ sdkStarted: false }));
      const fq = createFakeQuery();
      spawnQueryMock.mockReturnValue(fq.query);
      routeMessageMock.mockResolvedValue({ turnDone: { isError: false, message: 'ok' } });

      const reply = fakeReply();
      const promise = submitInput('s1', 'hello', reply, 'token');
      // submitInput must reach takeOverReader (attach its reader) before the
      // terminal message is delivered, or the completion signal races ahead
      // of the reader being wired up.
      await vi.waitFor(() => expect(startSseMock).toHaveBeenCalledWith(reply));
      fq.push({ type: 'result', subtype: 'success', result: 'ok', num_turns: 1 });
      await promise;

      expect(spawnQueryMock).toHaveBeenCalledWith('s1', 'fresh', expect.anything(), 'token');
      expect(historyRepoMock.insertMessage).toHaveBeenCalledWith('s1', 'user', 'hello');
      expect(startSseMock).toHaveBeenCalledWith(reply);
      expect(writeSseMock).toHaveBeenCalledWith(reply, expect.objectContaining({ type: 'done' }));
      expect(endSseMock).toHaveBeenCalledWith(reply);
    });

    it('resumes and seeds seq from maxSequence when the SDK was already started', async () => {
      const { submitInput } = await freshSessionManager();
      sessionRepoMock.findById.mockResolvedValue(runningRow({ sdkStarted: true }));
      transcriptRepoMock.maxSequence.mockResolvedValue(9);
      const fq = createFakeQuery();
      spawnQueryMock.mockReturnValue(fq.query);
      routeMessageMock.mockResolvedValue({ turnDone: { isError: false, message: 'ok' } });

      const reply = fakeReply();
      const promise = submitInput('s1', 'hello', reply, 'token');
      await vi.waitFor(() => expect(startSseMock).toHaveBeenCalledWith(reply));
      fq.push({ type: 'result', subtype: 'success', result: 'ok', num_turns: 1 });
      await promise;

      expect(spawnQueryMock).toHaveBeenCalledWith('s1', 'resume', expect.anything(), 'token');
    });

    it('marks the SDK started once a fresh spawn reports its init message', async () => {
      const { submitInput } = await freshSessionManager();
      sessionRepoMock.findById.mockResolvedValue(runningRow({ sdkStarted: false }));
      const fq = createFakeQuery();
      spawnQueryMock.mockReturnValue(fq.query);
      routeMessageMock.mockResolvedValue({});

      const promise = submitInput('s1', 'hello', fakeReply(), 'token');
      fq.push({ type: 'system', subtype: 'init' });
      await vi.waitFor(() => expect(sessionRepoMock.markSdkStarted).toHaveBeenCalledWith('s1'));

      routeMessageMock.mockResolvedValueOnce({ turnDone: { isError: false, message: 'ok' } });
      fq.push({ type: 'result', subtype: 'success', result: 'ok', num_turns: 1 });
      await promise;
    });

    it('logs (but does not crash the pump loop) when markSdkStarted fails', async () => {
      const { submitInput } = await freshSessionManager();
      sessionRepoMock.findById.mockResolvedValue(runningRow({ sdkStarted: false }));
      sessionRepoMock.markSdkStarted.mockRejectedValue(new Error('write failed'));
      const fq = createFakeQuery();
      spawnQueryMock.mockReturnValue(fq.query);
      routeMessageMock.mockResolvedValue({});

      const promise = submitInput('s1', 'hello', fakeReply(), 'token');
      fq.push({ type: 'system', subtype: 'init' });
      await vi.waitFor(() =>
        expect(loggerMock.warn).toHaveBeenCalledWith(
          expect.objectContaining({ sessionId: 's1' }),
          'markSdkStarted failed (non-fatal)',
        ),
      );

      routeMessageMock.mockResolvedValueOnce({ turnDone: { isError: false, message: 'ok' } });
      fq.push({ type: 'result', subtype: 'success', result: 'ok', num_turns: 1 });
      await promise;
    });

    it('logs (but does not throw) when marking the session errored fails during termination', async () => {
      const { submitInput } = await freshSessionManager();
      sessionRepoMock.findById.mockResolvedValue(runningRow({ sdkStarted: false }));
      sessionRepoMock.updateStatus.mockRejectedValue(new Error('db unreachable'));
      const fq = createFakeQuery();
      spawnQueryMock.mockReturnValue(fq.query);

      const reply = fakeReply();
      const promise = submitInput('s1', 'hello', reply, 'token');
      await vi.waitFor(() => expect(startSseMock).toHaveBeenCalledWith(reply));
      fq.fail(new Error('subprocess crashed'));
      await promise;

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 's1' }),
        'Failed to mark session error after termination (best-effort)',
      );
    });

    it('rejects with DATABASE_ERROR when recording the prompt fails, without contacting the SDK', async () => {
      const { submitInput } = await freshSessionManager();
      sessionRepoMock.findById.mockResolvedValue(runningRow({ sdkStarted: false }));
      const fq = createFakeQuery();
      spawnQueryMock.mockReturnValue(fq.query);
      historyRepoMock.insertMessage.mockRejectedValue(new Error('db down'));

      await expect(submitInput('s1', 'hello', fakeReply(), 'token')).rejects.toMatchObject({
        type: 'DATABASE_ERROR',
      });
    });

    it('serializes a second submitInput behind the first in-flight turn', async () => {
      const { submitInput } = await freshSessionManager();
      sessionRepoMock.findById.mockResolvedValue(runningRow({ sdkStarted: false }));
      const fq = createFakeQuery();
      spawnQueryMock.mockReturnValue(fq.query);
      routeMessageMock.mockResolvedValue({});

      const reply1 = fakeReply();
      const first = submitInput('s1', 'first', reply1, 'token');

      // Let the first call reach its "awaiting turnDone" point before starting the second.
      await vi.waitFor(() => expect(startSseMock).toHaveBeenCalledWith(reply1));

      const reply2 = fakeReply();
      const second = submitInput('s1', 'second', reply2, 'token');

      routeMessageMock.mockResolvedValueOnce({ turnDone: { isError: false, message: 'first done' } });
      fq.push({ type: 'result', subtype: 'success', result: 'first done', num_turns: 1 });
      await first;

      await vi.waitFor(() => expect(startSseMock).toHaveBeenCalledWith(reply2));
      routeMessageMock.mockResolvedValueOnce({ turnDone: { isError: false, message: 'second done' } });
      fq.push({ type: 'result', subtype: 'success', result: 'second done', num_turns: 1 });
      await second;

      expect(historyRepoMock.insertMessage).toHaveBeenCalledWith('s1', 'user', 'first');
      expect(historyRepoMock.insertMessage).toHaveBeenCalledWith('s1', 'user', 'second');
    });

    it('terminates the session with DATABASE_ERROR when a transcript write fails mid-turn', async () => {
      const { submitInput } = await freshSessionManager();
      sessionRepoMock.findById.mockResolvedValue(runningRow({ sdkStarted: false }));
      const fq = createFakeQuery();
      spawnQueryMock.mockReturnValue(fq.query);
      routeMessageMock.mockResolvedValue({ persistFailed: new Error('write failed') });

      const reply = fakeReply();
      const promise = submitInput('s1', 'hello', reply, 'token');
      await vi.waitFor(() => expect(startSseMock).toHaveBeenCalledWith(reply));
      fq.push({ type: 'assistant', message: { content: [] } });
      await promise;

      expect(writeSseMock).toHaveBeenCalledWith(
        reply,
        expect.objectContaining({ type: 'error', code: 'DATABASE_ERROR' }),
      );
      expect(sessionRepoMock.updateStatus).toHaveBeenCalledWith('s1', 'error');
    });

    it('terminates the session with CLAUDE_AUTH_ERROR when the SDK reports an auth failure', async () => {
      const { submitInput } = await freshSessionManager();
      sessionRepoMock.findById.mockResolvedValue(runningRow({ sdkStarted: false }));
      const fq = createFakeQuery();
      spawnQueryMock.mockReturnValue(fq.query);
      routeMessageMock.mockResolvedValue({ authError: true });

      const reply = fakeReply();
      const promise = submitInput('s1', 'hello', reply, 'token');
      await vi.waitFor(() => expect(startSseMock).toHaveBeenCalledWith(reply));
      fq.push({ type: 'assistant', message: { content: [] } });
      await promise;

      expect(writeSseMock).toHaveBeenCalledWith(
        reply,
        expect.objectContaining({ type: 'error', code: 'CLAUDE_AUTH_ERROR' }),
      );
      expect(sessionRepoMock.updateStatus).toHaveBeenCalledWith('s1', 'error');
    });

    it('terminates the session with CHUNK_ERROR when the underlying stream throws', async () => {
      const { submitInput } = await freshSessionManager();
      sessionRepoMock.findById.mockResolvedValue(runningRow({ sdkStarted: false }));
      const fq = createFakeQuery();
      spawnQueryMock.mockReturnValue(fq.query);

      const reply = fakeReply();
      const promise = submitInput('s1', 'hello', reply, 'token');
      await vi.waitFor(() => expect(startSseMock).toHaveBeenCalledWith(reply));
      fq.fail(new Error('subprocess crashed'));
      await promise;

      expect(writeSseMock).toHaveBeenCalledWith(
        reply,
        expect.objectContaining({ type: 'error', code: 'CHUNK_ERROR' }),
      );
      expect(sessionRepoMock.updateStatus).toHaveBeenCalledWith('s1', 'error');
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 's1' }),
        'pumpMessages loop crashed',
      );
    });
  });

  describe('attach', () => {
    it('throws SESSION_NOT_FOUND when the session does not exist', async () => {
      const { attach } = await freshSessionManager();
      sessionRepoMock.findById.mockResolvedValue(null);

      await expect(attach('missing', fakeReply(), 'token')).rejects.toMatchObject({ type: 'SESSION_NOT_FOUND' });
    });

    it('replays persisted transcript and ends the stream for a non-running session, without spawning', async () => {
      const { attach } = await freshSessionManager();
      sessionRepoMock.findById.mockResolvedValue(runningRow({ status: 'stopped' }));
      transcriptRepoMock.findSince.mockResolvedValue([{ entry: { type: 'result' } }]);
      translateMessageMock.mockReturnValue({ events: [{ type: 'result', timestamp: 't' }] });

      const reply = fakeReply();
      await attach('s1', reply, 'token');

      expect(spawnQueryMock).not.toHaveBeenCalled();
      expect(startSseMock).toHaveBeenCalledWith(reply);
      expect(writeSseMock).toHaveBeenCalledWith(reply, { type: 'result', timestamp: 't' });
      expect(writeSseMock).toHaveBeenCalledWith(reply, expect.objectContaining({ type: 'done' }));
      expect(endSseMock).toHaveBeenCalledWith(reply);
    });

    it('spawns (if needed), replays history, and takes over the reader for a running session', async () => {
      const { attach } = await freshSessionManager();
      sessionRepoMock.findById.mockResolvedValue(runningRow({ sdkStarted: false }));
      const fq = createFakeQuery();
      spawnQueryMock.mockReturnValue(fq.query);
      transcriptRepoMock.findSince.mockResolvedValue([]);

      const reply = fakeReply();
      await attach('s1', reply, 'token');

      expect(spawnQueryMock).toHaveBeenCalledWith('s1', 'fresh', expect.anything(), 'token');
      expect(startSseMock).toHaveBeenCalledWith(reply);
      expect(reply.onceMock).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('closes out the previous reader when a new attach takes over the stream', async () => {
      const { attach } = await freshSessionManager();
      sessionRepoMock.findById.mockResolvedValue(runningRow({ sdkStarted: false }));
      const fq = createFakeQuery();
      spawnQueryMock.mockReturnValue(fq.query);

      const firstReader = fakeReply();
      await attach('s1', firstReader, 'token');

      writeSseMock.mockClear();
      endSseMock.mockClear();

      const secondReader = fakeReply();
      await attach('s1', secondReader, 'token');

      expect(writeSseMock).toHaveBeenCalledWith(
        firstReader,
        expect.objectContaining({ type: 'error', content: expect.stringContaining('attached from elsewhere') as string }),
      );
      expect(endSseMock).toHaveBeenCalledWith(firstReader);
    });

    it('sends periodic heartbeats to an idle attached reader', async () => {
      vi.useFakeTimers();
      try {
        const { attach } = await freshSessionManager();
        sessionRepoMock.findById.mockResolvedValue(runningRow({ sdkStarted: false }));
        const fq = createFakeQuery();
        spawnQueryMock.mockReturnValue(fq.query);

        const reply = fakeReply();
        await attach('s1', reply, 'token');

        await vi.advanceTimersByTimeAsync(15000);

        expect(writeHeartbeatMock).toHaveBeenCalledWith(reply);
      } finally {
        vi.useRealTimers();
      }
    });

    it('skips writing a heartbeat once the reader has disconnected', async () => {
      vi.useFakeTimers();
      try {
        const { attach } = await freshSessionManager();
        sessionRepoMock.findById.mockResolvedValue(runningRow({ sdkStarted: false }));
        const fq = createFakeQuery();
        spawnQueryMock.mockReturnValue(fq.query);

        const reply = fakeReply();
        await attach('s1', reply, 'token');
        reply.triggerClose();

        await vi.advanceTimersByTimeAsync(15000);

        expect(writeHeartbeatMock).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('clears the current reader once its socket closes, so a later takeover sees no stale reader', async () => {
      const { attach } = await freshSessionManager();
      sessionRepoMock.findById.mockResolvedValue(runningRow({ sdkStarted: false }));
      const fq = createFakeQuery();
      spawnQueryMock.mockReturnValue(fq.query);

      const firstReader = fakeReply();
      await attach('s1', firstReader, 'token');
      firstReader.triggerClose();

      writeSseMock.mockClear();
      const secondReader = fakeReply();
      await attach('s1', secondReader, 'token');

      expect(writeSseMock).not.toHaveBeenCalledWith(
        firstReader,
        expect.objectContaining({ type: 'error' }),
      );
    });
  });

  describe('stop', () => {
    it('throws SESSION_NOT_FOUND when the session does not exist', async () => {
      const { stop } = await freshSessionManager();
      sessionRepoMock.findById.mockResolvedValue(null);

      await expect(stop('missing')).rejects.toMatchObject({ type: 'SESSION_NOT_FOUND' });
    });

    it('marks a DB-only (not in-memory) session as stopped', async () => {
      const { stop } = await freshSessionManager();
      sessionRepoMock.findById.mockResolvedValue(runningRow());

      const result = await stop('s1');

      expect(sessionRepoMock.updateStatus).toHaveBeenCalledWith('s1', 'stopped');
      expect(result).toEqual({ session_id: 's1', status: 'stopped' });
    });

    it('stops an idle in-memory session that was never generating or attached', async () => {
      const { createSession, stop } = await freshSessionManager();
      sessionRepoMock.createSession.mockResolvedValue(runningRow());
      sessionRepoMock.findById.mockResolvedValue(runningRow());
      const created = await createSession();

      const result = await stop(created.session_id);

      expect(writeSseMock).not.toHaveBeenCalled();
      expect(endSseMock).not.toHaveBeenCalled();
      expect(result).toEqual({ session_id: created.session_id, status: 'stopped' });
    });

    it('interrupts an in-flight generation, closes the reader and the query, and clears in-memory state', async () => {
      const { submitInput, stop } = await freshSessionManager();
      sessionRepoMock.findById.mockResolvedValue(runningRow({ sdkStarted: false }));
      const fq = createFakeQuery();
      spawnQueryMock.mockReturnValue(fq.query);
      routeMessageMock.mockResolvedValue({});

      const reply = fakeReply();
      const submitPromise = submitInput('s1', 'hello', reply, 'token');
      await vi.waitFor(() => expect(startSseMock).toHaveBeenCalledWith(reply));

      const result = await stop('s1');

      expect(fq.interrupt).toHaveBeenCalledTimes(1);
      expect(fq.close).toHaveBeenCalledTimes(1);
      expect(writeSseMock).toHaveBeenCalledWith(reply, expect.objectContaining({ type: 'done' }));
      expect(result).toEqual({ session_id: 's1', status: 'stopped' });

      // The in-flight submitInput's awaited turn is force-resolved by stop()'s finishTurn().
      await submitPromise;
    });

    it('swallows a rejected interrupt() call', async () => {
      const { submitInput, stop } = await freshSessionManager();
      sessionRepoMock.findById.mockResolvedValue(runningRow({ sdkStarted: false }));
      const fq = createFakeQuery();
      fq.interrupt.mockRejectedValue(new Error('interrupt failed'));
      spawnQueryMock.mockReturnValue(fq.query);
      routeMessageMock.mockResolvedValue({});

      const reply = fakeReply();
      const submitPromise = submitInput('s1', 'hello', reply, 'token');
      await vi.waitFor(() => expect(startSseMock).toHaveBeenCalledWith(reply));

      await expect(stop('s1')).resolves.toEqual({ session_id: 's1', status: 'stopped' });
      await submitPromise;
    });
  });
});
