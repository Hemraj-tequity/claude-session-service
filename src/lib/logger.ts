import pino from 'pino';
import { config } from '../config/env.js';
import { NODE_ENV_VALUES } from '../constants/index.js';

export const logger = pino({
  level: config.logLevel,
  transport:
    config.nodeEnv === NODE_ENV_VALUES.DEVELOPMENT
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } }
      : undefined,
});
