import { randomUUID } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { AppError, type ErrorCode } from '../lib/errors.js';
import { startSse, writeSse, writeHeartbeat, endSse, makeSseEvent } from '../lib/sse.js';
import * as sessionRepo from '../db/sessionRepo.js';
import * as historyRepo from '../db/historyRepo.js';
import * as transcriptRepo from '../db/transcriptRepo.js';
import { spawnQuery, type SpawnMode } from '../sdk/claudeClient.js';
import { PushQueue } from './inputQueue.js';
import { routeMessage, translateMessage } from './messageRouter.js';
import { createDeferred, type ActiveSession } from './types.js';

const activeSessions = new Map<string, ActiveSession>();

function createShell(sessionId: string): ActiveSession {
  return {
    sessionId,
    query: null,
    inputQueue: new PushQueue<SDKUserMessage>(),
    currentReader: null,
    heartbeatTimer: null,
    idleTimer: null,
    isGenerating: false,
    turnDone: null,
    seq: 0,
    lastActivityAt: Date.now(),
  };
}

function clearHeartbeat(session: ActiveSession): void {
  if (session.heartbeatTimer) {
    clearInterval(session.heartbeatTimer);
    session.heartbeatTimer = null;
  }
}

function armHeartbeat(session: ActiveSession): void {
  clearHeartbeat(session);
  if (!session.currentReader || session.isGenerating) return;
  session.heartbeatTimer = setInterval(() => {
    if (session.currentReader) writeHeartbeat(session.currentReader);
  }, 15000);
}

function clearIdleTimer(session: ActiveSession): void {
  if (session.idleTimer) {
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }
}

// function armIdleTimer(session: ActiveSession): void {
//   clearIdleTimer(session);
//   session.idleTimer = setTimeout(() => evict(session.sessionId), config.sessionIdleEvictMs);
// }

function touch(session: ActiveSession): void {
  session.lastActivityAt = Date.now();
  // armIdleTimer(session);
}

/**
 * Idle-eviction: closes the OS subprocess to free resources, but leaves DB
 * status as 'running' -- eviction is a pure in-memory optimization, invisible
 * to the API contract except for a small resume latency on the next access.
 */
function evict(sessionId: string): void {
  const session = activeSessions.get(sessionId);
  if (!session) return;
  if (session.isGenerating || session.currentReader) return; // no longer idle, a later touch() will reschedule

  logger.info({ sessionId }, 'Evicting idle session from memory');
  session.query?.close();
  activeSessions.delete(sessionId);
}

/** Takes over the single SSE slot for a session, closing whatever was previously attached. */
function takeOverReader(session: ActiveSession, newReader: FastifyReply): void {
  if (session.currentReader && session.currentReader !== newReader) {
    writeSse(session.currentReader, makeSseEvent('error', {
      content: 'Session attached from elsewhere; closing this stream.',
    }));
    endSse(session.currentReader);
  }
  clearHeartbeat(session);
  session.currentReader = newReader;
  newReader.raw.once('close', () => {
    if (session.currentReader === newReader) {
      session.currentReader = null;
      touch(session);
    }
  });
}

async function pumpMessages(session: ActiveSession, freshSpawn: boolean): Promise<void> {
  let markedStarted = !freshSpawn;
  try {
    for await (const msg of session.query!) {
      if (!markedStarted && msg.type === 'system' && msg.subtype === 'init') {
        markedStarted = true;
        sessionRepo.markSdkStarted(session.sessionId).catch((err) => {
          logger.warn({ err, sessionId: session.sessionId }, 'markSdkStarted failed (non-fatal)');
        });
      }
      touch(session);

      const outcome = await routeMessage(session, msg);

      if (outcome.persistFailed) {
        await terminateWithError(session, 'PERSIST_FAILED', 'Durable write failed; session stopped to avoid running ahead of persistence.');
        return;
      }
      if (outcome.authError) {
        await terminateWithError(session, 'CLAUDE_AUTH_ERROR', 'Host Claude authentication failed or expired.');
        return;
      }
      if (outcome.turnDone) {
        finishTurn(session);
        if (!session.isGenerating) armHeartbeat(session);
      }
    }
  } catch (err) {
    logger.error({ err, sessionId: session.sessionId }, 'pumpMessages loop crashed');
    await terminateWithError(session, 'STREAM_ERROR', 'The session process ended unexpectedly.');
  }
}

function finishTurn(session: ActiveSession): void {
  session.isGenerating = false;
  session.turnDone?.resolve();
  session.turnDone = null;
}

async function terminateWithError(session: ActiveSession, code: ErrorCode, message: string): Promise<void> {
  if (session.currentReader) {
    writeSse(session.currentReader, makeSseEvent('error', { content: message, code }));
    endSse(session.currentReader);
    session.currentReader = null;
  }
  clearHeartbeat(session);
  clearIdleTimer(session);
  session.query?.close();
  activeSessions.delete(session.sessionId);

  await sessionRepo.updateStatus(session.sessionId, 'error').catch((err) => {
    logger.error({ err, sessionId: session.sessionId }, 'Failed to mark session error after termination (best-effort)');
  });

  finishTurn(session);
}

