import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import * as transcriptRepo from '../db/transcriptRepo.js';
import * as historyRepo from '../db/historyRepo.js';
import * as sessionRepo from '../db/sessionRepo.js';
import { writeSse, makeSseEvent } from '../lib/sse.js';
import { isAuthError } from '../sdk/claudeClient.js';
import { logger } from '../lib/logger.js';
import type { ActiveSession, SseEvent } from './types.js';

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

export interface Translation {
  events: SseEvent[];
  /** Full consolidated assistant text, if this message carried any -- recorded once to session_history. */
  historyText: string | null;
  authError: boolean;
  turnDone?: { isError: boolean; message: string };
}

function subpathFor(msg: SDKMessage): string {
  const parentToolUseId = (msg as { parent_tool_use_id?: string | null }).parent_tool_use_id;
  return parentToolUseId ?? 'root';
}

function textOf(blocks: ContentBlock[]): string {
  return blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

/**
 * Pure SDKMessage -> SSE-event translation, with no I/O. Shared by the live
 * fan-out path (routeMessage, below) and attach's transcript replay, so a
 * reattaching client sees the exact same event shapes it would have seen live.
 */
export function translateMessage(msg: SDKMessage): Translation {
  const events: SseEvent[] = [];
  let historyText: string | null = null;
  let authError = false;
  let turnDone: Translation['turnDone'];

  switch (msg.type) {
    case 'system': {
      if (msg.subtype === 'init') {
        events.push(makeSseEvent('system_init', { model: msg.model, tools: msg.tools }));
      }
      break;
    }
    case 'stream_event': {
      const event = msg.event as { type?: string; delta?: { type?: string; text?: string } };
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        events.push(makeSseEvent('chunk', { content: event.delta.text ?? '' }));
      }
      break;
    }
    case 'assistant': {
      authError = isAuthError(msg);
      const blocks = (msg.message.content ?? []) as ContentBlock[];
      for (const block of blocks) {
        if (block.type === 'tool_use') {
          events.push(
            makeSseEvent('tool_use', { toolUseId: block.id, toolName: block.name, input: block.input }),
          );
        }
      }
      // Full consolidated text for this assistant message -- separate from the
      // live `chunk` deltas above, which came from `stream_event` as the same
      // text streamed in. Recorded once to session_history so it stays a
      // clean, replayable conversation log rather than a pile of fragments.
      const text = textOf(blocks);
      if (text.length > 0) historyText = text;
      break;
    }
    case 'user': {
      // Our own forwarded prompts are already persisted to session_history by
      // submitInput before the SDK ever sees them, so a 'user' message coming
      // back through the stream here is always a tool-result echo, not a
      // fresh prompt -- route it to transcripts/SSE only, never to history.
      const blocks = (Array.isArray(msg.message.content) ? msg.message.content : []) as ContentBlock[];
      for (const block of blocks) {
        if (block.type === 'tool_result') {
          events.push(
            makeSseEvent('tool_result', {
              toolUseId: block.tool_use_id,
              content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
              isError: block.is_error ?? false,
            }),
          );
        }
      }
      break;
    }
    case 'result': {
      if (msg.subtype === 'success') {
        events.push(makeSseEvent('result', { content: msg.result, isError: false, numTurns: msg.num_turns }));
        turnDone = { isError: false, message: msg.result };
      } else {
        events.push(makeSseEvent('result', { content: undefined, isError: true, numTurns: msg.num_turns }));
        turnDone = { isError: true, message: msg.errors.join('; ') };
      }
      break;
    }
    default:
      // Other message types (tasks, hooks, plugin/status events, etc.) aren't
      // surfaced over this API's SSE contract -- still get a transcript row
      // via the unconditional append() in routeMessage, for completeness.
      break;
  }

  return { events, historyText, authError, turnDone };
}

export interface RouteOutcome {
  /** Set when this message concluded the in-flight turn (success or error). */
  turnDone?: { isError: boolean; message: string };
  /** Set when the SDK reported an authentication failure on this message. */
  authError?: boolean;
  /** Set when the durable Postgres write failed after retries -- caller must stop the session. */
  persistFailed?: Error;
}

/**
 * Translates one SDKMessage, appends a transcript row, and reports back any
 * turn-lifecycle signal the caller (SessionManager) needs to act on. The
 * socket write and the DB write both start immediately and neither blocks
 * the other's own completion -- only the *next* message's processing waits
 * on this one's DB write, which bounds in-flight writes to 1 while
 * preserving transcript ordering.
 */
export async function routeMessage(session: ActiveSession, msg: SDKMessage): Promise<RouteOutcome> {
  const { events, historyText, authError, turnDone } = translateMessage(msg);
  const outcome: RouteOutcome = { authError: authError || undefined, turnDone };

  if (session.currentReader) {
    for (const sseEvent of events) {
      writeSse(session.currentReader, sseEvent);
    }
  }

  // DB writes start now, independent of (and after) the socket write above --
  // both were kicked off for this message before the loop advances to the next.
  const subpath = subpathFor(msg);
  const writes: Promise<unknown>[] = [
    transcriptRepo.append(session.sessionId, subpath, session.seq, msg.type, msg).then(() => {
      session.seq += 1;
    }),
  ];
  if (historyText !== null) {
    writes.push(historyRepo.insertMessage(session.sessionId, 'assistant', historyText));
  }

  const results = await Promise.allSettled(writes);
  const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failure) {
    outcome.persistFailed = failure.reason as Error;
  }

  if (outcome.turnDone) {
    sessionRepo.touchLastActivity(session.sessionId).catch((err) => {
      logger.warn({ err, sessionId: session.sessionId }, 'touchLastActivity failed (non-fatal)');
    });
  }

  return outcome;
}
