import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('dotenv/config', () => ({}));

const ENV_KEYS = ['DATABASE_URL', 'PORT', 'NODE_ENV', 'ALLOWED_TOOLS', 'LOG_LEVEL'] as const;

const ORIGINAL_ENV = { ...process.env };

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
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

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
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      PORT: '4000',
      NODE_ENV: 'production',
      ALLOWED_TOOLS: 'Read, Grep ,, Glob',
      LOG_LEVEL: 'debug',
    });

    expect(config).toEqual({
      databaseUrl: 'postgresql://user:pass@localhost:5432/db',
      port: 4000,
      nodeEnv: 'production',
      allowedTools: ['Read', 'Grep', 'Glob'],
      logLevel: 'debug',
    });
  });

  it('applies defaults for PORT, NODE_ENV, ALLOWED_TOOLS and LOG_LEVEL', async () => {
    const { config } = await loadConfigWith({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    });

    expect(config.port).toBe(3000);
    expect(config.nodeEnv).toBe('development');
    expect(config.allowedTools).toEqual([]);
    expect(config.logLevel).toBe('info');
  });

  it('parses an empty ALLOWED_TOOLS string to an empty array', async () => {
    const { config } = await loadConfigWith({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      ALLOWED_TOOLS: '',
    });
    expect(config.allowedTools).toEqual([]);
  });

  it('exits with code 1 and logs when DATABASE_URL is missing', async () => {
    await expect(loadConfigWith({})).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith('Invalid environment configuration:', expect.anything());
  });

  it('exits with code 1 when PORT is not a positive integer', async () => {
    await expect(
      loadConfigWith({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        PORT: 'not-a-number',
      }),
    ).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when NODE_ENV is not a recognized value', async () => {
    await expect(
      loadConfigWith({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        NODE_ENV: 'staging',
      }),
    ).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when LOG_LEVEL is not a recognized value', async () => {
    await expect(
      loadConfigWith({
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
        LOG_LEVEL: 'verbose',
      }),
    ).rejects.toThrow('process.exit(1)');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
