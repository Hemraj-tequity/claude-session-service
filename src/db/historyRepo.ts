import type { HistoryRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { withRetry } from "../lib/retry.js";

export interface HistoryRow {
  id: number;
  sessionId: string;
  role: HistoryRole;
  content: string;
  createdAt: Date;
}

// Persists a single chat message (user or assistant) to the session history table.
export async function insertMessage(
  sessionId: string,
  role: HistoryRole,
  content: string,
): Promise<HistoryRow> {
  return withRetry(
    () => prisma.sessionHistory.create({ data: { sessionId, role, content } }),
    { label: "historyRepo.insertMessage" },
  );
}
