/**
 * FileSystem tests
 * 
 * Tests:
 * - writeAtomic: concurrent writes, crash recovery
 * - DirectoryQueue: enqueue, dequeue, concurrency, recovery
 * - permissions: read/write restrictions
 * - watcher: file change events
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { promises as fs, promises as nativeFs } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

import {
  NodeFileSystem,
  DirectoryQueue,
  writeAtomic,
  cleanupOrphanedTemp,
} from '../../src/foundation/fs/index.js';
import {
  PermissionError,
  PathNotInClawSpaceError,
  WriteOperationForbiddenError,
  FileNotFoundError,
} from '../../src/types/errors.js';

/**
 * Create a temporary directory for tests
 */
async function createTempDir(): Promise<string> {
  const tempDir = path.join(tmpdir(), `clawforum-test-${randomUUID()}`);
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

/**
 * Clean up temporary directory
 */
async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe('FileSystem', () => {
  describe('writeAtomic', () => {
    let tempDir: string;
    
    beforeEach(async () => {
      tempDir = await createTempDir();
    });
    
    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });
    
    it('should write file atomically', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      const content = 'Hello, World!';
      
      await writeAtomic(filePath, content);
      
      const readContent = await fs.readFile(filePath, 'utf-8');
      expect(readContent).toBe(content);
    });
    
    it('should handle 100 concurrent writes to same file', async () => {
      const filePath = path.join(tempDir, 'concurrent.txt');
      
      // 100 concurrent writes
      const writes = Array.from({ length: 100 }, (_, i) => 
        writeAtomic(filePath, `content-${i}`)
      );
      
      await Promise.all(writes);
      
      // File should exist and contain valid content (one of the writes)
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toMatch(/^content-\d+$/);
      
      // No temp files should remain
      const files = await fs.readdir(tempDir);
      const tempFiles = files.filter(f => f.startsWith('.tmp_'));
      expect(tempFiles).toHaveLength(0);
    });
    
    it('should clean up orphaned temp files', async () => {
      // Create an orphaned temp file (simulating crash)
      const tempFile = path.join(tempDir, '.tmp_orphaned_123');
      await fs.writeFile(tempFile, 'orphaned content', 'utf-8');
      
      // Also create a regular file
      const regularFile = path.join(tempDir, 'regular.txt');
      await fs.writeFile(regularFile, 'regular content', 'utf-8');
      
      // Clean up temp files
      const cleaned = await cleanupOrphanedTemp(tempDir);
      
      expect(cleaned).toHaveLength(1);
      expect(cleaned[0]).toBe(tempFile);
      
      // Regular file should still exist
      expect(await fs.readFile(regularFile, 'utf-8')).toBe('regular content');
    });
    
    it('should not leave partial files on crash (simulated)', async () => {
      const filePath = path.join(tempDir, 'atomic-test.txt');
      const originalContent = 'original';
      
      // Write original content
      await fs.writeFile(filePath, originalContent, 'utf-8');
      
      // Simulate crash during write by creating temp file but not renaming
      const tempFile = path.join(tempDir, '.tmp_crash_test');
      await fs.writeFile(tempFile, 'new content', 'utf-8');
      
      // Clean up temp files (simulating recovery on restart)
      await cleanupOrphanedTemp(tempDir);
      
      // Original file should still have original content
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe(originalContent);
    });
  });
  
  describe('NodeFileSystem', () => {
    let tempDir: string;
    let fs: NodeFileSystem;
    
    beforeEach(async () => {
      tempDir = await createTempDir();
      fs = new NodeFileSystem({
        baseDir: tempDir,
        enforcePermissions: true,
      });
    });
    
    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });
    
    it('should read and write files', async () => {
      const content = 'test content';
      await fs.writeAtomic('test.txt', content);
      
      const readContent = await fs.read('test.txt');
      expect(readContent).toBe(content);
    });
    
    it('should create directories', async () => {
      await fs.ensureDir('subdir/nested');
      
      const stat = await fs.stat('subdir/nested');
      expect(stat.isDirectory).toBe(true);
    });
    
    it('should list directory contents', async () => {
      await fs.writeAtomic('file1.txt', 'content1');
      await fs.writeAtomic('file2.txt', 'content2');
      await fs.ensureDir('subdir');
      
      const entries = await fs.list('.', { includeDirs: true });
      
      expect(entries).toHaveLength(3);
      expect(entries.some(e => e.name === 'file1.txt' && e.isFile)).toBe(true);
      expect(entries.some(e => e.name === 'file2.txt' && e.isFile)).toBe(true);
      expect(entries.some(e => e.name === 'subdir' && e.isDirectory)).toBe(true);
    });
    
    it('should check file existence', async () => {
      await fs.writeAtomic('exists.txt', 'yes');
      
      expect(await fs.exists('exists.txt')).toBe(true);
      expect(await fs.exists('not-exists.txt')).toBe(false);
    });
    
    it('should throw FileNotFoundError for missing file', async () => {
      await expect(fs.read('missing.txt')).rejects.toThrow(FileNotFoundError);
    });
    
    it('should copy and move files', async () => {
      await fs.writeAtomic('source.txt', 'original');
      
      await fs.copy('source.txt', 'copy.txt');
      expect(await fs.read('copy.txt')).toBe('original');
      
      await fs.move('source.txt', 'moved.txt');
      expect(await fs.exists('source.txt')).toBe(false);
      expect(await fs.read('moved.txt')).toBe('original');
    });
    
    it('should delete files and directories', async () => {
      await fs.writeAtomic('to-delete.txt', 'bye');
      await fs.ensureDir('to-delete-dir');
      
      await fs.delete('to-delete.txt');
      await fs.removeDir('to-delete-dir');
      
      expect(await fs.exists('to-delete.txt')).toBe(false);
      expect(await fs.exists('to-delete-dir')).toBe(false);
    });
  });
  
  describe('permissions', () => {
    let tempDir: string;
    let fs: NodeFileSystem;
    
    beforeEach(async () => {
      tempDir = await createTempDir();
      fs = new NodeFileSystem({
        baseDir: tempDir,
        enforcePermissions: true,
      });
      
      // Create directories using native fs (bypass permission checks for setup)
      await nativeFs.mkdir(path.join(tempDir, 'clawspace'), { recursive: true });
      // Note: 'dialog' is a system path, so we create it directly with native fs
      await nativeFs.mkdir(path.join(tempDir, 'dialog'), { recursive: true });
      await nativeFs.writeFile(path.join(tempDir, 'dialog', '.gitkeep'), '', 'utf-8');
    });
    
    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });
    
    it('should allow read within clawDir', async () => {
      await fs.writeAtomic('clawspace/test.txt', 'test');
      const content = await fs.read('clawspace/test.txt');
      expect(content).toBe('test');
    });
    
    it('should allow write to writable directories', async () => {
      await fs.writeAtomic('clawspace/write.txt', 'writable');
      expect(await fs.read('clawspace/write.txt')).toBe('writable');
    });
    
    it('should throw error for paths outside baseDir', async () => {
      const outsidePath = path.join(tempDir, '..', 'outside.txt');
      const relativeOutside = path.relative(tempDir, outsidePath);
      
      // Path traversal attempts throw PermissionError (checked before PathNotInClawSpaceError)
      await expect(fs.read(relativeOutside)).rejects.toThrow(PermissionError);
    });
    
    it('should throw error for path traversal attempts', async () => {
      await expect(fs.read('../etc/passwd')).rejects.toThrow(PermissionError);
    });
    
    it('should work with disabled permissions', async () => {
      const fsNoPerm = new NodeFileSystem({
        baseDir: tempDir,
        enforcePermissions: false,
      });
      
      // Should be able to write anywhere
      await fsNoPerm.writeAtomic('dialog/test.txt', 'test');
      expect(await fsNoPerm.read('dialog/test.txt')).toBe('test');
    });
  });
  
  describe('DirectoryQueue', () => {
    let tempDir: string;
    let queue: DirectoryQueue;
    
    beforeEach(async () => {
      tempDir = await createTempDir();
      queue = new DirectoryQueue({ baseDir: tempDir });
      await queue.initialize();
    });
    
    afterEach(async () => {
      await cleanupTempDir(tempDir);
    });
    
    it('should enqueue and dequeue entries', async () => {
      const id = await queue.enqueue('test', { message: 'hello' });
      expect(id).toBeDefined();
      
      const entry = await queue.dequeue();
      expect(entry).not.toBeNull();
      expect(entry!.status).toBe('running');
    });
    
    it('should handle 100 concurrent enqueues with unique IDs', async () => {
      const enqueues = Array.from({ length: 100 }, (_, i) => 
        queue.enqueue('concurrent', { index: i })
      );
      
      const ids = await Promise.all(enqueues);
      
      // All IDs should be unique
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(100);
      
      // Verify all files exist
      const pendingDir = path.join(tempDir, 'pending');
      const files = await fs.readdir(pendingDir);
      expect(files.length).toBe(100);
    });
    
    it('should move entry from pending to running on dequeue', async () => {
      await queue.enqueue('test', { data: 'test' });
      
      const pendingBefore = await queue.getPending();
      expect(pendingBefore).toHaveLength(1);
      
      const entry = await queue.dequeue();
      expect(entry!.status).toBe('running');
      
      const pendingAfter = await queue.getPending();
      expect(pendingAfter).toHaveLength(0);
      
      const running = await queue.getRunning();
      expect(running).toHaveLength(1);
    });
    
    it('should complete entry and move to done', async () => {
      await queue.enqueue('test', { data: 'test' });
      const entry = await queue.dequeue();
      
      await queue.complete(entry!.id, { result: 'success' });
      
      const running = await queue.getRunning();
      expect(running).toHaveLength(0);
      
      const doneDir = path.join(tempDir, 'done');
      const doneFiles = await fs.readdir(doneDir);
      expect(doneFiles.length).toBeGreaterThan(0);
    });
    
    it('should fail entry and move to failed', async () => {
      await queue.enqueue('test', { data: 'test' });
      const entry = await queue.dequeue();
      
      await queue.fail(entry!.id, 'Something went wrong');
      
      const running = await queue.getRunning();
      expect(running).toHaveLength(0);
      
      const failedDir = path.join(tempDir, 'failed');
      const failedFiles = await fs.readdir(failedDir);
      expect(failedFiles.length).toBeGreaterThan(0);
    });
    
    it('should recover running entries on startup', async () => {
      // Enqueue and dequeue (move to running)
      const id = await queue.enqueue('recovery', { test: true });
      const entry = await queue.dequeue();
      expect(entry).not.toBeNull();
      
      // Simulate crash: create new queue instance
      const newQueue = new DirectoryQueue({ baseDir: tempDir });
      
      // Recover
      const recovered = await newQueue.recover();
      expect(recovered).toHaveLength(1);
      expect(recovered[0].id).toBe(entry!.id);
      
      // Entry should be back in pending
      const pending = await newQueue.getPending();
      expect(pending).toHaveLength(1);
      
      const running = await newQueue.getRunning();
      expect(running).toHaveLength(0);
    });
    
    it('should return null when dequeuing empty queue', async () => {
      const entry = await queue.dequeue();
      expect(entry).toBeNull();
    });
    
    it('should provide queue statistics', async () => {
      await queue.enqueue('s1', {});
      await queue.enqueue('s2', {});
      const e = await queue.dequeue();
      await queue.fail(e!.id, 'error');
      
      const stats = await queue.stats();
      expect(stats.pending).toBe(1);
      expect(stats.running).toBe(0);
      expect(stats.done).toBe(0);
      expect(stats.failed).toBe(1);
    });
  });
  
  describe('FileSystem integration', () => {
    it('should be assignable to IFileSystem interface', async () => {
      const tempDir = await createTempDir();
      
      try {
        // This tests structural typing - NodeFileSystem should satisfy IFileSystem
        const fs: NodeFileSystem = new NodeFileSystem({
          baseDir: tempDir,
        });
        
        // TypeScript compile-time check
        expect(fs).toBeDefined();
        expect(typeof fs.read).toBe('function');
        expect(typeof fs.writeAtomic).toBe('function');
        expect(typeof fs.watch).toBe('function');
      } finally {
        await cleanupTempDir(tempDir);
      }
    });
  });

  describe('symlink traversal protection', () => {
    let clawDir: string;
    let outsideDir: string;

    beforeEach(async () => {
      clawDir = await createTempDir();
      outsideDir = await createTempDir();
    });

    afterEach(async () => {
      await cleanupTempDir(clawDir);
      await cleanupTempDir(outsideDir);
    });

    it('should reject reads via symlink pointing outside clawDir', async () => {
      // Write a "secret" file outside clawDir
      await nativeFs.writeFile(path.join(outsideDir, 'secret.txt'), 'top secret');

      // Create a symlink inside clawDir pointing to the outside file
      await nativeFs.symlink(
        path.join(outsideDir, 'secret.txt'),
        path.join(clawDir, 'evil-link.txt')
      );

      const nodeFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: true });

      await expect(nodeFs.read('evil-link.txt')).rejects.toThrow(PermissionError);
    });

    it('should allow reads of normal files within clawDir', async () => {
      await nativeFs.writeFile(path.join(clawDir, 'safe.txt'), 'safe content');

      const nodeFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: true });

      const content = await nodeFs.read('safe.txt');
      expect(content).toBe('safe content');
    });

    it('should allow reads via symlink pointing within clawDir', async () => {
      // Target file inside clawDir
      await nativeFs.writeFile(path.join(clawDir, 'real.txt'), 'real content');
      // Symlink also inside clawDir
      await nativeFs.symlink(
        path.join(clawDir, 'real.txt'),
        path.join(clawDir, 'link.txt')
      );

      const nodeFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: true });

      const content = await nodeFs.read('link.txt');
      expect(content).toBe('real content');
    });

    it('should reject writes via symlink pointing outside clawDir', async () => {
      const targetFile = path.join(outsideDir, 'target.txt');
      await nativeFs.writeFile(targetFile, 'original');

      await nativeFs.symlink(
        targetFile,
        path.join(clawDir, 'evil-write-link.txt')
      );

      const nodeFs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: true });

      await expect(nodeFs.writeAtomic('evil-write-link.txt', 'pwned')).rejects.toThrow(PermissionError);

      // Original file should be untouched
      const original = await nativeFs.readFile(targetFile, 'utf-8');
      expect(original).toBe('original');
    });
  });
});
