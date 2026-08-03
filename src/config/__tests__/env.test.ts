import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

vi.mock('dotenv/config', () => ({}));

const ENV_KEYS = [
  'DATABASE_URL',
  'PORT',
  'NODE_ENV',
  'ALLOWED_TOOLS',
  'LOG_LEVEL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_STORAGE_BUCKET',
  'WORKSPACE_ROOT',
] as const;

const ORIGINAL_ENV = { ...process.env };

const REQUIRED_ENV = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

function resetEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

async function loadConfigWith(env: Record<string, string | undefined>) {
  resetEnv();
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) process.env[key] = value;
  }
  vi.resetModules();
  return import('../env.js');
}

describe('config/env', () => {
  let exitSpy: MockInstance<(code?: number) => never>;
  let errorSpy: MockInstance<(...args: unknown[]) => void>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('parses a fully specified, valid environment', async () => {
    const { config } = await loadConfigWith({
      ...REQUIRED_ENV,
      PORT: '4000',
      NODE_ENV: 'production',
      ALLOWED_TOOLS: 'Read, Grep ,, Glob',
      LOG_LEVEL: 'debug',
      SUPABASE_STORAGE_BUCKET: 'my-bucket',
      WORKSPACE_ROOT: '/data/workspaces',
    });

    expect(config).toEqual({
      databaseUrl: 'postgresql://user:pass@localhost:5432/db',
      port: 4000,
      nodeEnv: 'production',
      allowedTools: ['Read', 'Grep', 'Glob'],
      logLevel: 'debug',
      supabaseUrl: 'https://example.supabase.co',
      supabaseServiceRoleKey: 'service-role-key',
      supabaseStorageBucket: 'my-bucket',
      workspaceRoot: '/data/workspaces',
    });
  });

  it('applies defaults for PORT, NODE_ENV, ALLOWED_TOOLS and LOG_LEVEL', async () => {
    const { config } = await loadConfigWith(REQUIRED_ENV);

    expect(config.port).toBe(3000);
    expect(config.nodeEnv).toBe('development');
    expect(config.allowedTools).toEqual([]);
    expect(config.logLevel).toBe('info');
  });

  it('parses an empty ALLOWED_TOOLS string to an empty array', async () => {
    const { config } = await loadConfigWith({ ...REQUIRED_ENV, ALLOWED_TOOLS: '' });
    expect(config.allowedTools).toEqual([]);
  });

  it('defaults SUPABASE_STORAGE_BUCKET to "projects"', async () => {
    const { config } = await loadConfigWith(REQUIRED_ENV);
    expect(config.supabaseStorageBucket).toBe('projects');
  });

  it('defaults WORKSPACE_ROOT to a path under the OS temp dir', async () => {
    const { config } = await loadConfigWith(REQUIRED_ENV);
    expect(config.workspaceRoot).toMatch(/claude-workspaces$/);
  });

  it('exits with code 1 and logs when DATABASE_URL is missing', async () => {
    await expect(loadConfigWith({ SUPABASE_URL: REQUIRED_ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: REQUIRED_ENV.SUPABASE_SERVICE_ROLE_KEY })).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith('Invalid environment configuration:', expect.anything());
  });

  it('exits with code 1 when PORT is not a positive integer', async () => {
    await expect(
      loadConfigWith({ ...REQUIRED_ENV, PORT: 'not-a-number' }),
    ).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when NODE_ENV is not a recognized value', async () => {
    await expect(
      loadConfigWith({ ...REQUIRED_ENV, NODE_ENV: 'staging' }),
    ).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when LOG_LEVEL is not a recognized value', async () => {
    await expect(
      loadConfigWith({ ...REQUIRED_ENV, LOG_LEVEL: 'verbose' }),
    ).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when SUPABASE_URL is missing', async () => {
    await expect(
      loadConfigWith({
        DATABASE_URL: REQUIRED_ENV.DATABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: REQUIRED_ENV.SUPABASE_SERVICE_ROLE_KEY,
      }),
    ).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when SUPABASE_URL is not a valid URL', async () => {
    await expect(
      loadConfigWith({ ...REQUIRED_ENV, SUPABASE_URL: 'not-a-url' }),
    ).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when SUPABASE_SERVICE_ROLE_KEY is missing', async () => {
    await expect(
      loadConfigWith({
        DATABASE_URL: REQUIRED_ENV.DATABASE_URL,
        SUPABASE_URL: REQUIRED_ENV.SUPABASE_URL,
      }),
    ).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
