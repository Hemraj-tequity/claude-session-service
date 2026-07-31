import { describe, it, expect, vi, beforeEach } from 'vitest';

const { pinoMock } = vi.hoisted(() => ({
  pinoMock: vi.fn().mockReturnValue({ __fakeLogger: true }),
}));

vi.mock('pino', () => ({ default: pinoMock }));

describe('lib/logger', () => {
  beforeEach(() => {
    pinoMock.mockClear();
    vi.resetModules();
  });

  it('enables pino-pretty transport in development', async () => {
    vi.doMock('../../config/env.js', () => ({
      config: { logLevel: 'debug', nodeEnv: 'development' },
    }));

    await import('../logger.js');

    expect(pinoMock).toHaveBeenCalledWith({
      level: 'debug',
      transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } },
    });
  });

  it('disables the transport (structured JSON) in production', async () => {
    vi.doMock('../../config/env.js', () => ({
      config: { logLevel: 'info', nodeEnv: 'production' },
    }));

    await import('../logger.js');

    expect(pinoMock).toHaveBeenCalledWith({ level: 'info', transport: undefined });
  });
});
