import { describe, it, expect, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, z } from 'zod';
import {
  AppError,
  ValidationError,
  UnauthorizedError,
  NotFoundError,
  ConflictError,
  PersistenceError,
  ClaudeSdkError,
  ClaudeAuthError,
  ChunkError,
  InternalServerError,
  buildErrorResponse,
  normalizeError,
  fastifyErrorHandler,
  fastifyNotFoundHandler,
} from '../errors.js';

describe('AppError subclasses', () => {
  it('ValidationError maps to 400 VALIDATION_ERROR', () => {
    const err = new ValidationError('bad request');
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
    expect(err.type).toBe('VALIDATION_ERROR');
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('bad request');
    expect(err.name).toBe('ValidationError');
  });

  it('UnauthorizedError maps to 401 UNAUTHORIZED', () => {
    const err = new UnauthorizedError('no token');
    expect(err.type).toBe('UNAUTHORIZED');
    expect(err.statusCode).toBe(401);
  });

  it('NotFoundError maps to 404 and defaults type to NOT_FOUND', () => {
    const err = new NotFoundError('missing');
    expect(err.type).toBe('NOT_FOUND');
    expect(err.statusCode).toBe(404);
  });

  it('NotFoundError accepts a specific type override', () => {
    const err = new NotFoundError('Session x not found', 'SESSION_NOT_FOUND');
    expect(err.type).toBe('SESSION_NOT_FOUND');
    expect(err.statusCode).toBe(404);
  });

  it('ConflictError maps to 409 and defaults type to CONFLICT', () => {
    const err = new ConflictError('busy');
    expect(err.type).toBe('CONFLICT');
    expect(err.statusCode).toBe(409);
  });

  it('ConflictError accepts a specific type override', () => {
    const err = new ConflictError('Session x is stopped', 'SESSION_STOPPED');
    expect(err.type).toBe('SESSION_STOPPED');
  });

  it('PersistenceError maps to 500 DATABASE_ERROR', () => {
    const err = new PersistenceError('write failed');
    expect(err.type).toBe('DATABASE_ERROR');
    expect(err.statusCode).toBe(500);
  });

  it('ClaudeSdkError defaults to 502 CLAUDE_SDK_ERROR', () => {
    const err = new ClaudeSdkError('sdk crashed');
    expect(err.type).toBe('CLAUDE_SDK_ERROR');
    expect(err.statusCode).toBe(502);
  });

  it('ClaudeSdkError accepts a type/statusCode override', () => {
    const err = new ClaudeSdkError('bad request to sdk', { type: 'CLAUDE_SDK_BAD_INPUT', statusCode: 400 });
    expect(err.type).toBe('CLAUDE_SDK_BAD_INPUT');
    expect(err.statusCode).toBe(400);
  });

  it('ClaudeAuthError is a ClaudeSdkError fixed to 401 CLAUDE_AUTH_ERROR', () => {
    const err = new ClaudeAuthError('auth failed');
    expect(err).toBeInstanceOf(ClaudeSdkError);
    expect(err.type).toBe('CLAUDE_AUTH_ERROR');
    expect(err.statusCode).toBe(401);
  });

  it('ChunkError maps to 500 CHUNK_ERROR', () => {
    const err = new ChunkError('stream broke');
    expect(err.type).toBe('CHUNK_ERROR');
    expect(err.statusCode).toBe(500);
  });

  it('InternalServerError maps to 500 INTERNAL_ERROR with a default message', () => {
    const err = new InternalServerError();
    expect(err.type).toBe('INTERNAL_ERROR');
    expect(err.statusCode).toBe(500);
    expect(err.message).toBe('An unexpected error occurred');
  });

  it('carries a cause and logDetails without exposing them on the instance message', () => {
    const cause = new Error('root cause');
    const err = new PersistenceError('write failed', { cause, logDetails: { table: 'session' } });
    expect(err.cause).toBe(cause);
    expect(err.logDetails).toEqual({ table: 'session' });
  });
});

