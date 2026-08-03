import { isAbsolute, normalize, resolve, sep } from "node:path";

// Rejects anything that isn't a plain, relative, within-tree path.
export function assertSafeRelativePath(relPath: string): string {
  if (!relPath || relPath.trim().length === 0) {
    throw new Error("Path must not be empty");
  }
  if (isAbsolute(relPath)) {
    throw new Error(`Path must be relative, got absolute path: ${relPath}`);
  }
  const normalized = normalize(relPath);
  if (
    normalized === ".." ||
    normalized.startsWith(`..${sep}`) ||
    normalized.includes(`${sep}..${sep}`)
  ) {
    throw new Error(`Path escapes its base directory: ${relPath}`);
  }
  return normalized;
}

export function isPathWithinDirectory(candidatePath: string, baseDir: string): boolean {
  const resolvedBase = resolve(baseDir);
  const resolvedTarget = resolve(candidatePath);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + sep);
}

// Joins relPath onto baseDir and verifies the result is still inside baseDir.
export function safeJoin(baseDir: string, relPath: string): string {
  const safeRel = assertSafeRelativePath(relPath);
  const resolvedTarget = resolve(baseDir, safeRel);
  if (!isPathWithinDirectory(resolvedTarget, baseDir)) {
    throw new Error(`Path escapes its base directory: ${relPath}`);
  }
  return resolvedTarget;
}
