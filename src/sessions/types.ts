import type { FastifyReply } from "fastify";
import type { Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { PushQueue } from "./inputQueue.js";

export type SseEventType =
  | "system_init"
  | "chunk"
  | "tool_use"
  | "tool_result"
  | "result"
  | "error"
  | "done";

export interface SseEvent {
  type: SseEventType;
  timestamp: string;
  content?: string;
  [key: string]: unknown;
}

export interface Deferred<T = void> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

// Creates a promise along with an external function that resolves it.
export function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

export interface ActiveSession {
  sessionId: string;
  query: Query | null;
  inputQueue: PushQueue<SDKUserMessage>;
  currentReader: FastifyReply | null;
  heartbeatTimer: NodeJS.Timeout | null;
  isGenerating: boolean;
  turnDone: Deferred | null;
  seq: number;
  lastActivityAt: number;
}
