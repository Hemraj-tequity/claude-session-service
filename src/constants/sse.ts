export const SSE_EVENT_TYPE = {
  SYSTEM_INIT: "system_init",
  CHUNK: "chunk",
  TOOL_USE: "tool_use",
  TOOL_RESULT: "tool_result",
  RESULT: "result",
  ERROR: "error",
  DONE: "done",
} as const;

export const SSE_FRAME_PREFIX = "data: ";
export const SSE_FRAME_TERMINATOR = "\n\n";
export const SSE_HEARTBEAT_FRAME = ":hb\n\n";
