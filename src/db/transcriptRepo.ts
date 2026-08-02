import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { withRetry } from "../lib/retry.js";

export interface TranscriptRow {
  id: number;
  sessionId: string;
  subpath: string;
  sequence: number;
  eventType: string;
  entry: Prisma.JsonValue;
  createdAt: Date;
}

export async function append(
  sessionId: string,
  subpath: string,
  sequence: number,
  eventType: string,
  entry: unknown,
): Promise<TranscriptRow> {
  return withRetry(
    () =>
      prisma.sessionTranscript.create({
        data: {
          sessionId,
          subpath,
          sequence,
          eventType,
          entry: entry as Prisma.InputJsonValue,
        },
      }),
    { label: "transcriptRepo.append" },
  );
}

export async function maxSequence(sessionId: string): Promise<number> {
  const result = await prisma.sessionTranscript.aggregate({
    where: { sessionId },
    _max: { sequence: true },
  });
  return result._max.sequence ?? -1;
}

export async function findSince(
  sessionId: string,
  afterSequence: number,
): Promise<TranscriptRow[]> {
  return prisma.sessionTranscript.findMany({
    where: { sessionId, sequence: { gt: afterSequence } },
    orderBy: { sequence: "asc" },
  });
}
