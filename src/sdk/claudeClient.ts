import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  Query,
  SDKAssistantMessage,
  SDKAssistantMessageError,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config/env.js';

export const spawnQuery = (
  sessionId: string,
  mode: 'fresh' | 'resume',
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
        CLAUDE_CODE_AUTH_TOKEN: claudeAuthToken,
      },
    },
  });

const AUTH_ERROR_CODES: ReadonlySet<SDKAssistantMessageError> = new Set([
  'authentication_failed',
  'oauth_org_not_allowed',
]);

export function isAuthError(msg: SDKAssistantMessage): boolean {
  return msg.error !== undefined && AUTH_ERROR_CODES.has(msg.error);
}
