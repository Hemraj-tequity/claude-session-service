import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import * as transcriptRepo from "../db/transcriptRepo.js";
import * as historyRepo from "../db/historyRepo.js";
import * as sessionRepo from "../db/sessionRepo.js";
import { writeSse, makeSseEvent } from "../lib/sse.js";
import { isAuthError } from "../sdk/claudeClient.js";
import { logger } from "../lib/logger.js";
import type { ActiveSession, SseEvent } from "./types.js";

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
  historyText: string | null;
  authError: boolean;
  turnDone?: { isError: boolean; message: string };
}

function subpathFor(msg: SDKMessage): string {
  const parentToolUseId = (msg as { parent_tool_use_id?: string | null })
    .parent_tool_use_id;
  return parentToolUseId ?? "root";
}

function textOf(blocks: ContentBlock[]): string {
  return blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

export function translateMessage(msg: SDKMessage): Translation {
  const events: SseEvent[] = [];
  let historyText: string | null = null;
  let authError = false;
  let turnDone: Translation["turnDone"];

  switch (msg.type) {
    case "system": {
      if (msg.subtype === "init") {
        events.push(
          makeSseEvent("system_init", { model: msg.model, tools: msg.tools }),
        );
      }
      break;
    }
    case "stream_event": {
      const event = msg.event as {
        type?: string;
        delta?: { type?: string; text?: string };
      };
      if (
        event.type === "content_block_delta" &&
        event.delta?.type === "text_delta"
      ) {
        events.push(makeSseEvent("chunk", { content: event.delta.text ?? "" }));
      }
      break;
    }
    case "assistant": {
      authError = isAuthError(msg);
      const blocks = ((msg.message as { content?: unknown }).content ??
        []) as ContentBlock[];
      for (const block of blocks) {
        if (block.type === "tool_use") {
          events.push(
            makeSseEvent("tool_use", {
              toolUseId: block.id,
              toolName: block.name,
              input: block.input,
            }),
          );
        }
      }
      const text = textOf(blocks);
      if (text.length > 0) historyText = text;
      break;
    }
    case "user": {
      const content = (msg.message as { content?: unknown }).content;
      const blocks = (Array.isArray(content) ? content : []) as ContentBlock[];
      for (const block of blocks) {
        if (block.type === "tool_result") {
          events.push(
            makeSseEvent("tool_result", {
              toolUseId: block.tool_use_id,
              content:
                typeof block.content === "string"
                  ? block.content
                  : JSON.stringify(block.content),
              isError: block.is_error ?? false,
            }),
          );
        }
      }
      break;
    }
    case "result": {
      if (msg.subtype === "success") {
        events.push(
          makeSseEvent("result", {
            content: msg.result,
            isError: false,
            numTurns: msg.num_turns,
          }),
        );
        turnDone = { isError: false, message: msg.result };
      } else {
        events.push(
          makeSseEvent("result", {
            content: undefined,
            isError: true,
            numTurns: msg.num_turns,
          }),
        );
        turnDone = { isError: true, message: msg.errors.join("; ") };
      }
      break;
    }
    default:
      break;
  }

  return { events, historyText, authError, turnDone };
}

export interface RouteOutcome {
  turnDone?: { isError: boolean; message: string };
  authError?: boolean;
  persistFailed?: Error;
}

export async function routeMessage(
  session: ActiveSession,
  msg: SDKMessage,
): Promise<RouteOutcome> {
  const { events, historyText, authError, turnDone } = translateMessage(msg);
  const outcome: RouteOutcome = { authError: authError || undefined, turnDone };

  if (session.currentReader) {
    for (const sseEvent of events) {
      writeSse(session.currentReader, sseEvent);
    }
  }

  const subpath = subpathFor(msg);
  const writes: Promise<unknown>[] = [
    transcriptRepo
      .append(session.sessionId, subpath, session.seq, msg.type, msg)
      .then(() => {
        session.seq += 1;
      }),
  ];
  if (historyText !== null) {
    writes.push(
      historyRepo.insertMessage(session.sessionId, "assistant", historyText),
    );
  }

  const results = await Promise.allSettled(writes);
  const failure = results.find(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  if (failure) {
    outcome.persistFailed = failure.reason as Error;
  }

  if (outcome.turnDone) {
    sessionRepo.touchLastActivity(session.sessionId).catch((err) => {
      logger.warn(
        { err, sessionId: session.sessionId },
        "touchLastActivity failed (non-fatal)",
      );
    });
  }

  return outcome;
}
