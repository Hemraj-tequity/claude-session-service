import type { SessionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { withRetry } from "../lib/retry.js";

export interface SessionRow {
  sessionId: string;
  status: SessionStatus;
  sdkStarted: boolean;
  lastActivityAt: Date | null;
  createdAt: Date;
}

// Inserts a new session row with the given id.
export async function createSession(sessionId: string): Promise<SessionRow> {
  return withRetry(() => prisma.session.create({ data: { sessionId } }), {
    label: "sessionRepo.create",
  });
}

// Looks up a session row by id, returning null if it doesn't exist.
export async function findById(sessionId: string): Promise<SessionRow | null> {
  return prisma.session.findUnique({ where: { sessionId } });
}

// Flags a session as having started its underlying Claude SDK process.
export async function markSdkStarted(sessionId: string): Promise<void> {
  await withRetry(
    () =>
      prisma.session.update({
        where: { sessionId },
        data: { sdkStarted: true },
      }),
    { label: "sessionRepo.markSdkStarted" },
  );
}

// Updates a session's status (e.g. running, stopped, error).
export async function updateStatus(
  sessionId: string,
  status: SessionStatus,
): Promise<void> {
  await withRetry(
    () => prisma.session.update({ where: { sessionId }, data: { status } }),
    {
      label: "sessionRepo.updateStatus",
    },
  );
}

// Stamps a session's last-activity time with the current moment.
export async function touchLastActivity(sessionId: string): Promise<void> {
  await withRetry(
    () =>
      prisma.session.update({
        where: { sessionId },
        data: { lastActivityAt: new Date() },
      }),
    { label: "sessionRepo.touchLastActivity" },
  );
}
