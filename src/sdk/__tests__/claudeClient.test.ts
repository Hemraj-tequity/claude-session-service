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

interface QueryCallArgs {
  prompt: AsyncIterable<unknown>;
  options: {
    sessionId?: string;
    resume?: string;
    tools?: string[];
    allowedTools?: string[];
    permissionMode?: string;
    allowDangerouslySkipPermissions?: boolean;
    persistSession?: boolean;
    includePartialMessages?: boolean;
    env?: NodeJS.ProcessEnv;
  };
}

describe('spawnQuery', () => {
  beforeEach(() => {
    queryMock.mockClear();
  });

  it('passes sessionId (fresh mode) instead of resume', () => {
    const prompt = (async function* () {})();
    spawnQuery('session-1', 'fresh', prompt, 'caller-token');

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [[call]] = queryMock.mock.calls as [[QueryCallArgs]];
    expect(call.prompt).toBe(prompt);
    expect(call.options.sessionId).toBe('session-1');
    expect(call.options.resume).toBeUndefined();
  });

  it('passes resume (resume mode) instead of sessionId', () => {
    const prompt = (async function* () {})();
    spawnQuery('session-2', 'resume', prompt, 'caller-token');

    const [[call]] = queryMock.mock.calls as [[QueryCallArgs]];
    expect(call.options.resume).toBe('session-2');
    expect(call.options.sessionId).toBeUndefined();
  });

  it('forwards the configured allow-list to both tools and allowedTools', () => {
    const prompt = (async function* () {})();
    spawnQuery('session-3', 'fresh', prompt, 'caller-token');

    const [[call]] = queryMock.mock.calls as [[QueryCallArgs]];
    expect(call.options.tools).toEqual(['Read', 'Grep']);
    expect(call.options.allowedTools).toEqual(['Read', 'Grep']);
  });

  it('always runs headless with bypassPermissions and partial-message streaming', () => {
    const prompt = (async function* () {})();
    spawnQuery('session-4', 'fresh', prompt, 'caller-token');

    const [[call]] = queryMock.mock.calls as [[QueryCallArgs]];
    expect(call.options.permissionMode).toBe('bypassPermissions');
    expect(call.options.allowDangerouslySkipPermissions).toBe(true);
    expect(call.options.persistSession).toBe(true);
    expect(call.options.includePartialMessages).toBe(true);
  });

  it('returns whatever the SDK query() call returns', () => {
    const prompt = (async function* () {})();
    const result = spawnQuery('session-5', 'fresh', prompt, 'caller-token');
    expect(result).toEqual({ __fakeQuery: true });
  });

  it("injects the caller's own token as CLAUDE_CODE_AUTH_TOKEN", () => {
    const prompt = (async function* () {})();
    spawnQuery('session-6', 'fresh', prompt, 'caller-token');

    const [[call]] = queryMock.mock.calls as [[QueryCallArgs]];
    expect(call.options.env?.CLAUDE_CODE_AUTH_TOKEN).toBe('caller-token');
  });

  it('still forwards the rest of the process environment (PATH, HOME, etc.)', () => {
    const prompt = (async function* () {})();
    process.env.SOME_HOST_VAR = 'kept';

    spawnQuery('session-7', 'fresh', prompt, 'caller-token');

    const [[call]] = queryMock.mock.calls as [[QueryCallArgs]];
    expect(call.options.env?.SOME_HOST_VAR).toBe('kept');

    delete process.env.SOME_HOST_VAR;
  });

  it('strips any host-inherited ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN so they cannot outrank the caller token', () => {
    const prompt = (async function* () {})();
    process.env.ANTHROPIC_API_KEY = 'someone-elses-key';
    process.env.ANTHROPIC_AUTH_TOKEN = 'someone-elses-token';

    spawnQuery('session-8', 'fresh', prompt, 'caller-token');

    const [[call]] = queryMock.mock.calls as [[QueryCallArgs]];
    expect(call.options.env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(call.options.env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(call.options.env?.CLAUDE_CODE_AUTH_TOKEN).toBe('caller-token');

    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
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
