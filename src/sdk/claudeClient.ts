import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  Query,
  SDKAssistantMessage,
  SDKAssistantMessageError,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config/env.js';

export type SpawnMode = 'fresh' | 'resume';

export function spawnQuery(
  sessionId: string,
  mode: SpawnMode,
  prompt: AsyncIterable<SDKUserMessage>,
): Query {
  return query({
    prompt,
    options: {
      ...(mode === 'fresh' ? { sessionId } : { resume: sessionId }),
      tools: config.allowedTools,
      allowedTools: config.allowedTools,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      persistSession: true,
      includePartialMessages: true,
      env: {
        ...process.env,
        CLAUDE_CODE_AUTH_TOKEN: config.claudeCodeAuthToken,
      },
    },
  });
}

const AUTH_ERROR_CODES: ReadonlySet<SDKAssistantMessageError> = new Set([
  'authentication_failed',
  'oauth_org_not_allowed',
]);

/**
 * Distinguishes an auth failure (needs a `claude login` / API key fix on the
 * host) from any other assistant-turn error, using the SDK's own typed error
 * field rather than string-matching a message.
 */
export function isAuthError(msg: SDKAssistantMessage): boolean {
  return msg.error !== undefined && AUTH_ERROR_CODES.has(msg.error);
}
