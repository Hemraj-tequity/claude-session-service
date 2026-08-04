import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  Query,
  SDKAssistantMessage,
  SDKAssistantMessageError,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config/env.js";
import { ClaudeSdkError } from "../lib/errors.js";
import {
  ERROR_MESSAGES,
  PERMISSION_MODE,
  SPAWN_MODE,
} from "../constants/index.js";

export type SpawnMode = (typeof SPAWN_MODE)[keyof typeof SPAWN_MODE];

// Claude Agent SDK query for a session, either starting fresh or resuming.
export const spawnQuery = (
  sessionId: string,
  mode: SpawnMode,
  prompt: AsyncIterable<SDKUserMessage>,
  claudeAuthToken: string,
): Query => {
  try {
    return query({
      prompt,
      options: {
        ...(mode === SPAWN_MODE.FRESH ? { sessionId } : { resume: sessionId }),
        tools: config.allowedTools,
        allowedTools: config.allowedTools,
        permissionMode: PERMISSION_MODE.BYPASS_PERMISSIONS,
        allowDangerouslySkipPermissions: true,
        persistSession: true,
        includePartialMessages: true,
        env: {
          ...process.env,
          CLAUDE_CODE_OAUTH_TOKEN: claudeAuthToken,
        },
      },
    });
  } catch (err) {
    throw new ClaudeSdkError(ERROR_MESSAGES.FAILED_TO_START_SDK_SESSION, { cause: err });
  }
};

const AUTH_ERROR_CODES: ReadonlySet<SDKAssistantMessageError> = new Set([
  "authentication_failed",
  "oauth_org_not_allowed",
]);

// Checks whether an assistant message reports a Claude authentication failure.
export function isAuthError(msg: SDKAssistantMessage): boolean {
  return msg.error !== undefined && AUTH_ERROR_CODES.has(msg.error);
}
