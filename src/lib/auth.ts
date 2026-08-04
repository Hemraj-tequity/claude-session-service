import type { FastifyRequest } from 'fastify';
import { UnauthorizedError } from './errors.js';
import { BEARER_PREFIX } from './constant.js';

declare module 'fastify' {
  interface FastifyRequest {
    claudeToken: string;
  }
}

export const extractClaudeToken = (headers: FastifyRequest['headers']): string => {
  const raw = headers.authorization;
  if (typeof raw !== 'string' || !raw.startsWith(BEARER_PREFIX)) {
    throw new UnauthorizedError('Missing or malformed Authorization header; expected "Bearer <claude-token>"');
  }

  const token = raw.slice(BEARER_PREFIX.length).trim();
  if (token.length === 0) {
    throw new UnauthorizedError('Authorization header did not contain a token');
  }

  return token;
}
