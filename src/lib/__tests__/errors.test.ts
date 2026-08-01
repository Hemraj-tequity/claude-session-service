import { describe, it, expect, vi } from 'vitest';
import type { FastifyReply } from 'fastify';
import { AppError, errorBody, sendError, type ErrorCode } from '../errors.js';

describe('AppError', () => {
  it.each<[ErrorCode, number]>([
    ['INVALID_INPUT', 400],
    ['SESSION_NOT_FOUND', 404],
    ['SESSION_STOPPED', 409],
    ['CLAUDE_AUTH_ERROR', 401],
    ['STREAM_ERROR', 500],
    ['PERSIST_FAILED', 500],
    ['INTERNAL_ERROR', 500],
  ])('maps %s to status %d', (code, status) => {
    const err = new AppError(code, 'boom');
    expect(err.statusCode).toBe(status);
    expect(err.code).toBe(code);
  });

  it('sets name, message, and is an instance of Error', () => {
    const err = new AppError('INVALID_INPUT', 'bad request');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AppError');
    expect(err.message).toBe('bad request');
  });

  it('defaults details to undefined when omitted', () => {
    const err = new AppError('INVALID_INPUT', 'bad request');
    expect(err.details).toBeUndefined();
  });

  it('carries arbitrary details when provided', () => {
    const details = { field: 'content' };
    const err = new AppError('INVALID_INPUT', 'bad request', details);
    expect(err.details).toBe(details);
  });
});

describe('errorBody', () => {
  it('builds a body with code, message, details and an ISO timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const body = errorBody('SESSION_NOT_FOUND', 'not found', { id: '1' });

    expect(body).toEqual({
      error: {
        code: 'SESSION_NOT_FOUND',
        message: 'not found',
        details: { id: '1' },
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });

    vi.useRealTimers();
  });

  it('omits details as undefined when not passed', () => {
    const body = errorBody('INTERNAL_ERROR', 'oops');
    expect(body.error.details).toBeUndefined();
  });
});

describe('sendError', () => {
  it('sends the AppError status code and JSON body via the reply', () => {
    const send = vi.fn();
    const code = vi.fn().mockReturnValue({ send });
    const reply = { code } as unknown as FastifyReply;

    const err = new AppError('CLAUDE_AUTH_ERROR', 'auth failed', { hint: 'login' });
    sendError(reply, err);

    expect(code).toHaveBeenCalledWith(401);
    expect(send).toHaveBeenCalledWith({
      error: {
        code: 'CLAUDE_AUTH_ERROR',
        message: 'auth failed',
        details: { hint: 'login' },
        timestamp: expect.any(String) as string,
      },
    });
  });
});
