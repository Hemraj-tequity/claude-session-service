import { randomUUID } from "node:crypto";
import type { FastifyReply } from "fastify";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { logger } from "../lib/logger.js";
import {
  type AppError,
  NotFoundError,
  PersistenceError,
  ClaudeAuthError,
  ChunkError,
} from "../lib/errors.js";
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
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  ERROR_CODES,
  ERROR_MESSAGES,
  MESSAGE_ROLE,
  NO_TRANSCRIPT_SEQUENCE,
  SESSION_STATUS,
  SPAWN_MODE,
  SSE_EVENT_TYPE,
} from "../constants/index.js";

/** How often to send an SSE heartbeat comment while a reader is attached but idle (no turn in flight). */
const HEARTBEAT_INTERVAL_MS = DEFAULT_HEARTBEAT_INTERVAL_MS;

const activeSessions = new Map<string, ActiveSession>();

// Builds a fresh session in memory, when not-yet in-memory session state record.
function createIdleSessionState(sessionId: string): ActiveSession {
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

// Cancels a session's heartbeat timer, if one is running.
function stopHeartbeat(session: ActiveSession): void {
  if (session.heartbeatTimer) {
    clearInterval(session.heartbeatTimer);
    session.heartbeatTimer = null;
  }
}

/*
  Nobody is sending anything. Maybe this connection is dead."
  Every 15 seconds server sends a message like ...
  The browser ignores it. But the connection stays alive.
*/
function startHeartbeat(session: ActiveSession): void {
  stopHeartbeat(session);
  if (!session.currentReader || session.isGenerating) return;
  session.heartbeatTimer = setInterval(() => {
    if (session.currentReader) writeHeartbeat(session.currentReader);
  }, HEARTBEAT_INTERVAL_MS);
}

// Records the current time as the session's last-activity timestamp.
function markSessionActive(session: ActiveSession): void {
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
      makeSseEvent(SSE_EVENT_TYPE.ERROR, {
        content: ERROR_MESSAGES.SESSION_ATTACHED_ELSEWHERE,
      }),
    );
  }
  stopHeartbeat(session);
  session.currentReader = newReader;
  newReader.raw.once("close", () => {
    if (session.currentReader === newReader) {
      session.currentReader = null;
      markSessionActive(session);
    }
  });
}

// Consumes the SDK's message stream for a session, routing each message and reacting to terminal outcomes.
async function consumeAgentMessageStream(
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
            ERROR_MESSAGES.MARK_SDK_STARTED_FAILED_LOG,
          );
        });
      }
      markSessionActive(session);

      const outcome = await routeMessage(session, msg);

      if (outcome.persistFailed) {
        await terminateWithError(
          session,
          new PersistenceError(
            ERROR_MESSAGES.DURABLE_WRITE_FAILED,
            { cause: outcome.persistFailed },
          ),
        );
        return;
      }
      if (outcome.authError) {
        await terminateWithError(
          session,
          new ClaudeAuthError(ERROR_MESSAGES.CLAUDE_AUTH_FAILED),
        );
        return;
      }
      if (outcome.turnDone) {
        completeCurrentTurn(session);
        if (!session.isGenerating) startHeartbeat(session);
      }
    }
  } catch (err) {
    logger.error(
      { err, sessionId: session.sessionId },
      ERROR_MESSAGES.PUMP_MESSAGES_CRASHED_LOG,
    );
    await terminateWithError(
      session,
      new ChunkError(ERROR_MESSAGES.SESSION_PROCESS_ENDED, { cause: err }),
    );
  }
}

// Marks the in-flight turn as finished and releases anyone awaiting it.
function completeCurrentTurn(session: ActiveSession): void {
  session.isGenerating = false;
  session.turnDone?.resolve();
  session.turnDone = null;
}

// Closes out a session's reader and subprocess, then marks it errored in the DB.
async function terminateWithError(
  session: ActiveSession,
  error: AppError,
): Promise<void> {
  if (session.currentReader) {
    closeReader(
      session.currentReader,
      makeSseEvent(SSE_EVENT_TYPE.ERROR, { content: error.message, code: error.type }),
    );
    session.currentReader = null;
  }
  stopHeartbeat(session);
  session.query?.close();
  activeSessions.delete(session.sessionId);

  await sessionRepo.updateStatus(session.sessionId, SESSION_STATUS.ERROR).catch((err) => {
    logger.error(
      { err, sessionId: session.sessionId },
      ERROR_MESSAGES.MARK_SESSION_ERROR_FAILED_LOG,
    );
  });

  completeCurrentTurn(session);
}

// Returns the session's live in-memory state, spawning the SDK query if it isn't already running.
async function getOrStartLiveSession(
  sessionId: string,
  claudeToken: string,
): Promise<ActiveSession> {
  const existing = activeSessions.get(sessionId);
  if (existing?.query) return existing;

  const row = await sessionRepo.findById(sessionId);
  if (!row)
    throw new NotFoundError(ERROR_MESSAGES.sessionNotFound(sessionId), ERROR_CODES.SESSION_NOT_FOUND);

  const session = existing ?? createIdleSessionState(sessionId);
  activeSessions.set(sessionId, session);

  const mode: SpawnMode = row.sdkStarted ? SPAWN_MODE.RESUME : SPAWN_MODE.FRESH;
  if (mode === SPAWN_MODE.RESUME) {
    session.seq = (await transcriptRepo.maxSequence(sessionId)) + 1;
  }

  session.query = spawnQuery(sessionId, mode, session.inputQueue, claudeToken);
  void consumeAgentMessageStream(session, mode === SPAWN_MODE.FRESH);

  return session;
}