/**
 * Returns the live ActiveSession for sessionId, spawning or resuming the
 * underlying Agent SDK subprocess if it isn't already resident in memory.
 * Spawn mode is driven by the DB's `sdkStarted` flag (not an in-memory flag),
 * so resurrection is correct across our own service restarts, not just
 * idle-eviction within one process.
 */
async function ensureLive(sessionId: string): Promise<ActiveSession> {
  const existing = activeSessions.get(sessionId);
  if (existing?.query) return existing;

  const row = await sessionRepo.findById(sessionId);
  if (!row) throw new AppError('SESSION_NOT_FOUND', `Session ${sessionId} not found`);
  if (row.status !== 'running') {
    throw new AppError('SESSION_STOPPED', `Session ${sessionId} is ${row.status}`);
  }

  const session = existing ?? createShell(sessionId);
  activeSessions.set(sessionId, session);

  const mode: SpawnMode = row.sdkStarted ? 'resume' : 'fresh';
  if (mode === 'resume') {
    session.seq = (await transcriptRepo.maxSequence(sessionId)) + 1;
  }

  session.query = spawnQuery(sessionId, mode, session.inputQueue);
  // armIdleTimer(session);
  void pumpMessages(session, mode === 'fresh');

  return session;
}

export async function createSession(): Promise<{ session_id: string; status: string; created_at: string }> {
  const sessionId = randomUUID();
  const row = await sessionRepo.createSession(sessionId);
  activeSessions.set(sessionId, createShell(sessionId));
  return { session_id: row.sessionId, status: row.status, created_at: row.createdAt.toISOString() };
}

export async function submitInput(sessionId: string, content: string, reply: FastifyReply): Promise<void> {
  const session = await ensureLive(sessionId);

  // Persisted BEFORE forwarding to the SDK -- if this fails, the request
  // never reaches the SDK and the caller gets a clean error, not a stream.
  try {
    await historyRepo.insertMessage(sessionId, 'user', content);
  } catch (err) {
    throw new AppError('PERSIST_FAILED', 'Failed to durably record the prompt; not forwarded.', { cause: (err as Error).message });
  }

  // Serialize concurrent /input calls on the same session -- one underlying
  // conversation stream can't have two prompts in flight at once.
  if (session.isGenerating && session.turnDone) {
    await session.turnDone.promise;
  }

  startSse(reply);
  takeOverReader(session, reply);
  clearHeartbeat(session);

  session.isGenerating = true;
  session.turnDone = createDeferred();
  session.inputQueue.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null });

  await session.turnDone.promise;

  if (session.currentReader === reply) {
    writeSse(reply, makeSseEvent('done', {}));
    endSse(reply);
    session.currentReader = null;
  }
}

async function replayPersisted(sessionId: string, reply: FastifyReply): Promise<void> {
  const rows = await transcriptRepo.findSince(sessionId, -1);
  for (const row of rows) {
    // Stored verbatim as the original SDKMessage; re-run through the same
    // translator used live so a reattaching client sees identical event shapes.
    const { events } = translateMessage(row.entry as never);
    for (const event of events) {
      writeSse(reply, event);
    }
  }
}

export async function attach(sessionId: string, reply: FastifyReply): Promise<void> {
  const row = await sessionRepo.findById(sessionId);
  if (!row) throw new AppError('SESSION_NOT_FOUND', `Session ${sessionId} not found`);

  if (row.status !== 'running') {
    startSse(reply);
    await replayPersisted(sessionId, reply);
    writeSse(reply, makeSseEvent('done', {}));
    endSse(reply);
    return;
  }

  const session = await ensureLive(sessionId);
  startSse(reply);
  await replayPersisted(sessionId, reply);
  takeOverReader(session, reply);
  if (!session.isGenerating) armHeartbeat(session);
}

export async function stop(sessionId: string): Promise<{ session_id: string; status: string }> {
  const row = await sessionRepo.findById(sessionId);
  if (!row) throw new AppError('SESSION_NOT_FOUND', `Session ${sessionId} not found`);

  const session = activeSessions.get(sessionId);
  if (session) {
    clearHeartbeat(session);
    clearIdleTimer(session);
    if (session.isGenerating) {
      await session.query?.interrupt().catch(() => {});
    }
    if (session.currentReader) {
      writeSse(session.currentReader, makeSseEvent('done', {}));
      endSse(session.currentReader);
      session.currentReader = null;
    }
    session.query?.close();
    session.inputQueue.close();
    finishTurn(session);
    activeSessions.delete(sessionId);
  }

  await sessionRepo.updateStatus(sessionId, 'stopped');
  return { session_id: sessionId, status: 'stopped' };
}