describe('buildErrorResponse', () => {
  it('builds the standardized body: status false, type, message, ISO timestamp - no details', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const body = buildErrorResponse(new NotFoundError('not found', 'SESSION_NOT_FOUND'));

    expect(body).toEqual({
      error: {
        status: false,
        type: 'SESSION_NOT_FOUND',
        message: 'not found',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });

    vi.useRealTimers();
  });
});

describe('normalizeError', () => {
  it('passes an AppError through unchanged', () => {
    const original = new ValidationError('bad');
    expect(normalizeError(original)).toBe(original);
  });

  it('converts a ZodError into a ValidationError with "Malformed request body"', () => {
    const schema = z.object({ foo: z.string() });
    const zodError = schema.safeParse({}).error as ZodError;

    const result = normalizeError(zodError);

    expect(result).toBeInstanceOf(ValidationError);
    expect(result.type).toBe('VALIDATION_ERROR');
    expect(result.message).toBe('Malformed request body');
    expect(result.logDetails).toBeDefined();
  });

  it('converts a Fastify-style error with statusCode < 500 into a ValidationError', () => {
    const fastifyErr = Object.assign(new Error('schema mismatch'), { statusCode: 400 });

    const result = normalizeError(fastifyErr);

    expect(result).toBeInstanceOf(ValidationError);
    expect(result.type).toBe('VALIDATION_ERROR');
    expect(result.message).toBe('schema mismatch');
  });

  it('converts an unrecognized error into an InternalServerError without leaking its message', () => {
    const result = normalizeError(new Error('some internal detail'));

    expect(result).toBeInstanceOf(InternalServerError);
    expect(result.type).toBe('INTERNAL_ERROR');
    expect(result.message).toBe('An unexpected error occurred');
  });

  it('converts a non-Error thrown value into an InternalServerError', () => {
    const result = normalizeError('just a string');
    expect(result).toBeInstanceOf(InternalServerError);
  });
});

function fakeRequest(): FastifyRequest {
  return { log: { error: vi.fn() }, method: 'GET', url: '/nope' } as unknown as FastifyRequest;
}

function fakeReply() {
  const send = vi.fn();
  const code = vi.fn().mockReturnValue({ send });
  return { reply: { code } as unknown as FastifyReply, code, send };
}

describe('fastifyErrorHandler', () => {
  it('sends the normalized AppError status code and standardized body', () => {
    const { reply, code, send } = fakeReply();
    const request = fakeRequest();

    fastifyErrorHandler(new ClaudeAuthError('auth failed'), request, reply);

    expect(code).toHaveBeenCalledWith(401);
    expect(send).toHaveBeenCalledWith({
      error: {
        status: false,
        type: 'CLAUDE_AUTH_ERROR',
        message: 'auth failed',
        timestamp: expect.any(String) as string,
      },
    });
  });

  it('logs the full error via request.log.error, never sending internals to the client', () => {
    const { reply, code, send } = fakeReply();
    const request = fakeRequest();
    const raw = new Error('secret stack detail');

    fastifyErrorHandler(raw, request, reply);

    expect(request.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: raw, type: 'INTERNAL_ERROR', statusCode: 500 }),
      'request failed',
    );
    expect(code).toHaveBeenCalledWith(500);
    expect(send).toHaveBeenCalledWith({
      error: {
        status: false,
        type: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        timestamp: expect.any(String) as string,
      },
    });
  });
});

describe('fastifyNotFoundHandler', () => {
  it('sends a standardized ROUTE_NOT_FOUND body for unmatched routes', () => {
    const { reply, code, send } = fakeReply();
    const request = { method: 'GET', url: '/nope' } as unknown as FastifyRequest;

    fastifyNotFoundHandler(request, reply);

    expect(code).toHaveBeenCalledWith(404);
    expect(send).toHaveBeenCalledWith({
      error: {
        status: false,
        type: 'ROUTE_NOT_FOUND',
        message: 'Route GET /nope not found',
        timestamp: expect.any(String) as string,
      },
    });
  });
});
