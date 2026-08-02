import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  ALLOWED_TOOLS: z.string().default(""),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function loadConfig() {
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
    allowedTools: parseCsv(env.ALLOWED_TOOLS),
    logLevel: env.LOG_LEVEL,
  };
}

export const config = loadConfig();
