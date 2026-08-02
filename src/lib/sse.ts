import type { FastifyReply } from "fastify";
import type { SseEvent } from "../sessions/types.js";
import { logger } from "./logger.js";

// Hijacks the reply and writes the SSE response headers to open the stream.
export function startSse(reply: FastifyReply): void {
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
}

// Writes a single SSE event frame to the reply, returning false if the write fails.
export function writeSse(reply: FastifyReply, event: SseEvent): boolean {
  try {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    return true;
  } catch (err) {
    logger.warn({ err }, "SSE write failed");
    return false;
  }
}

// Writes an SSE comment frame to keep an idle connection alive.
export function writeHeartbeat(reply: FastifyReply): boolean {
  try {
    reply.raw.write(":hb\n\n");
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
    logger.warn({ err }, "SSE end failed");
  }
}

// Builds an SSE event payload stamped with its type and current timestamp.
export function makeSseEvent(
  type: SseEvent["type"],
  fields: Omit<SseEvent, "type" | "timestamp"> = {},
): SseEvent {
  return { type, timestamp: new Date().toISOString(), ...fields };
}
