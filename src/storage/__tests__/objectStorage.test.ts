import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fromMock, uploadMock, downloadMock, listMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  uploadMock: vi.fn(),
  downloadMock: vi.fn(),
  listMock: vi.fn(),
}));

vi.mock('../../lib/supabaseClient.js', () => ({
  storage: { from: fromMock },
}));
vi.mock('../../config/env.js', () => ({ config: { supabaseStorageBucket: 'projects' } }));
vi.mock('../../lib/retry.js', () => ({ withRetry: (fn: () => unknown) => fn() }));

import { uploadObject, downloadObject, listObjectKeys } from '../objectStorage.js';

describe('storage/objectStorage', () => {
  beforeEach(() => {
    fromMock.mockReset().mockReturnValue({
      upload: uploadMock,
      download: downloadMock,
      list: listMock,
    });
    uploadMock.mockReset();
    downloadMock.mockReset();
    listMock.mockReset();
  });

  describe('uploadObject', () => {
    it('uploads with upsert against the configured bucket', async () => {
      uploadMock.mockResolvedValue({ error: null });
      await uploadObject('s1/file.txt', Buffer.from('hi'));

      expect(fromMock).toHaveBeenCalledWith('projects');
      expect(uploadMock).toHaveBeenCalledWith('s1/file.txt', Buffer.from('hi'), { upsert: true });
    });

    it('throws when the SDK reports an error', async () => {
      uploadMock.mockResolvedValue({ error: new Error('nope') });
      await expect(uploadObject('s1/file.txt', Buffer.from('hi'))).rejects.toThrow('nope');
    });
  });

  describe('downloadObject', () => {
    it('returns a Buffer built from the downloaded blob', async () => {
      const bytes = new Uint8Array([104, 101, 108, 108, 111]);
      const blob = { arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer) };
      downloadMock.mockResolvedValue({ data: blob, error: null });

      const result = await downloadObject('s1/file.txt');

      expect(downloadMock).toHaveBeenCalledWith('s1/file.txt');
      expect(result).toEqual(Buffer.from(bytes));
    });

    it('throws when the SDK reports an error', async () => {
      downloadMock.mockResolvedValue({ data: null, error: new Error('missing') });
      await expect(downloadObject('s1/file.txt')).rejects.toThrow('missing');
    });
  });

  describe('listObjectKeys', () => {
    it('returns file keys directly under the prefix', async () => {
      listMock.mockResolvedValueOnce({
        data: [
          { name: 'a.txt', id: 'id-1' },
          { name: 'b.txt', id: 'id-2' },
        ],
        error: null,
      });

      const keys = await listObjectKeys('s1');

      expect(keys).toEqual(['s1/a.txt', 's1/b.txt']);
      expect(listMock).toHaveBeenCalledWith('s1', { limit: 100, offset: 0 });
    });

    it('recurses into folder entries (id: null)', async () => {
      listMock
        .mockResolvedValueOnce({ data: [{ name: 'sub', id: null }], error: null })
        .mockResolvedValueOnce({ data: [{ name: 'c.txt', id: 'id-3' }], error: null });

      const keys = await listObjectKeys('s1');

      expect(keys).toEqual(['s1/sub/c.txt']);
      expect(listMock).toHaveBeenNthCalledWith(2, 's1/sub', { limit: 100, offset: 0 });
    });

    it('skips the empty-folder placeholder object', async () => {
      listMock.mockResolvedValueOnce({
        data: [{ name: '.emptyFolderPlaceholder', id: 'id-1' }],
        error: null,
      });

      const keys = await listObjectKeys('s1');

      expect(keys).toEqual([]);
    });

    it('pages through results larger than one page', async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => ({ name: `f${i}.txt`, id: `id-${i}` }));
      listMock
        .mockResolvedValueOnce({ data: page1, error: null })
        .mockResolvedValueOnce({ data: [{ name: 'last.txt', id: 'id-last' }], error: null });

      const keys = await listObjectKeys('s1');

      expect(keys).toHaveLength(101);
      expect(listMock).toHaveBeenNthCalledWith(2, 's1', { limit: 100, offset: 100 });
    });

    it('throws when the SDK reports an error', async () => {
      listMock.mockResolvedValue({ data: null, error: new Error('boom') });
      await expect(listObjectKeys('s1')).rejects.toThrow('boom');
    });

    it('keys entries by name alone when listing from the bucket root (empty prefix)', async () => {
      listMock.mockResolvedValueOnce({ data: [{ name: 'top.txt', id: 'id-1' }], error: null });

      const keys = await listObjectKeys('');

      expect(keys).toEqual(['top.txt']);
    });
  });
});
