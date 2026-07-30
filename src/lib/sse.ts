import type { FastifyReply } from 'fastify';
import type { SseEvent } from '../sessions/types.js';
import { logger } from './logger.js';

/**
 * Hijacks the reply and writes SSE headers. After this call, Fastify's own
 * response lifecycle no longer applies -- writes go straight to the raw
 * socket via writeSse()/endSse().
 */
export function startSse(reply: FastifyReply): void {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

/** Writes one SSE frame. Returns false (and logs) if the write failed. */
export function writeSse(reply: FastifyReply, event: SseEvent): boolean {
  try {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    return true;
  } catch (err) {
    logger.warn({ err }, 'SSE write failed');
    return false;
  }
}

export function writeHeartbeat(reply: FastifyReply): boolean {
  try {
    reply.raw.write(':hb\n\n');
    return true;
  } catch {
    return false;
  }
}

export function endSse(reply: FastifyReply): void {
  try {
    reply.raw.end();
  } catch {
    // socket already closed -- nothing to do
  }
}

export function makeSseEvent(type: SseEvent['type'], fields: Omit<SseEvent, 'type' | 'timestamp'> = {}): SseEvent {
  return { type, timestamp: new Date().toISOString(), ...fields };
}
