import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SDKAssistantMessage } from '@anthropic-ai/claude-agent-sdk';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn().mockReturnValue({ __fakeQuery: true }),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: queryMock,
}));

vi.mock('../../config/env.js', () => ({
  config: { allowedTools: ['Read', 'Grep'] },
}));

import { spawnQuery, isAuthError } from '../claudeClient.js';

describe('spawnQuery', () => {
  beforeEach(() => {
    queryMock.mockClear();
  });

  it('passes sessionId (fresh mode) instead of resume', () => {
    const prompt = (async function* () {})();
    spawnQuery('session-1', 'fresh', prompt);

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [[call]] = queryMock.mock.calls;
    expect(call.prompt).toBe(prompt);
    expect(call.options.sessionId).toBe('session-1');
    expect(call.options.resume).toBeUndefined();
  });

  it('passes resume (resume mode) instead of sessionId', () => {
    const prompt = (async function* () {})();
    spawnQuery('session-2', 'resume', prompt);

    const [[call]] = queryMock.mock.calls;
    expect(call.options.resume).toBe('session-2');
    expect(call.options.sessionId).toBeUndefined();
  });

  it('forwards the configured allow-list to both tools and allowedTools', () => {
    const prompt = (async function* () {})();
    spawnQuery('session-3', 'fresh', prompt);

    const [[call]] = queryMock.mock.calls;
    expect(call.options.tools).toEqual(['Read', 'Grep']);
    expect(call.options.allowedTools).toEqual(['Read', 'Grep']);
  });

  it('always runs headless with bypassPermissions and partial-message streaming', () => {
    const prompt = (async function* () {})();
    spawnQuery('session-4', 'fresh', prompt);

    const [[call]] = queryMock.mock.calls;
    expect(call.options.permissionMode).toBe('bypassPermissions');
    expect(call.options.allowDangerouslySkipPermissions).toBe(true);
    expect(call.options.persistSession).toBe(true);
    expect(call.options.includePartialMessages).toBe(true);
  });

  it('returns whatever the SDK query() call returns', () => {
    const prompt = (async function* () {})();
    const result = spawnQuery('session-5', 'fresh', prompt);
    expect(result).toEqual({ __fakeQuery: true });
  });
});

function assistantMessage(error?: SDKAssistantMessage['error']): SDKAssistantMessage {
  return { type: 'assistant', error } as SDKAssistantMessage;
}

describe('isAuthError', () => {
  it.each(['authentication_failed', 'oauth_org_not_allowed'] as const)(
    'returns true for %s',
    (code) => {
      expect(isAuthError(assistantMessage(code))).toBe(true);
    },
  );

  it('returns false when there is no error', () => {
    expect(isAuthError(assistantMessage(undefined))).toBe(false);
  });

  it('returns false for an unrelated error code', () => {
    expect(isAuthError(assistantMessage('overloaded_error' as SDKAssistantMessage['error']))).toBe(false);
  });
});
