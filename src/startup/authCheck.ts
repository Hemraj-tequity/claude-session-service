import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../lib/logger.js';

export type ClaudeAuthMethod =
  | 'api_key'
  | 'auth_token'
  | 'oauth_token'
  | 'oauth_credentials_file'
  | 'macos_keychain';

export interface AuthCheckResult {
  ok: boolean;
  method?: ClaudeAuthMethod;
}

function checkClaudeCliOnPath(): { ok: boolean; version?: string } {
  const result = spawnSync('claude', ['--version'], { stdio: 'pipe', encoding: 'utf-8' });
  if (result.error || result.status !== 0) {
    return { ok: false };
  }
  return { ok: true, version: result.stdout.trim() };
}

/**
 * Existence-only check (no `-w`, never reads/logs the secret value) against the
 * macOS Keychain entry `claude login` writes on developer machines. This is a
 * dev-convenience fallback -- the EC2 deployment target is Linux, where
 * credentials always land in `.credentials.json` and this branch never runs.
 * Deliberately NOT a live API probe: a trial `claude -p` call was measured to
 * cost real money (~$0.22 for a one-word reply, due to full system-prompt/tool
 * context cache-creation) before any budget cap could stop it -- unacceptable
 * for something that might run on every process restart or health check.
 */
function checkMacKeychain(): boolean {
  if (process.platform !== 'darwin') return false;
  const result = spawnSync(
    'security',
    ['find-generic-password', '-s', 'Claude Code-credentials'],
    { stdio: 'ignore' },
  );
  return !result.error && result.status === 0;
}

function checkClaudeAuth(): AuthCheckResult {
  if (process.env.ANTHROPIC_API_KEY) return { ok: true, method: 'api_key' };
  if (process.env.ANTHROPIC_AUTH_TOKEN) return { ok: true, method: 'auth_token' };
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return { ok: true, method: 'oauth_token' };

  const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  const credentialsPath = join(configDir, '.credentials.json');
  if (existsSync(credentialsPath)) return { ok: true, method: 'oauth_credentials_file' };

  if (checkMacKeychain()) return { ok: true, method: 'macos_keychain' };

  return { ok: false };
}

/**
 * Runs once at process startup. Fails fast with an actionable message rather
 * than letting the server accept traffic it can't actually service -- there
 * is no interactive terminal here to prompt for `claude login`.
 */
export function runStartupChecks(): void {
  const cli = checkClaudeCliOnPath();
  if (!cli.ok) {
    logger.fatal(
      'Claude CLI not found on PATH. Install it with: npm install -g @anthropic-ai/claude-code',
    );
    process.exit(1);
  }
  logger.info({ version: cli.version }, 'Claude CLI found');

  const auth = checkClaudeAuth();
  if (!auth.ok) {
    logger.fatal(
      'No Claude credentials found. Set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN / ' +
        'CLAUDE_CODE_OAUTH_TOKEN), or run `claude login` once on this host. ' +
        'Credentials are per-host and cannot be shared across instances.',
    );
    process.exit(1);
  }
  logger.info({ method: auth.method }, 'Claude authentication check passed');
}

let cachedAuthResult: AuthCheckResult | null = null;

/** Cheap re-check for /health -- reuses env/file checks, never re-shells to the CLI. */
export function getCachedAuthStatus(): AuthCheckResult {
  if (!cachedAuthResult) {
    cachedAuthResult = checkClaudeAuth();
  }
  return cachedAuthResult;
}
