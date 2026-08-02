import { randomUUID } from "node:crypto";
import type { FastifyReply } from "fastify";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../lib/logger.js";
import { AppError, type ErrorCode } from "../lib/errors.js";
import {
  startSse,
  writeSse,
  writeHeartbeat,
  endSse,
  makeSseEvent,
} from "../lib/sse.js";
import * as sessionRepo from "../db/sessionRepo.js";
import * as historyRepo from "../db/historyRepo.js";
import * as transcriptRepo from "../db/transcriptRepo.js";
import { spawnQuery, type SpawnMode } from "../sdk/claudeClient.js";
import { PushQueue } from "./inputQueue.js";
import { routeMessage, translateMessage } from "./messageRouter.js";
import { createDeferred, type ActiveSession } from "./types.js";

/** How often to send an SSE heartbeat comment while a reader is attached but idle (no turn in flight). */
const HEARTBEAT_INTERVAL_MS = 15_000;

const activeSessions = new Map<string, ActiveSession>();

function createShell(sessionId: string): ActiveSession {
  return {
    sessionId,
    query: null,
    inputQueue: new PushQueue<SDKUserMessage>(),
    currentReader: null,
    heartbeatTimer: null,
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
  }, HEARTBEAT_INTERVAL_MS);
}

function touch(session: ActiveSession): void {
  session.lastActivityAt = Date.now();
}

/** Writes one final SSE event to a reader, then ends the stream. */
function closeReader(
  reader: FastifyReply,
  event: ReturnType<typeof makeSseEvent>,
): void {
  writeSse(reader, event);
  endSse(reader);
}

/** Takes over the single SSE slot for a session, closing whatever was previously attached. */
function takeOverReader(session: ActiveSession, newReader: FastifyReply): void {
  if (session.currentReader && session.currentReader !== newReader) {
    closeReader(
      session.currentReader,
      makeSseEvent("error", {
        content: "Session attached from elsewhere; closing this stream.",
      }),
    );
  }
  clearHeartbeat(session);
  session.currentReader = newReader;
  newReader.raw.once("close", () => {
    if (session.currentReader === newReader) {
      session.currentReader = null;
      touch(session);
    }
  });
}

async function pumpMessages(
  session: ActiveSession,
  freshSpawn: boolean,
): Promise<void> {
  let markedStarted = !freshSpawn;
  try {
    for await (const msg of session.query!) {
      if (!markedStarted && msg.type === "system" && msg.subtype === "init") {
        markedStarted = true;
        sessionRepo.markSdkStarted(session.sessionId).catch((err) => {
          logger.warn(
            { err, sessionId: session.sessionId },
            "markSdkStarted failed (non-fatal)",
          );
        });
      }
      touch(session);

      const outcome = await routeMessage(session, msg);

      if (outcome.persistFailed) {
        await terminateWithError(
          session,
          "PERSIST_FAILED",
          "Durable write failed; session stopped to avoid running ahead of persistence.",
        );
        return;
      }
      if (outcome.authError) {
        await terminateWithError(
          session,
          "CLAUDE_AUTH_ERROR",
          "Host Claude authentication failed or expired.",
        );
        return;
      }
      if (outcome.turnDone) {
        finishTurn(session);
        if (!session.isGenerating) armHeartbeat(session);
      }
    }
  } catch (err) {
    logger.error(
      { err, sessionId: session.sessionId },
      "pumpMessages loop crashed",
    );
    await terminateWithError(
      session,
      "STREAM_ERROR",
      "The session process ended unexpectedly.",
    );
  }
}

function finishTurn(session: ActiveSession): void {
  session.isGenerating = false;
  session.turnDone?.resolve();
  session.turnDone = null;
}

async function terminateWithError(
  session: ActiveSession,
  code: ErrorCode,
  message: string,
): Promise<void> {
  if (session.currentReader) {
    closeReader(
      session.currentReader,
      makeSseEvent("error", { content: message, code }),
    );
    session.currentReader = null;
  }
  clearHeartbeat(session);
  session.query?.close();
  activeSessions.delete(session.sessionId);

  await sessionRepo.updateStatus(session.sessionId, "error").catch((err) => {
    logger.error(
      { err, sessionId: session.sessionId },
      "Failed to mark session error after termination (best-effort)",
    );
  });

  finishTurn(session);
}

