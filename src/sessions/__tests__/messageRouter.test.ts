import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

const { appendMock, insertMessageMock, touchLastActivityMock, writeSseMock, loggerMock } = vi.hoisted(() => ({
  appendMock: vi.fn(),
  insertMessageMock: vi.fn(),
  touchLastActivityMock: vi.fn(),
  writeSseMock: vi.fn(),
  loggerMock: { warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../db/transcriptRepo.js', () => ({ append: appendMock }));
vi.mock('../../db/historyRepo.js', () => ({ insertMessage: insertMessageMock }));
vi.mock('../../db/sessionRepo.js', () => ({ touchLastActivity: touchLastActivityMock }));
vi.mock('../../lib/sse.js', async () => {
  const actual = await vi.importActual<typeof import('../../lib/sse.js')>('../../lib/sse.js');
  return { ...actual, writeSse: writeSseMock };
});
vi.mock('../../lib/logger.js', () => ({ logger: loggerMock }));
vi.mock('../../config/env.js', () => ({ config: { allowedTools: [] } }));

import { translateMessage, routeMessage } from '../messageRouter.js';
import type { ActiveSession } from '../types.js';

function session(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    sessionId: 's1',
    query: null,
    inputQueue: null as never,
    currentReader: null,
    heartbeatTimer: null,
    isGenerating: false,
    turnDone: null,
    seq: 0,
    lastActivityAt: Date.now(),
    ...overrides,
  };
}

describe('translateMessage', () => {
  it('emits system_init for a system/init message', () => {
    const msg = { type: 'system', subtype: 'init', model: 'claude', tools: ['Read'] } as unknown as SDKMessage;
    const result = translateMessage(msg);
    expect(result.events).toEqual([
      expect.objectContaining({ type: 'system_init', model: 'claude', tools: ['Read'] }),
    ]);
    expect(result.historyText).toBeNull();
    expect(result.authError).toBe(false);
    expect(result.turnDone).toBeUndefined();
  });

  it('emits nothing for a non-init system subtype', () => {
    const msg = { type: 'system', subtype: 'other' } as unknown as SDKMessage;
    expect(translateMessage(msg).events).toEqual([]);
  });

  it('emits a chunk event for a text_delta stream_event', () => {
    const msg = {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } },
    } as unknown as SDKMessage;
    const result = translateMessage(msg);
    expect(result.events).toEqual([expect.objectContaining({ type: 'chunk', content: 'hi' })]);
  });

  it('defaults chunk content to an empty string when text is missing', () => {
    const msg = {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta' } },
    } as unknown as SDKMessage;
    const result = translateMessage(msg);
    expect(result.events).toEqual([expect.objectContaining({ type: 'chunk', content: '' })]);
  });

  it('ignores stream_events that are not text deltas', () => {
    const msg = {
      type: 'stream_event',
      event: { type: 'content_block_start' },
    } as unknown as SDKMessage;
    expect(translateMessage(msg).events).toEqual([]);
  });

  it('emits tool_use events and consolidated text for an assistant message', () => {
    const msg = {
      type: 'assistant',
      error: undefined,
      message: {
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { path: 'a.ts' } },
          { type: 'text', text: 'world' },
        ],
      },
    } as unknown as SDKMessage;

    const result = translateMessage(msg);
    expect(result.events).toEqual([
      expect.objectContaining({ type: 'tool_use', toolUseId: 't1', toolName: 'Read', input: { path: 'a.ts' } }),
    ]);
    expect(result.historyText).toBe('Hello world');
    expect(result.authError).toBe(false);
  });

  it('flags authError for an assistant message with an auth error code', () => {
    const msg = {
      type: 'assistant',
      error: 'authentication_failed',
      message: { content: [] },
    } as unknown as SDKMessage;
    expect(translateMessage(msg).authError).toBe(true);
  });

  it('leaves historyText null when the assistant message has no text blocks', () => {
    const msg = {
      type: 'assistant',
      error: undefined,
      message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] },
    } as unknown as SDKMessage;
    expect(translateMessage(msg).historyText).toBeNull();
  });

  it('handles an assistant message with no content array', () => {
    const msg = { type: 'assistant', error: undefined, message: {} } as unknown as SDKMessage;
    const result = translateMessage(msg);
    expect(result.events).toEqual([]);
    expect(result.historyText).toBeNull();
  });

  it('emits tool_result events for a user message carrying tool results', () => {
    const msg = {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'output', is_error: false },
          { type: 'tool_result', tool_use_id: 't2', content: { nested: true }, is_error: true },
        ],
      },
    } as unknown as SDKMessage;

    const result = translateMessage(msg);
    expect(result.events).toEqual([
      expect.objectContaining({ type: 'tool_result', toolUseId: 't1', content: 'output', isError: false }),
      expect.objectContaining({ type: 'tool_result', toolUseId: 't2', content: '{"nested":true}', isError: true }),
    ]);
  });

  it('defaults isError to false when is_error is absent on a tool_result', () => {
    const msg = {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] },
    } as unknown as SDKMessage;
    expect(translateMessage(msg).events[0]).toEqual(expect.objectContaining({ isError: false }));
  });

  it('ignores user message content that is not an array', () => {
    const msg = { type: 'user', message: { content: 'not-an-array' } } as unknown as SDKMessage;
    expect(translateMessage(msg).events).toEqual([]);
  });

  it('ignores non tool_result blocks inside a user message', () => {
    const msg = {
      type: 'user',
      message: { content: [{ type: 'text', text: 'echo' }] },
    } as unknown as SDKMessage;
    expect(translateMessage(msg).events).toEqual([]);
  });

  it('emits a success result event and resolves turnDone with the result text', () => {
    const msg = { type: 'result', subtype: 'success', result: 'all done', num_turns: 2 } as unknown as SDKMessage;
    const translated = translateMessage(msg);
    expect(translated.events).toEqual([
      expect.objectContaining({ type: 'result', content: 'all done', isError: false, numTurns: 2 }),
    ]);
    expect(translated.turnDone).toEqual({ isError: false, message: 'all done' });
  });

  it('emits an error result event and joins error messages for turnDone', () => {
    const msg = { type: 'result', subtype: 'error_max_turns', errors: ['bad', 'worse'], num_turns: 5 } as unknown as SDKMessage;
    const translated = translateMessage(msg);
    expect(translated.events).toEqual([
      expect.objectContaining({ type: 'result', content: undefined, isError: true, numTurns: 5 }),
    ]);
    expect(translated.turnDone).toEqual({ isError: true, message: 'bad; worse' });
  });

  it('emits nothing for an unrecognized message type', () => {
    const msg = { type: 'unknown_type' } as unknown as SDKMessage;
    const result = translateMessage(msg);
    expect(result.events).toEqual([]);
    expect(result.historyText).toBeNull();
    expect(result.turnDone).toBeUndefined();
  });
});

