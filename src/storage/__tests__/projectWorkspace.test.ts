import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { listObjectKeysMock, downloadObjectMock, uploadObjectMock, configMock, loggerMock } =
  vi.hoisted(() => ({
    listObjectKeysMock: vi.fn(),
    downloadObjectMock: vi.fn(),
    uploadObjectMock: vi.fn(),
    configMock: { workspaceRoot: '' },
    loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));

vi.mock('../objectStorage.js', () => ({
  listObjectKeys: listObjectKeysMock,
  downloadObject: downloadObjectMock,
  uploadObject: uploadObjectMock,
}));
vi.mock('../../config/env.js', () => ({ config: configMock }));
vi.mock('../../lib/logger.js', () => ({ logger: loggerMock }));

import { workspacePathFor, prepareWorkspace, syncWorkspace, destroyWorkspace } from '../projectWorkspace.js';

describe('storage/projectWorkspace', () => {
  beforeEach(async () => {
    configMock.workspaceRoot = await mkdtemp(join(tmpdir(), 'claude-ws-test-'));
    listObjectKeysMock.mockReset();
    downloadObjectMock.mockReset();
    uploadObjectMock.mockReset();
    loggerMock.info.mockReset();
    loggerMock.warn.mockReset();
    loggerMock.error.mockReset();
  });

  afterEach(async () => {
    await rm(configMock.workspaceRoot, { recursive: true, force: true });
  });

  describe('workspacePathFor', () => {
    it('joins the configured root with the sessionId', () => {
      expect(workspacePathFor('s1')).toBe(join(configMock.workspaceRoot, 's1'));
    });
  });

  describe('prepareWorkspace', () => {
    it('creates the directory and returns it when Storage has nothing for this session', async () => {
      listObjectKeysMock.mockResolvedValue([]);

      const dir = await prepareWorkspace('s1');

      expect(dir).toBe(workspacePathFor('s1'));
      expect((await stat(dir)).isDirectory()).toBe(true);
      expect(downloadObjectMock).not.toHaveBeenCalled();
    });

    it('downloads every remote file into the local workspace, preserving nested folders', async () => {
      listObjectKeysMock.mockResolvedValue(['s1/README.md', 's1/src/index.ts']);
      downloadObjectMock.mockImplementation((key: string) => Promise.resolve(Buffer.from(`content of ${key}`)));

      const dir = await prepareWorkspace('s1');

      expect(await readFile(join(dir, 'README.md'), 'utf-8')).toBe('content of s1/README.md');
      expect(await readFile(join(dir, 'src', 'index.ts'), 'utf-8')).toBe('content of s1/src/index.ts');
    });

    it('falls back to an empty workspace when the download fails, without throwing', async () => {
      listObjectKeysMock.mockRejectedValue(new Error('network down'));

      const dir = await prepareWorkspace('s2');

      expect((await stat(dir)).isDirectory()).toBe(true);
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 's2' }),
        'Workspace download failed; starting with an empty workspace',
      );
    });

    it('falls back to an empty workspace when a remote key would escape the workspace directory', async () => {
      listObjectKeysMock.mockResolvedValue(['s1/../../etc/passwd']);

      const dir = await prepareWorkspace('s1');

      expect(loggerMock.error).toHaveBeenCalled();
      expect((await stat(dir)).isDirectory()).toBe(true);
    });
  });

  describe('syncWorkspace', () => {
    it('uploads every local file with keys prefixed by sessionId, preserving nested folders', async () => {
      const dir = workspacePathFor('s1');
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(join(dir, 'README.md'), 'hello');
      await writeFile(join(dir, 'src', 'index.ts'), 'code');
      uploadObjectMock.mockResolvedValue(undefined);

      await syncWorkspace('s1');

      expect(uploadObjectMock).toHaveBeenCalledWith('s1/README.md', Buffer.from('hello'));
      expect(uploadObjectMock).toHaveBeenCalledWith('s1/src/index.ts', Buffer.from('code'));
      expect(uploadObjectMock).toHaveBeenCalledTimes(2);
    });

    it('resolves without uploading when the workspace directory does not exist', async () => {
      await expect(syncWorkspace('never-created')).resolves.toBeUndefined();
      expect(uploadObjectMock).not.toHaveBeenCalled();
    });

    it('rethrows a non-ENOENT filesystem error instead of treating it as "nothing to sync"', async () => {
      // A plain file where a directory is expected -- readdir() rejects with
      // ENOTDIR, which must propagate rather than being mistaken for the
      // "workspace was never created" (ENOENT) case.
      const notADir = join(configMock.workspaceRoot, 'not-a-dir');
      await writeFile(notADir, 'i am a file, not a directory');

      await expect(syncWorkspace('not-a-dir')).rejects.toThrow();
    });

    it('attempts every file even if one upload fails, then throws an aggregate error', async () => {
      const dir = workspacePathFor('s1');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'a.txt'), 'a');
      await writeFile(join(dir, 'b.txt'), 'b');
      uploadObjectMock.mockImplementation((key: string) => {
        if (key === 's1/a.txt') return Promise.reject(new Error('upload failed'));
        return Promise.resolve();
      });

      await expect(syncWorkspace('s1')).rejects.toThrow('Failed to upload 1 of 2 file(s)');
      expect(uploadObjectMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('destroyWorkspace', () => {
    it('removes an existing workspace directory', async () => {
      const dir = workspacePathFor('s1');
      await mkdir(dir, { recursive: true });

      await destroyWorkspace('s1');

      await expect(stat(dir)).rejects.toThrow();
    });

    it('is a no-op when the directory does not exist', async () => {
      await expect(destroyWorkspace('never-created')).resolves.toBeUndefined();
    });
  });
});
