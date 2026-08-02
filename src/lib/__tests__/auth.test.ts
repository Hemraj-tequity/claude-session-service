import { describe, it, expect } from 'vitest';
import { extractClaudeToken } from '../auth.js';
import { UnauthorizedError } from '../errors.js';

function catchError(fn: () => unknown): UnauthorizedError {
  try {
    fn();
  } catch (err) {
    return err as UnauthorizedError;
  }
  throw new Error('expected fn to throw');
}

describe('extractClaudeToken', () => {
  it('extracts the token from a well-formed Bearer header', () => {
    expect(extractClaudeToken({ authorization: 'Bearer sk-ant-abc123' })).toBe('sk-ant-abc123');
  });

  it('trims surrounding whitespace from the token', () => {
    expect(extractClaudeToken({ authorization: 'Bearer   sk-ant-abc123  ' })).toBe('sk-ant-abc123');
  });

  it('throws UNAUTHORIZED when the header is missing', () => {
    const err = catchError(() => extractClaudeToken({}));
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.type).toBe('UNAUTHORIZED');
    expect(err.statusCode).toBe(401);
  });

  it('throws UNAUTHORIZED when the header lacks the Bearer prefix', () => {
    const err = catchError(() => extractClaudeToken({ authorization: 'sk-ant-abc123' }));
    expect(err.type).toBe('UNAUTHORIZED');
  });

  it('throws UNAUTHORIZED when the Bearer value is empty', () => {
    const err = catchError(() => extractClaudeToken({ authorization: 'Bearer ' }));
    expect(err.type).toBe('UNAUTHORIZED');
  });

  it('throws UNAUTHORIZED when the Bearer value is only whitespace', () => {
    const err = catchError(() => extractClaudeToken({ authorization: 'Bearer    ' }));
    expect(err.type).toBe('UNAUTHORIZED');
  });
});
