import "dotenv/config";
import { z } from "zod";
import {
  DEFAULT_PORT,
  ERROR_MESSAGES,
  LOG_LEVELS,
  NODE_ENV_VALUES,
} from "../constants/index.js";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, ERROR_MESSAGES.DATABASE_URL_REQUIRED),
  PORT: z.coerce.number().int().positive().default(DEFAULT_PORT),
  NODE_ENV: z
    .enum([NODE_ENV_VALUES.DEVELOPMENT, NODE_ENV_VALUES.PRODUCTION])
    .default(NODE_ENV_VALUES.DEVELOPMENT),
  ALLOWED_TOOLS: z.string().default(""),
  LOG_LEVEL: z
    .enum([
      LOG_LEVELS.FATAL,
      LOG_LEVELS.ERROR,
      LOG_LEVELS.WARN,
      LOG_LEVELS.INFO,
      LOG_LEVELS.DEBUG,
      LOG_LEVELS.TRACE,
    ])
    .default(LOG_LEVELS.INFO),
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
      ERROR_MESSAGES.INVALID_ENV_CONFIG_LOG,
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
  };
}

export const config = loadEnvironmentConfig();