describe('routeMessage', () => {
  beforeEach(() => {
    appendMock.mockReset().mockResolvedValue({});
    insertMessageMock.mockReset().mockResolvedValue({});
    touchLastActivityMock.mockReset().mockResolvedValue(undefined);
    writeSseMock.mockReset();
    loggerMock.warn.mockReset();
  });

  it('writes translated events to the current reader when attached', async () => {
    const reply = {} as never;
    const s = session({ currentReader: reply });
    const msg = { type: 'result', subtype: 'success', result: 'ok', num_turns: 1 } as unknown as SDKMessage;

    await routeMessage(s, msg);

    expect(writeSseMock).toHaveBeenCalledTimes(1);
    expect(writeSseMock).toHaveBeenCalledWith(reply, expect.objectContaining({ type: 'result' }));
  });

  it('does not attempt to write SSE when there is no current reader', async () => {
    const s = session({ currentReader: null });
    const msg = { type: 'result', subtype: 'success', result: 'ok', num_turns: 1 } as unknown as SDKMessage;

    await routeMessage(s, msg);

    expect(writeSseMock).not.toHaveBeenCalled();
  });

  it('appends a transcript row using "root" subpath and increments session.seq', async () => {
    const s = session({ seq: 3 });
    const msg = { type: 'result', subtype: 'success', result: 'ok', num_turns: 1 } as unknown as SDKMessage;

    await routeMessage(s, msg);

    expect(appendMock).toHaveBeenCalledWith('s1', 'root', 3, 'result', msg);
    expect(s.seq).toBe(4);
  });

  it('uses parent_tool_use_id as the subpath when present', async () => {
    const s = session();
    const msg = { type: 'result', subtype: 'success', result: 'ok', num_turns: 1, parent_tool_use_id: 'parent-1' } as unknown as SDKMessage;

    await routeMessage(s, msg);

    expect(appendMock).toHaveBeenCalledWith('s1', 'parent-1', 0, 'result', msg);
  });

  it('persists assistant text to history when present', async () => {
    const s = session();
    const msg = {
      type: 'assistant',
      error: undefined,
      message: { content: [{ type: 'text', text: 'hello there' }] },
    } as unknown as SDKMessage;

    await routeMessage(s, msg);

    expect(insertMessageMock).toHaveBeenCalledWith('s1', 'assistant', 'hello there');
  });

  it('does not touch history when the message carries no text', async () => {
    const s = session();
    const msg = { type: 'system', subtype: 'init', model: 'm', tools: [] } as unknown as SDKMessage;

    await routeMessage(s, msg);

    expect(insertMessageMock).not.toHaveBeenCalled();
  });

  it('reports persistFailed when the transcript append rejects', async () => {
    const err = new Error('transcript write failed');
    appendMock.mockRejectedValue(err);
    const s = session();
    const msg = { type: 'system', subtype: 'init', model: 'm', tools: [] } as unknown as SDKMessage;

    const outcome = await routeMessage(s, msg);

    expect(outcome.persistFailed).toBe(err);
    expect(s.seq).toBe(0); // increment only runs on the resolved .then()
  });

  it('reports persistFailed when the history insert rejects', async () => {
    const err = new Error('history write failed');
    insertMessageMock.mockRejectedValue(err);
    const s = session();
    const msg = {
      type: 'assistant',
      error: undefined,
      message: { content: [{ type: 'text', text: 'hi' }] },
    } as unknown as SDKMessage;

    const outcome = await routeMessage(s, msg);

    expect(outcome.persistFailed).toBe(err);
  });

  it('sets authError on the outcome for an assistant auth failure', async () => {
    const s = session();
    const msg = { type: 'assistant', error: 'oauth_org_not_allowed', message: { content: [] } } as unknown as SDKMessage;

    const outcome = await routeMessage(s, msg);

    expect(outcome.authError).toBe(true);
  });

  it('leaves authError undefined for a non-assistant message', async () => {
    const s = session();
    const msg = { type: 'system', subtype: 'init', model: 'm', tools: [] } as unknown as SDKMessage;

    const outcome = await routeMessage(s, msg);

    expect(outcome.authError).toBeUndefined();
  });

  it('touches last activity (fire-and-forget) when the turn is done', async () => {
    const s = session();
    const msg = { type: 'result', subtype: 'success', result: 'ok', num_turns: 1 } as unknown as SDKMessage;

    const outcome = await routeMessage(s, msg);
    await Promise.resolve();

    expect(outcome.turnDone).toEqual({ isError: false, message: 'ok' });
    expect(touchLastActivityMock).toHaveBeenCalledWith('s1');
  });

  it('does not touch last activity when the turn is not done', async () => {
    const s = session();
    const msg = { type: 'system', subtype: 'init', model: 'm', tools: [] } as unknown as SDKMessage;

    await routeMessage(s, msg);

    expect(touchLastActivityMock).not.toHaveBeenCalled();
  });

  it('logs (but does not throw) when touchLastActivity fails', async () => {
    const err = new Error('touch failed');
    touchLastActivityMock.mockRejectedValue(err);
    const s = session();
    const msg = { type: 'result', subtype: 'success', result: 'ok', num_turns: 1 } as unknown as SDKMessage;

    await routeMessage(s, msg);
    await new Promise((resolve) => setImmediate(resolve));

    expect(loggerMock.warn).toHaveBeenCalledWith(
      { err, sessionId: 's1' },
      'touchLastActivity failed (non-fatal)',
    );
  });
});
