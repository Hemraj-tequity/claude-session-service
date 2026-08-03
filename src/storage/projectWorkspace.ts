import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { config } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { assertSafeRelativePath, safeJoin } from "./pathSafety.js";
import { downloadObject, listObjectKeys, uploadObject } from "./objectStorage.js";

// Bridges a session's local scratch directory (what Claude reads/writes)
// and its durable copy in Supabase Storage. Only module SessionManager calls into.

export function workspacePathFor(sessionId: string): string {
  return join(config.workspaceRoot, sessionId);
}

function keyFor(sessionId: string, relPath: string): string {
  return `${sessionId}/${relPath}`;
}

async function walk(dir: string, base: string = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const relPaths: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      relPaths.push(...(await walk(fullPath, base)));
    } else if (entry.isFile()) {
      relPaths.push(relative(base, fullPath));
    }
  }
  return relPaths;
}

// Creates sessionId's local workspace dir and, on first use, downloads any
// files already in Storage into it. Never throws - a download failure just
// leaves an empty dir, since a session must always be able to start.
export async function prepareWorkspace(sessionId: string): Promise<string> {
  const dir = workspacePathFor(sessionId);
  await mkdir(dir, { recursive: true });

  try {
    const keys = await listObjectKeys(sessionId);
    for (const key of keys) {
      const relPath = assertSafeRelativePath(key.slice(sessionId.length + 1));
      const localPath = safeJoin(dir, relPath);
      await mkdir(dirname(localPath), { recursive: true });
      await writeFile(localPath, await downloadObject(key));
    }
  } catch (err) {
    logger.error({ err, sessionId }, "Workspace download failed; starting with an empty workspace");
  }

  return dir;
}

// Uploads every local file back to Storage (upsert). Every file is attempted
// even if an earlier one fails; throws only after the full pass.
export async function syncWorkspace(sessionId: string): Promise<void> {
  const dir = workspacePathFor(sessionId);

  let relPaths: string[];
  try {
    relPaths = await walk(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }

  const failures: string[] = [];
  for (const relPath of relPaths) {
    try {
      const safeRelPath = assertSafeRelativePath(relPath);
      const data = await readFile(safeJoin(dir, safeRelPath));
      await uploadObject(keyFor(sessionId, safeRelPath), data);
    } catch (err) {
      logger.error({ err, sessionId, relPath }, "Failed to upload file");
      failures.push(relPath);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Failed to upload ${failures.length} of ${relPaths.length} file(s) for session ${sessionId}: ${failures.join(", ")}`,
    );
  }
}

export async function destroyWorkspace(sessionId: string): Promise<void> {
  await rm(workspacePathFor(sessionId), { recursive: true, force: true });
}
