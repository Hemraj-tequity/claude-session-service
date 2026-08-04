import type { FastifyReply } from "fastify";
import type { SseEvent } from "../sessions/types.js";
import { logger } from "./logger.js";
import {
  ERROR_MESSAGES,
  HTTP_STATUS,
  SSE_FRAME_PREFIX,
  SSE_FRAME_TERMINATOR,
  SSE_HEADERS,
  SSE_HEARTBEAT_FRAME,
} from "../constants/index.js";

// Hijacks the reply and writes the SSE response headers to open the stream.
export function startSse(reply: FastifyReply): void {
  reply.hijack();
  reply.raw.writeHead(HTTP_STATUS.OK, SSE_HEADERS);
}

// Writes a single SSE event frame to the reply, returning false if the write fails.
export function writeSse(reply: FastifyReply, event: SseEvent): boolean {
  try {
    reply.raw.write(`${SSE_FRAME_PREFIX}${JSON.stringify(event)}${SSE_FRAME_TERMINATOR}`);
    return true;
  } catch (err) {
    logger.warn({ err }, ERROR_MESSAGES.SSE_WRITE_FAILED_LOG);
    return false;
  }
}

// Writes an SSE comment frame to keep an idle connection alive.
export function writeHeartbeat(reply: FastifyReply): boolean {
  try {
    reply.raw.write(SSE_HEARTBEAT_FRAME);
    return true;
  } catch {
    return false;
  }
}

// Ends the underlying SSE connection.
export function endSse(reply: FastifyReply): void {
  try {
    reply.raw.end();
  } catch (err) {
    logger.warn({ err }, ERROR_MESSAGES.SSE_END_FAILED_LOG);
  }
}

// Builds an SSE event payload stamped with its type and current timestamp.
export function makeSseEvent(
  type: SseEvent["type"],
  fields: Omit<SseEvent, "type" | "timestamp"> = {},
): SseEvent {
  return { type, timestamp: new Date().toISOString(), ...fields };
}