async function ensureLive(
  sessionId: string,
  claudeToken: string,
): Promise<ActiveSession> {
  const existing = activeSessions.get(sessionId);
  if (existing?.query) return existing;

  const row = await sessionRepo.findById(sessionId);
  if (!row)
    throw new AppError("SESSION_NOT_FOUND", `Session ${sessionId} not found`);
  if (row.status !== "running") {
    throw new AppError(
      "SESSION_STOPPED",
      `Session ${sessionId} is ${row.status}`,
    );
  }

  const session = existing ?? createShell(sessionId);
  activeSessions.set(sessionId, session);

  const mode: SpawnMode = row.sdkStarted ? "resume" : "fresh";
  if (mode === "resume") {
    session.seq = (await transcriptRepo.maxSequence(sessionId)) + 1;
  }

  session.query = spawnQuery(sessionId, mode, session.inputQueue, claudeToken);
  void pumpMessages(session, mode === "fresh");

  return session;
}

export async function createSession(): Promise<{
  session_id: string;
  status: string;
  created_at: string;
}> {
  const sessionId = randomUUID();
  const row = await sessionRepo.createSession(sessionId);
  activeSessions.set(sessionId, createShell(sessionId));
  return {
    session_id: row.sessionId,
    status: row.status,
    created_at: row.createdAt.toISOString(),
  };
}

export async function submitInput(
  sessionId: string,
  content: string,
  reply: FastifyReply,
  claudeToken: string,
): Promise<void> {
  const session = await ensureLive(sessionId, claudeToken);

  try {
    await historyRepo.insertMessage(sessionId, "user", content);
  } catch (err) {
    throw new AppError(
      "PERSIST_FAILED",
      "Failed to durably record the prompt; not forwarded.",
      { cause: (err as Error).message },
    );
  }

  if (session.isGenerating && session.turnDone) {
    await session.turnDone.promise;
  }

  startSse(reply);
  takeOverReader(session, reply);
  clearHeartbeat(session);

  session.isGenerating = true;
  session.turnDone = createDeferred();
  session.inputQueue.push({
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
  });

  await session.turnDone.promise;

  if (session.currentReader === reply) {
    closeReader(reply, makeSseEvent("done", {}));
    session.currentReader = null;
  }
}

async function replayPersisted(
  sessionId: string,
  reply: FastifyReply,
): Promise<void> {
  const rows = await transcriptRepo.findSince(sessionId, -1);
  for (const row of rows) {
    const { events } = translateMessage(row.entry as never);
    for (const event of events) {
      writeSse(reply, event);
    }
  }
}

export async function attach(
  sessionId: string,
  reply: FastifyReply,
  claudeToken: string,
): Promise<void> {
  const row = await sessionRepo.findById(sessionId);
  if (!row)
    throw new AppError("SESSION_NOT_FOUND", `Session ${sessionId} not found`);

  if (row.status !== "running") {
    startSse(reply);
    await replayPersisted(sessionId, reply);
    closeReader(reply, makeSseEvent("done", {}));
    return;
  }

  const session = await ensureLive(sessionId, claudeToken);
  startSse(reply);
  await replayPersisted(sessionId, reply);
  takeOverReader(session, reply);
  if (!session.isGenerating) armHeartbeat(session);
}

/** Interrupts and tears down a session's live subprocess (if any) and marks it stopped in the DB. */
export async function stop(
  sessionId: string,
): Promise<{ session_id: string; status: string }> {
  const row = await sessionRepo.findById(sessionId);
  if (!row)
    throw new AppError("SESSION_NOT_FOUND", `Session ${sessionId} not found`);

  const session = activeSessions.get(sessionId);
  if (session) {
    clearHeartbeat(session);
    if (session.isGenerating) {
      await session.query?.interrupt().catch(() => {});
    }
    if (session.currentReader) {
      closeReader(session.currentReader, makeSseEvent("done", {}));
      session.currentReader = null;
    }
    session.query?.close();
    session.inputQueue.close();
    finishTurn(session);
    activeSessions.delete(sessionId);
  }

  await sessionRepo.updateStatus(sessionId, "stopped");
  return { session_id: sessionId, status: "stopped" };
}
