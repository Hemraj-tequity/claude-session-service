import { describe, it, expect } from 'vitest';
import { InputBodySchema, UUID_PATTERN } from '../sessions.schema.js';

describe('InputBodySchema', () => {
  it('accepts a non-empty content string', () => {
    const result = InputBodySchema.safeParse({ content: 'hello' });
    expect(result.success).toBe(true);
    expect(result.success && result.data.content).toBe('hello');
  });

  it('rejects an empty string', () => {
    const result = InputBodySchema.safeParse({ content: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing content field', () => {
    const result = InputBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects a non-string content value', () => {
    const result = InputBodySchema.safeParse({ content: 42 });
    expect(result.success).toBe(false);
  });

  it('rejects null and undefined bodies', () => {
    expect(InputBodySchema.safeParse(null).success).toBe(false);
    expect(InputBodySchema.safeParse(undefined).success).toBe(false);
  });
});

describe('UUID_PATTERN', () => {
  const re = new RegExp(UUID_PATTERN);

  it('matches a well-formed v4-shaped UUID', () => {
    expect(re.test('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
  });

  it('matches uppercase hex digits', () => {
    expect(re.test('123E4567-E89B-12D3-A456-426614174000')).toBe(true);
  });

  it.each([
    'not-a-uuid',
    '123e4567-e89b-12d3-a456', // too short
    '123e4567-e89b-12d3-a456-426614174000-extra',
    '',
    '123e4567_e89b_12d3_a456_426614174000',
  ])('rejects malformed value %s', (value) => {
    expect(re.test(value)).toBe(false);
  });
});
