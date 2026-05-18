/**
 * Assembly cleanup ENOENT narrow tests (phase 1032)
 *
 * Reverse cases: verify cleanupOrphanedTemp only swallows ENOENT
 * and throws non-ENOENT errors so caller .catch + audit (assemble.ts:478-480)
 * can truly emit CLEANUP_TEMP_FILES_FAILED.
 */

import { describe, it, expect, vi } from 'vitest';
import * as path from 'node:path';
import { createTempDir, cleanupTempDir } from '../utils/temp.js';

// ESM: mock fs/promises before importing the module under test
const mockReaddir = vi.fn();
const mockUnlink = vi.fn();
const mockWriteFile = vi.fn();
const mockReadFile = vi.fn();

vi.mock('node:fs/promises', () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

// Import after mock setup
const { cleanupOrphanedTemp } = await import('../../src/assembly/cleanup.js');

describe('cleanupOrphanedTemp ENOENT narrow', () => {
  it('readdir ENOENT → resolves [] (first-run dir absent acceptable)', async () => {
    mockReaddir.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    await expect(cleanupOrphanedTemp('/nonexistent')).resolves.toEqual([]);
  });

  it('readdir EACCES → throws (caller .catch can audit)', async () => {
    mockReaddir.mockRejectedValueOnce(Object.assign(new Error('access denied'), { code: 'EACCES' }));
    await expect(cleanupOrphanedTemp('/protected')).rejects.toThrow();
  });

  it('unlink ENOENT → continues (concurrent race acceptable)', async () => {
    mockReaddir.mockResolvedValueOnce([
      { name: '.tmp_file1', isFile: () => true, isDirectory: () => false },
      { name: '.tmp_file2', isFile: () => true, isDirectory: () => false },
    ] as unknown[]);

    let callCount = 0;
    mockUnlink.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      }
      return undefined;
    });

    const cleaned = await cleanupOrphanedTemp('/somedir');
    expect(cleaned).toHaveLength(1);
    expect(mockUnlink).toHaveBeenCalledTimes(2);
  });

  it('unlink EIO → throws (caller .catch can audit)', async () => {
    mockReaddir.mockResolvedValueOnce([
      { name: '.tmp_file1', isFile: () => true, isDirectory: () => false },
    ] as unknown[]);

    mockUnlink.mockRejectedValueOnce(Object.assign(new Error('i/o error'), { code: 'EIO' }));

    await expect(cleanupOrphanedTemp('/somedir')).rejects.toThrow();
  });
});
