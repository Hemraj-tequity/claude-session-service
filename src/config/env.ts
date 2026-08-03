import "dotenv/config";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const DEFAULT_WORKSPACE_ROOT = join(tmpdir(), "claude-workspaces");

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  ALLOWED_TOOLS: z.string().default(""),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  // Supabase Storage persists each session's generated project files, since
  // the service's own filesystem is ephemeral and wiped on every deploy/restart.
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default("projects"),
  // Local scratch directory Claude actually runs in; synced to/from Supabase
  // Storage around each session's lifetime. Defaults to the OS temp dir.
  WORKSPACE_ROOT: z.string().min(1).default(DEFAULT_WORKSPACE_ROOT),
});

// Splits a comma-separated env value into trimmed, non-empty entries.
function parseCommaSeparatedList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Validates process.env against the schema and builds the app's typed config object.
function loadEnvironmentConfig() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      "Invalid environment configuration:",
      z.treeifyError(parsed.error),
    );
    process.exit(1);
  }

  const env = parsed.data;
  return {
    databaseUrl: env.DATABASE_URL,
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    allowedTools: parseCommaSeparatedList(env.ALLOWED_TOOLS),
    logLevel: env.LOG_LEVEL,
    supabaseUrl: env.SUPABASE_URL,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseStorageBucket: env.SUPABASE_STORAGE_BUCKET,
    workspaceRoot: env.WORKSPACE_ROOT,
  };
}

export const config = loadEnvironmentConfig();
