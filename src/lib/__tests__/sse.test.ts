import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyReply } from 'fastify';

vi.mock('../logger.js', () => ({
  logger: { warn: vi.fn() },
}));

import { startSse, writeSse, writeHeartbeat, endSse, makeSseEvent } from '../sse.js';
import { logger } from '../logger.js';

function makeReply(overrides: Partial<{ write: () => boolean; end: () => void }> = {}) {
  const raw = {
    writeHead: vi.fn(),
    write: vi.fn(overrides.write ?? (() => true)),
    end: vi.fn(overrides.end ?? (() => undefined)),
  };
  const hijack = vi.fn();
  const reply = { hijack, raw } as unknown as FastifyReply;
  return { reply, raw, hijack };
}

describe('startSse', () => {
  it('hijacks the reply and writes SSE headers', () => {
    const { reply, raw, hijack } = makeReply();
    startSse(reply);

    expect(hijack).toHaveBeenCalledTimes(1);
    expect(raw.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
  });
});

describe('writeSse', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes the event as an SSE data frame and returns true', () => {
    const { reply, raw } = makeReply();
    const event = makeSseEvent('chunk', { content: 'hi' });

    const ok = writeSse(reply, event);

    expect(ok).toBe(true);
    expect(raw.write).toHaveBeenCalledWith(`data: ${JSON.stringify(event)}\n\n`);
  });

  it('returns false and logs a warning when the write throws', () => {
    const err = new Error('socket closed');
    const { reply } = makeReply({
      write: () => {
        throw err;
      },
    });

    const ok = writeSse(reply, makeSseEvent('done'));

    expect(ok).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith({ err }, 'SSE write failed');
  });
});

describe('writeHeartbeat', () => {
  it('writes a heartbeat comment and returns true', () => {
    const { reply, raw } = makeReply();
    expect(writeHeartbeat(reply)).toBe(true);
    expect(raw.write).toHaveBeenCalledWith(':hb\n\n');
  });

  it('returns false silently when the write throws', () => {
    const { reply } = makeReply({
      write: () => {
        throw new Error('closed');
      },
    });
    expect(writeHeartbeat(reply)).toBe(false);
  });
});

describe('endSse', () => {
  it('ends the raw socket', () => {
    const { reply, raw } = makeReply();
    endSse(reply);
    expect(raw.end).toHaveBeenCalledTimes(1);
  });

  it('swallows errors when the socket is already closed', () => {
    const { reply } = makeReply({
      end: () => {
        throw new Error('already closed');
      },
    });
    expect(() => endSse(reply)).not.toThrow();
  });
});

describe('makeSseEvent', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stamps a type and ISO timestamp with no extra fields', () => {
    vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));
    const event = makeSseEvent('done');
    expect(event).toEqual({ type: 'done', timestamp: '2026-02-01T00:00:00.000Z' });
  });

  it('merges extra fields onto the base event', () => {
    vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));
    const event = makeSseEvent('tool_use', { toolUseId: 't1', toolName: 'Read' });
    expect(event).toEqual({
      type: 'tool_use',
      timestamp: '2026-02-01T00:00:00.000Z',
      toolUseId: 't1',
      toolName: 'Read',
    });
  });
});
