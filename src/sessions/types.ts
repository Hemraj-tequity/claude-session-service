import type { FastifyReply } from 'fastify';
import type { Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { PushQueue } from './inputQueue.js';

export type SseEventType =
  | 'system_init'
  | 'chunk'
  | 'tool_use'
  | 'tool_result'
  | 'result'
  | 'error'
  | 'done';

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

/**
 * Turn-completion signal only -- every termination path (normal result,
 * persist failure, auth error, stream crash) resolves this rather than
 * rejecting, since the error detail is already communicated via an SSE
 * `error` frame; the awaiting caller just needs to know the turn is over.
 */
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
  idleTimer: NodeJS.Timeout | null;
  isGenerating: boolean;
  turnDone: Deferred | null;
  /** Next transcript sequence number; seeded from DB max(sequence)+1 on resurrect. */
  seq: number;
  lastActivityAt: number;
}
