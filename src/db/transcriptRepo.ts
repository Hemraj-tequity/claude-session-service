import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { withRetry } from "../lib/retry.js";
import { NO_TRANSCRIPT_SEQUENCE } from "../constants/index.js";

export interface TranscriptRow {
  id: number;
  sessionId: string;
  subpath: string;
  sequence: number;
  eventType: string;
  entry: Prisma.JsonValue;
  createdAt: Date;
}

// Persists a single raw SDK event as the next entry in a session's transcript.
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

// Returns the highest transcript sequence number recorded for a session, or -1 if none exist.
export async function maxSequence(sessionId: string): Promise<number> {
  const result = await prisma.sessionTranscript.aggregate({
    where: { sessionId },
    _max: { sequence: true },
  });
  return result._max.sequence ?? NO_TRANSCRIPT_SEQUENCE;
}

// Fetches transcript rows for a session with a sequence number greater than the given value.
export async function findSince(
  sessionId: string,
  afterSequence: number,
): Promise<TranscriptRow[]> {
  return prisma.sessionTranscript.findMany({
    where: { sessionId, sequence: { gt: afterSequence } },
    orderBy: { sequence: "asc" },
  });
}