// Creates a new session record and registers its idle in-memory state.
export async function createSession(): Promise<{
  session_id: string;
  status: string;
  created_at: string;
}> {
  const sessionId = randomUUID();
  const row = await sessionRepo.createSession(sessionId);
  activeSessions.set(sessionId, createIdleSessionState(sessionId));
  return {
    session_id: row.sessionId,
    status: row.status,
    created_at: row.createdAt.toISOString(),
  };
}

// Records the caller's prompt, forwards it to the live session, and streams the reply over SSE until the turn completes.
export async function submitInput(
  sessionId: string,
  content: string,
  reply: FastifyReply,
  claudeToken: string,
): Promise<void> {
  // Get and Create a Claude Session
  await sessionRepo.updateStatus(sessionId, SESSION_STATUS.RUNNING);
  const session = await getOrStartLiveSession(sessionId, claudeToken);

  try {
    await historyRepo.insertMessage(sessionId, MESSAGE_ROLE.USER, content);
  } catch (err) {
    throw new PersistenceError(
      ERROR_MESSAGES.PROMPT_PERSIST_FAILED,
      { cause: err },
    );
  }

  // Check if Claude is Already Busy
  if (session.isGenerating && session.turnDone) {
    await session.turnDone.promise;
  }

  // Start SSE
  startSse(reply);
  takeOverReader(session, reply);
  stopHeartbeat(session);

  session.isGenerating = true;
  session.turnDone = createDeferred();

  // Queue User Message
  session.inputQueue.push({
    type: "user",
    message: { role: MESSAGE_ROLE.USER, content },
    parent_tool_use_id: null,
  });

  // Wait Until Claude Finishes
  await session.turnDone.promise;

  // Close SSE
  if (session.currentReader === reply) {
    closeReader(reply, makeSseEvent(SSE_EVENT_TYPE.DONE, {}));
    session.currentReader = null;
  }
}

// Replays a session's persisted transcript over SSE, for readers joining after it stopped or resuming mid-stream.
async function replayPersistedTranscript(
  sessionId: string,
  reply: FastifyReply,
): Promise<void> {
  // Give all rows whose sequence number is greater than NO_TRANSCRIPT_SEQUENCE
  const rows = await transcriptRepo.findSince(sessionId, NO_TRANSCRIPT_SEQUENCE);

  // Translate each row's entry into Claude-formatted events.
  for (const row of rows) {
    const { events } = translateMessage(row.entry as never);

    // For each event, write it to the reply stream
    for (const event of events) {
      writeSse(reply, event);
    }
  }
}

// Attaches an SSE reader to a session, replaying its history and, if running, taking over its live stream.
export async function attach(
  sessionId: string,
  reply: FastifyReply,
  claudeToken: string,
): Promise<void> {
  const row = await sessionRepo.findById(sessionId);
  if (!row)
    throw new NotFoundError(ERROR_MESSAGES.sessionNotFound(sessionId), ERROR_CODES.SESSION_NOT_FOUND);

  if (row.status !== SESSION_STATUS.RUNNING) {
    startSse(reply);
    await replayPersistedTranscript(sessionId, reply);
    // Sends a final "done" event.
    closeReader(reply, makeSseEvent(SSE_EVENT_TYPE.DONE, {}));
    return;
  }

  const session = await getOrStartLiveSession(sessionId, claudeToken);
  startSse(reply);
  await replayPersistedTranscript(sessionId, reply);
  takeOverReader(session, reply);
  if (!session.isGenerating) startHeartbeat(session);
}

/** Interrupts and tears down a session's live subprocess (if any) and marks it stopped in the DB. */
export async function stop(
  sessionId: string,
): Promise<{ session_id: string; status: string }> {
  const row = await sessionRepo.findById(sessionId);
  if (!row)
    throw new NotFoundError(ERROR_MESSAGES.sessionNotFound(sessionId), ERROR_CODES.SESSION_NOT_FOUND);

  const session = activeSessions.get(sessionId);
  if (session) {
    stopHeartbeat(session);
    if (session.isGenerating) {
      await session.query?.interrupt().catch(() => {});
    }
    if (session.currentReader) {
      closeReader(session.currentReader, makeSseEvent(SSE_EVENT_TYPE.DONE, {}));
      session.currentReader = null;
    }
    session.query?.close();
    session.inputQueue.close();
    completeCurrentTurn(session);
    activeSessions.delete(sessionId);
  }

  await sessionRepo.updateStatus(sessionId, SESSION_STATUS.STOPPED);
  return { session_id: sessionId, status: SESSION_STATUS.STOPPED };
}
