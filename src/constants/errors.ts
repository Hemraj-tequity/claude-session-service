export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  DATABASE_ERROR: "DATABASE_ERROR",
  CHUNK_ERROR: "CHUNK_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  CLAUDE_SDK_ERROR: "CLAUDE_SDK_ERROR",
  CLAUDE_AUTH_ERROR: "CLAUDE_AUTH_ERROR",
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  SESSION_STOPPED: "SESSION_STOPPED",
} as const;

export const ERROR_LIST_DELIMITER = "; ";

export const ERROR_MESSAGES = {
  DEFAULT_INTERNAL_ERROR: "An unexpected error occurred",
  MALFORMED_REQUEST_BODY: "Malformed request body",
  DATABASE_ERROR: "A database error occurred",
  INVALID_REQUEST: "Invalid request",
  REQUEST_FAILED_LOG: "request failed",

  MISSING_OR_MALFORMED_AUTH_HEADER:
    'Missing or malformed Authorization header; expected "Bearer <claude-token>"',
  AUTH_HEADER_NO_TOKEN: "Authorization header did not contain a token",

  INVALID_INPUT_BODY: "Body must be { content: string }",
  CONTENT_NON_EMPTY: "content must be a non-empty string",

  SESSION_ATTACHED_ELSEWHERE:
    "Session attached from elsewhere; closing this stream.",
  DURABLE_WRITE_FAILED:
    "Durable write failed; session stopped to avoid running ahead of persistence.",
  CLAUDE_AUTH_FAILED: "Host Claude authentication failed or expired.",
  SESSION_PROCESS_ENDED: "The session process ended unexpectedly.",
  PROMPT_PERSIST_FAILED: "Failed to durably record the prompt; not forwarded.",

  MARK_SDK_STARTED_FAILED_LOG: "markSdkStarted failed (non-fatal)",
  PUMP_MESSAGES_CRASHED_LOG: "pumpMessages loop crashed",
  MARK_SESSION_ERROR_FAILED_LOG:
    "Failed to mark session error after termination (best-effort)",
  LAST_ACTIVITY_FAILED_LOG: "Last Activity failed",

  FAILED_TO_START_SDK_SESSION: "Failed to start the Claude SDK session",
  FAILED_TO_START_HTTP_SERVER: "Failed to start HTTP server",

  DATABASE_URL_REQUIRED: "DATABASE_URL is required",
  INVALID_ENV_CONFIG_LOG: "Invalid environment configuration:",

  SSE_WRITE_FAILED_LOG: "SSE write failed",
  SSE_END_FAILED_LOG: "SSE end failed",

  sessionNotFound: (sessionId: string): string => `Session ${sessionId} not found`,
  sessionStopped: (sessionId: string, status: string): string =>
    `Session ${sessionId} is ${status}`,
  retryFailed: (label: string): string => `${label} failed, retrying`,
} as const;
