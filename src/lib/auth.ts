import type { FastifyRequest } from 'fastify';
import { UnauthorizedError } from './errors.js';
import { BEARER_PREFIX, ERROR_MESSAGES } from '../constants/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    claudeToken: string;
  }
}

export const extractClaudeToken = (headers: FastifyRequest['headers']): string => {
  const raw = headers.authorization;
  if (typeof raw !== 'string' || !raw.startsWith(BEARER_PREFIX)) {
    throw new UnauthorizedError(ERROR_MESSAGES.MISSING_OR_MALFORMED_AUTH_HEADER);
  }

  const token = raw.slice(BEARER_PREFIX.length).trim();
  if (token.length === 0) {
    throw new UnauthorizedError(ERROR_MESSAGES.AUTH_HEADER_NO_TOKEN);
  }

  return token;
}
