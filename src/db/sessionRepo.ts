import type { SessionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { withRetry } from '../lib/retry.js';

export interface SessionRow {
  sessionId: string;
  status: SessionStatus;
  sdkStarted: boolean;
  lastActivityAt: Date | null;
  createdAt: Date;
}

export async function createSession(sessionId: string): Promise<SessionRow> {
  return withRetry(() => prisma.session.create({ data: { sessionId } }), {
    label: 'sessionRepo.create',
  });
}

export async function findById(sessionId: string): Promise<SessionRow | null> {
  return prisma.session.findUnique({ where: { sessionId } });
}

export async function markSdkStarted(sessionId: string): Promise<void> {
  await withRetry(
    () => prisma.session.update({ where: { sessionId }, data: { sdkStarted: true } }),
    { label: 'sessionRepo.markSdkStarted' },
  );
}

export async function updateStatus(sessionId: string, status: SessionStatus): Promise<void> {
  await withRetry(() => prisma.session.update({ where: { sessionId }, data: { status } }), {
    label: 'sessionRepo.updateStatus',
  });
}

/** Coarse touch, called once per turn (not per chunk) to avoid a write storm. */
export async function touchLastActivity(sessionId: string): Promise<void> {
  await withRetry(
    () => prisma.session.update({ where: { sessionId }, data: { lastActivityAt: new Date() } }),
    { label: 'sessionRepo.touchLastActivity' },
  );
}
