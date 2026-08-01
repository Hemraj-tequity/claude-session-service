import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  Query,
  SDKAssistantMessage,
  SDKAssistantMessageError,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config/env.js';

export type SpawnMode = 'fresh' | 'resume';

/**
 * Starts (or resumes) one Claude Agent SDK subprocess for a session. `mode`
 * selects between passing `sessionId` (fresh) and `resume` (reattach to an
 * existing SDK-side session) -- driven by the DB's `sdkStarted` flag by the
 * caller, not tracked here.
 */
export const spawnQuery = (
  sessionId: string,
  mode: SpawnMode,
  prompt: AsyncIterable<SDKUserMessage>,
  claudeAuthToken: string,
): Query => query({
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
        CLAUDE_CODE_OAUTH_TOKEN: claudeAuthToken,
      },
    },
  });

const AUTH_ERROR_CODES: ReadonlySet<SDKAssistantMessageError> = new Set([
  'authentication_failed',
  'oauth_org_not_allowed',
]);

/** True if an assistant message reports a Claude host authentication failure. */
export function isAuthError(msg: SDKAssistantMessage): boolean {
  return msg.error !== undefined && AUTH_ERROR_CODES.has(msg.error);
}
