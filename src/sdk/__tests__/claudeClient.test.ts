import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HookCallbackMatcher, SDKAssistantMessage } from '@anthropic-ai/claude-agent-sdk';

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
    cwd?: string;
    hooks?: { PreToolUse?: HookCallbackMatcher[] };
    env?: NodeJS.ProcessEnv;
  };
}

function lastCall(): QueryCallArgs {
  const calls = queryMock.mock.calls as [QueryCallArgs][];
  return calls[calls.length - 1][0];
}

describe('spawnQuery', () => {
  beforeEach(() => {
    queryMock.mockClear();
  });

  it('passes sessionId (fresh mode) instead of resume', () => {
    const prompt = (async function* () {})();
    spawnQuery('session-1', 'fresh', prompt, 'caller-token', '/workspace/session-1');

    expect(queryMock).toHaveBeenCalledTimes(1);
    const call = lastCall();
    expect(call.prompt).toBe(prompt);
    expect(call.options.sessionId).toBe('session-1');
    expect(call.options.resume).toBeUndefined();
  });

  it('passes resume (resume mode) instead of sessionId', () => {
    const prompt = (async function* () {})();
    spawnQuery('session-2', 'resume', prompt, 'caller-token', '/workspace/session-2');

    const call = lastCall();
    expect(call.options.resume).toBe('session-2');
    expect(call.options.sessionId).toBeUndefined();
  });

  it('forwards the configured allow-list to both tools and allowedTools', () => {
    const prompt = (async function* () {})();
    spawnQuery('session-3', 'fresh', prompt, 'caller-token', '/workspace/session-3');

    const call = lastCall();
    expect(call.options.tools).toEqual(['Read', 'Grep']);
    expect(call.options.allowedTools).toEqual(['Read', 'Grep']);
  });

  it('always runs headless with bypassPermissions and partial-message streaming', () => {
    const prompt = (async function* () {})();
    spawnQuery('session-4', 'fresh', prompt, 'caller-token', '/workspace/session-4');

    const call = lastCall();
    expect(call.options.permissionMode).toBe('bypassPermissions');
    expect(call.options.allowDangerouslySkipPermissions).toBe(true);
    expect(call.options.persistSession).toBe(true);
    expect(call.options.includePartialMessages).toBe(true);
  });

  it('returns whatever the SDK query() call returns', () => {
    const prompt = (async function* () {})();
    const result = spawnQuery('session-5', 'fresh', prompt, 'caller-token', '/workspace/session-5');
    expect(result).toEqual({ __fakeQuery: true });
  });

  it("injects the caller's own token as CLAUDE_CODE_OAUTH_TOKEN", () => {
    const prompt = (async function* () {})();
    spawnQuery('session-6', 'fresh', prompt, 'caller-token', '/workspace/session-6');

    const call = lastCall();
    expect(call.options.env?.CLAUDE_CODE_OAUTH_TOKEN).toBe('caller-token');
  });

  it('still forwards the rest of the process environment (PATH, HOME, etc.)', () => {
    const prompt = (async function* () {})();
    process.env.SOME_HOST_VAR = 'kept';

    spawnQuery('session-7', 'fresh', prompt, 'caller-token', '/workspace/session-7');

    const call = lastCall();
    expect(call.options.env?.SOME_HOST_VAR).toBe('kept');

    delete process.env.SOME_HOST_VAR;
  });

  it('passes the session workspace directory as cwd', () => {
    const prompt = (async function* () {})();
    spawnQuery('session-8', 'fresh', prompt, 'caller-token', '/workspace/session-8');

    const call = lastCall();
    expect(call.options.cwd).toBe('/workspace/session-8');
  });

  it('registers a PreToolUse hook guarding Write/Edit/NotebookEdit', () => {
    const prompt = (async function* () {})();
    spawnQuery('session-9', 'fresh', prompt, 'caller-token', '/workspace/session-9');

    const call = lastCall();
    expect(call.options.hooks?.PreToolUse?.[0]?.matcher).toBe('Write|Edit|NotebookEdit');
    expect(call.options.hooks?.PreToolUse?.[0]?.hooks).toHaveLength(1);
  });

  describe('workspace guard hook', () => {
    async function runGuardHook(toolName: string, toolInput: unknown, cwd: string) {
      const prompt = (async function* () {})();
      spawnQuery('session-guard', 'fresh', prompt, 'caller-token', cwd);
      const call = lastCall();
      const hook = call.options.hooks!.PreToolUse![0].hooks[0];
      return hook(
        { hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput } as never,
        undefined,
        { signal: new AbortController().signal },
      );
    }

    it('allows a write to a path inside the workspace', async () => {
      const result = await runGuardHook('Write', { file_path: 'notes.md' }, '/workspace/session-guard');
      expect(result).toEqual({});
    });

    it('denies a write to an absolute path outside the workspace', async () => {
      const result = await runGuardHook('Write', { file_path: '/tmp/escape.txt' }, '/workspace/session-guard');
      const output = result as { hookSpecificOutput?: { permissionDecision?: string } };
      expect(output.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('ignores tools other than Write/Edit/NotebookEdit', async () => {
      const result = await runGuardHook('Read', { file_path: '/tmp/escape.txt' }, '/workspace/session-guard');
      expect(result).toEqual({});
    });

    it('allows when the tool input has no recognizable path field', async () => {
      const result = await runGuardHook('Write', {}, '/workspace/session-guard');
      expect(result).toEqual({});
    });
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
