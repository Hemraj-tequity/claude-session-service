import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ALLOWED_TOOLS: z.string().default(''),
  DISALLOWED_TOOLS: z.string().default(''),
  SYSTEM_PROMPT: z.string().default(''),
  SESSION_IDLE_EVICT_MS: z.coerce.number().int().positive().default(600_000),
  SSE_HEARTBEAT_MS: z.coerce.number().int().positive().default(15_000),
  // Optional per-turn cost cap forwarded to the Agent SDK (maxBudgetUsd) -- a
  // safety net against a runaway session in a headless, multi-tenant context.
  // Unset by default (no cap) since this is an operator opt-in, not a spec requirement.
  SESSION_MAX_BUDGET_USD: z.preprocess(
    (val) => (val === '' || val === undefined ? undefined : val),
    z.coerce.number().positive().optional(),
  ),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGIN: z.string().default(''),
});

function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function loadConfig() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Startup-time misconfiguration: fail loudly before the server does anything else.
    console.error('Invalid environment configuration:', z.treeifyError(parsed.error));
    process.exit(1);
  }

  const env = parsed.data;
  return {
    databaseUrl: env.DATABASE_URL,
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    allowedTools: parseCsv(env.ALLOWED_TOOLS),
    disallowedTools: parseCsv(env.DISALLOWED_TOOLS),
    systemPrompt: env.SYSTEM_PROMPT.length > 0 ? env.SYSTEM_PROMPT : undefined,
    sessionIdleEvictMs: env.SESSION_IDLE_EVICT_MS,
    sseHeartbeatMs: env.SSE_HEARTBEAT_MS,
    sessionMaxBudgetUsd: env.SESSION_MAX_BUDGET_USD,
    logLevel: env.LOG_LEVEL,
    corsOrigin: env.CORS_ORIGIN.length > 0 ? env.CORS_ORIGIN : undefined,
  };
}

export const config = loadConfig();
export type Config = typeof config;
