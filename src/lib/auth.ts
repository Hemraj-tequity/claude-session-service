import type { FastifyRequest } from 'fastify';
import { UnauthorizedError } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    claudeToken: string;
  }
}

const BEARER_PREFIX = 'Bearer ';

// Extracts and validates the caller's Claude auth token from the Authorization header.
export function extractClaudeToken(headers: FastifyRequest['headers']): string {
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
