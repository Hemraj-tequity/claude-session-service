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
 * The only file that calls into @anthropic-ai/claude-agent-sdk directly --
 * isolated here since this API surface is the most likely to shift between
 * SDK versions.
 */
export function spawnQuery(
  sessionId: string,
  mode: SpawnMode,
  prompt: AsyncIterable<SDKUserMessage>,
): Query {
  return query({
    prompt,
    options: {
      ...(mode === 'fresh' ? { sessionId } : { resume: sessionId }),
      // Restricts the actual available tool set (not just auto-approval) to the
      // configured allow-list -- keeps the system prompt's tool definitions
      // small and matches the spec's "expand deliberately per deployment" intent.
      tools: config.allowedTools,
      allowedTools: config.allowedTools,
      disallowedTools: config.disallowedTools,
      systemPrompt: config.systemPrompt,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      // SDK-side transcript persistence at ~/.claude/projects/<cwd>/<sessionId>.jsonl,
      // which our Postgres-native `resume` mode relies on for same-host continuity.
      persistSession: true,
      // Token-level stream_event messages, mapped to SSE `chunk` events.
      includePartialMessages: true,
      // Optional safety net against a runaway session (operator opt-in via
      // SESSION_MAX_BUDGET_USD, unset by default). The SDK enforces this
      // per-turn, after the turn completes rather than pre-flight.
      ...(config.sessionMaxBudgetUsd !== undefined
        ? { maxBudgetUsd: config.sessionMaxBudgetUsd }
        : {}),
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
