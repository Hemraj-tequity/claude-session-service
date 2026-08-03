import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { assertSafeRelativePath, isPathWithinDirectory, safeJoin } from '../pathSafety.js';

describe('storage/pathSafety', () => {
  describe('assertSafeRelativePath', () => {
    it('accepts a simple nested relative path', () => {
      expect(assertSafeRelativePath('src/index.ts')).toBe(join('src', 'index.ts'));
    });

    it('rejects an empty path', () => {
      expect(() => assertSafeRelativePath('')).toThrow('must not be empty');
    });

    it('rejects a whitespace-only path', () => {
      expect(() => assertSafeRelativePath('   ')).toThrow('must not be empty');
    });

    it('rejects an absolute path', () => {
      expect(() => assertSafeRelativePath('/etc/passwd')).toThrow('must be relative');
    });

    it('rejects a bare ".." segment', () => {
      expect(() => assertSafeRelativePath('..')).toThrow('escapes its base directory');
    });

    it('rejects a leading "../" traversal', () => {
      expect(() => assertSafeRelativePath('../secret.txt')).toThrow('escapes its base directory');
    });

    it('rejects an embedded "/../" traversal', () => {
      expect(() => assertSafeRelativePath('a/../../secret.txt')).toThrow('escapes its base directory');
    });
  });

  describe('safeJoin', () => {
    it('joins a valid relative path onto the base dir', () => {
      expect(safeJoin('/base/dir', 'sub/file.txt')).toBe(join('/base/dir', 'sub', 'file.txt'));
    });

    it('rejects a path that would escape the base dir', () => {
      expect(() => safeJoin('/base/dir', '../outside.txt')).toThrow('escapes its base directory');
    });
  });

  describe('isPathWithinDirectory', () => {
    it('is true for the base directory itself', () => {
      expect(isPathWithinDirectory('/base/dir', '/base/dir')).toBe(true);
    });

    it('is true for a nested path under the base directory', () => {
      expect(isPathWithinDirectory('/base/dir/sub/file.txt', '/base/dir')).toBe(true);
    });

    it('is false for a sibling directory with a matching prefix', () => {
      expect(isPathWithinDirectory('/base/dir-other/file.txt', '/base/dir')).toBe(false);
    });

    it('is false for a path entirely outside the base directory', () => {
      expect(isPathWithinDirectory('/etc/passwd', '/base/dir')).toBe(false);
    });
  });
});
