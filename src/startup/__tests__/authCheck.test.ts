import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { spawnSyncMock, existsSyncMock, homedirMock, loggerMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(),
  existsSyncMock: vi.fn(),
  homedirMock: vi.fn().mockReturnValue('/home/tester'),
  loggerMock: { fatal: vi.fn(), info: vi.fn() },
}));

vi.mock('node:child_process', () => ({ spawnSync: spawnSyncMock }));
vi.mock('node:fs', () => ({ existsSync: existsSyncMock }));
vi.mock('node:os', () => ({ homedir: homedirMock }));
vi.mock('../../lib/logger.js', () => ({ logger: loggerMock }));

const AUTH_ENV_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR'] as const;
const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_PLATFORM = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function clearAuthEnv(): void {
  for (const key of AUTH_ENV_KEYS) delete process.env[key];
}

describe('startup/authCheck', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
    existsSyncMock.mockReset();
    loggerMock.fatal.mockReset();
    loggerMock.info.mockReset();
    clearAuthEnv();
    existsSyncMock.mockReturnValue(false);
    setPlatform('linux');
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    setPlatform(ORIGINAL_PLATFORM);
    vi.resetModules();
  });

  describe('runStartupChecks', () => {
    it('logs the CLI version and auth method, then does not exit, when both checks pass', async () => {
      spawnSyncMock.mockReturnValue({ error: undefined, status: 0, stdout: '2.1.220\n' });
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('should not exit');
      });

      const { runStartupChecks } = await import('../authCheck.js');
      expect(() => runStartupChecks()).not.toThrow();

      expect(loggerMock.info).toHaveBeenCalledWith({ version: '2.1.220' }, 'Claude CLI found');
      expect(loggerMock.info).toHaveBeenCalledWith({ method: 'api_key' }, 'Claude authentication check passed');
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('exits with code 1 when the Claude CLI is not on PATH', async () => {
      spawnSyncMock.mockReturnValue({ error: new Error('ENOENT'), status: null });
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`exit(${code})`);
      }) as never);

      const { runStartupChecks } = await import('../authCheck.js');
      expect(() => runStartupChecks()).toThrow('exit(1)');
      expect(loggerMock.fatal).toHaveBeenCalledWith(expect.stringContaining('Claude CLI not found'));
    });

    it('exits with code 1 when the CLI is present but no credentials are found', async () => {
      spawnSyncMock.mockReturnValue({ error: undefined, status: 0, stdout: '2.1.220' });
      existsSyncMock.mockReturnValue(false);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`exit(${code})`);
      }) as never);

      const { runStartupChecks } = await import('../authCheck.js');
      expect(() => runStartupChecks()).toThrow('exit(1)');
      expect(loggerMock.fatal).toHaveBeenCalledWith(expect.stringContaining('No Claude credentials found'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('treats a non-zero CLI exit status as "not found"', async () => {
      spawnSyncMock.mockReturnValue({ error: undefined, status: 1, stdout: '' });
      vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`exit(${code})`);
      }) as never);

      const { runStartupChecks } = await import('../authCheck.js');
      expect(() => runStartupChecks()).toThrow('exit(1)');
      expect(loggerMock.fatal).toHaveBeenCalledWith(expect.stringContaining('Claude CLI not found'));
    });
  });

  describe('getCachedAuthStatus (auth method precedence)', () => {
    beforeEach(() => {
      spawnSyncMock.mockReturnValue({ error: undefined, status: 0 });
    });

    it('prefers ANTHROPIC_API_KEY first', async () => {
      process.env.ANTHROPIC_API_KEY = 'k';
      process.env.ANTHROPIC_AUTH_TOKEN = 't';
      const { getCachedAuthStatus } = await import('../authCheck.js');
      expect(getCachedAuthStatus()).toEqual({ ok: true, method: 'api_key' });
    });

    it('falls back to ANTHROPIC_AUTH_TOKEN', async () => {
      process.env.ANTHROPIC_AUTH_TOKEN = 't';
      const { getCachedAuthStatus } = await import('../authCheck.js');
      expect(getCachedAuthStatus()).toEqual({ ok: true, method: 'auth_token' });
    });

    it('falls back to CLAUDE_CODE_OAUTH_TOKEN', async () => {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'o';
      const { getCachedAuthStatus } = await import('../authCheck.js');
      expect(getCachedAuthStatus()).toEqual({ ok: true, method: 'oauth_token' });
    });

    it('falls back to the on-disk credentials file under CLAUDE_CONFIG_DIR', async () => {
      process.env.CLAUDE_CONFIG_DIR = '/custom/dir';
      existsSyncMock.mockImplementation((path: string) => path === '/custom/dir/.credentials.json');
      const { getCachedAuthStatus } = await import('../authCheck.js');
      expect(getCachedAuthStatus()).toEqual({ ok: true, method: 'oauth_credentials_file' });
    });

    it('defaults the credentials path to ~/.claude when CLAUDE_CONFIG_DIR is unset', async () => {
      existsSyncMock.mockImplementation((path: string) => path === '/home/tester/.claude/.credentials.json');
      const { getCachedAuthStatus } = await import('../authCheck.js');
      expect(getCachedAuthStatus()).toEqual({ ok: true, method: 'oauth_credentials_file' });
    });

    it('falls back to the macOS Keychain only on darwin', async () => {
      setPlatform('darwin');
      spawnSyncMock.mockReturnValue({ error: undefined, status: 0 });
      const { getCachedAuthStatus } = await import('../authCheck.js');
      expect(getCachedAuthStatus()).toEqual({ ok: true, method: 'macos_keychain' });
      expect(spawnSyncMock).toHaveBeenCalledWith(
        'security',
        ['find-generic-password', '-s', 'Claude Code-credentials'],
        { stdio: 'ignore' },
      );
    });

    it('does not attempt the Keychain check on non-darwin platforms', async () => {
      setPlatform('linux');
      const { getCachedAuthStatus } = await import('../authCheck.js');
      const result = getCachedAuthStatus();
      expect(result).toEqual({ ok: false });
      expect(spawnSyncMock).not.toHaveBeenCalledWith('security', expect.anything(), expect.anything());
    });

    it('reports ok:false when every method fails', async () => {
      setPlatform('darwin');
      spawnSyncMock.mockReturnValue({ error: new Error('not found'), status: 1 });
      const { getCachedAuthStatus } = await import('../authCheck.js');
      expect(getCachedAuthStatus()).toEqual({ ok: false });
    });

    it('caches the result across repeated calls (auth is only computed once)', async () => {
      process.env.ANTHROPIC_API_KEY = 'k';
      const { getCachedAuthStatus } = await import('../authCheck.js');

      const first = getCachedAuthStatus();
      process.env.ANTHROPIC_API_KEY = '';
      delete process.env.ANTHROPIC_API_KEY;
      const second = getCachedAuthStatus();

      expect(first).toEqual({ ok: true, method: 'api_key' });
      expect(second).toBe(first);
    });
  });
});
