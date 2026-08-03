import { resolve } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type {
  HookCallback,
  Query,
  SDKAssistantMessage,
  SDKAssistantMessageError,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { config } from "../config/env.js";
import { ClaudeSdkError } from "../lib/errors.js";
import { isPathWithinDirectory } from "../storage/pathSafety.js";

export type SpawnMode = "fresh" | "resume";

// `cwd` only sets the subprocess's working directory - it doesn't stop the
// model writing to an absolute path outside it, which would never get synced
// to Storage. This hook denies that so the write fails loudly instead of
// silently vanishing on the next restart.
const PATH_WRITING_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);
const PATH_INPUT_KEYS = ["file_path", "notebook_path", "path"] as const;

function extractPathFromToolInput(toolInput: unknown): string | undefined {
  if (typeof toolInput !== "object" || toolInput === null) return undefined;
  for (const key of PATH_INPUT_KEYS) {
    const value = (toolInput as Record<string, unknown>)[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function createWorkspaceGuardHook(cwd: string): HookCallback {
  return (input) => {
    if (input.hook_event_name !== "PreToolUse") return Promise.resolve({});
    if (!PATH_WRITING_TOOLS.has(input.tool_name)) return Promise.resolve({});

    const filePath = extractPathFromToolInput(input.tool_input);
    if (!filePath) return Promise.resolve({});

    const resolved = resolve(cwd, filePath);
    if (isPathWithinDirectory(resolved, cwd)) return Promise.resolve({});

    return Promise.resolve({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `File paths must stay inside this session's workspace (${cwd}). ` +
          `"${filePath}" resolves outside it -- use a path relative to the workspace root instead.`,
      },
    });
  };
}

// Claude Agent SDK query for a session, either starting fresh or resuming.
// `cwd` is the session's own local workspace, prepared/synced by
// storage/projectWorkspace.js.
export const spawnQuery = (
  sessionId: string,
  mode: SpawnMode,
  prompt: AsyncIterable<SDKUserMessage>,
  claudeAuthToken: string,
  cwd: string,
): Query => {
  try {
    return query({
      prompt,
      options: {
        ...(mode === "fresh" ? { sessionId } : { resume: sessionId }),
        tools: config.allowedTools,
        allowedTools: config.allowedTools,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        persistSession: true,
        includePartialMessages: true,
        cwd,
        hooks: {
          PreToolUse: [{ matcher: "Write|Edit|NotebookEdit", hooks: [createWorkspaceGuardHook(cwd)] }],
        },
        env: {
          ...process.env,
          CLAUDE_CODE_OAUTH_TOKEN: claudeAuthToken,
        },
      },
    });
  } catch (err) {
    throw new ClaudeSdkError("Failed to start the Claude SDK session", { cause: err });
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
