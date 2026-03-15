/**
 * Builtin tools tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

import { readTool, writeTool, lsTool, searchTool, statusTool, sendTool } from '../../src/core/tools/builtins/index.js';
import { ExecContextImpl } from '../../src/core/tools/context.js';
import { NodeFileSystem } from '../../src/foundation/fs/index.js';

async function createTempDir(): Promise<string> {
  const tempDir = path.join(tmpdir(), `clawforum-builtin-test-${randomUUID()}`);
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe('Builtin Tools', () => {
  let tempDir: string;
  let mockFs: NodeFileSystem;
  let ctx: ExecContextImpl;

  beforeEach(async () => {
    tempDir = await createTempDir();
    mockFs = new NodeFileSystem({ baseDir: tempDir, enforcePermissions: false });
    ctx = new ExecContextImpl({
      clawId: 'test-claw',
      clawDir: tempDir,
      profile: 'full',
      fs: mockFs,
    });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('read tool', () => {
    it('should read existing file', async () => {
      await mockFs.writeAtomic('test.txt', 'Hello, World!');

      const result = await readTool.execute({ path: 'test.txt' }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toBe('Hello, World!');
    });

    it('should return error for non-existent file', async () => {
      const result = await readTool.execute({ path: 'nonexistent.txt' }, ctx);

      expect(result.success).toBe(false);
      expect(result.content).toContain('Error');
    });

    it('should read specific line range', async () => {
      await mockFs.writeAtomic('lines.txt', 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5');

      const result = await readTool.execute({ path: 'lines.txt', offset: 2, limit: 2 }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toBe('Line 2\nLine 3');
    });
  });

  describe('write tool', () => {
    it('should write new file', async () => {
      const result = await writeTool.execute({ path: 'output.txt', content: 'New content' }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('写入成功');

      const content = await mockFs.read('output.txt');
      expect(content).toBe('New content');
    });

    it('should append to file', async () => {
      await mockFs.writeAtomic('append.txt', 'First line\n');

      const result = await writeTool.execute({
        path: 'append.txt',
        content: 'Second line',
        append: true,
      }, ctx);

      expect(result.success).toBe(true);

      const content = await mockFs.read('append.txt');
      expect(content).toBe('First line\nSecond line');
    });

    it('should deny write for readonly profile', async () => {
      const readonlyCtx = new ExecContextImpl({
        clawId: 'test',
        clawDir: tempDir,
        profile: 'readonly',
        fs: mockFs,
      });

      expect(readonlyCtx.hasPermission('write')).toBe(false);
    });
  });

  describe('ls tool', () => {
    it('should list directory contents', async () => {
      await mockFs.writeAtomic('file1.txt', '');
      await mockFs.writeAtomic('file2.txt', '');
      await mockFs.ensureDir('subdir');

      const result = await lsTool.execute({ path: '.' }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('[FILE] file1.txt');
      expect(result.content).toContain('[FILE] file2.txt');
      expect(result.content).toContain('[DIR] subdir');
    });

    it('should handle empty directory', async () => {
      await mockFs.ensureDir('empty');

      const result = await lsTool.execute({ path: 'empty' }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toBe('目录为空');
    });

    it('should default to current directory', async () => {
      await mockFs.writeAtomic('current.txt', '');

      const result = await lsTool.execute({}, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('current.txt');
    });
  });

  describe('search tool', () => {
    it('should find matching text', async () => {
      await mockFs.ensureDir('memory');
      await mockFs.writeAtomic('memory/note1.txt', 'Hello world\nThis is a test\nHello again');
      await mockFs.writeAtomic('memory/note2.txt', 'Goodbye world');

      const result = await searchTool.execute({ query: 'hello', path: 'memory' }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('Hello world');
      expect(result.content).toContain('Hello again');
      expect(result.content).not.toContain('Goodbye');
    });

    it('should return no results message', async () => {
      await mockFs.ensureDir('memory');
      await mockFs.writeAtomic('memory/empty.txt', 'Nothing here');

      const result = await searchTool.execute({ query: 'xyz', path: 'memory' }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('未找到');
    });

    it('should respect max_results', async () => {
      await mockFs.ensureDir('memory');
      await mockFs.writeAtomic('memory/many.txt', 'target\ntarget\ntarget\ntarget\ntarget\ntarget');

      const result = await searchTool.execute({ query: 'target', path: 'memory', max_results: 3 }, ctx);

      expect(result.success).toBe(true);
      const lines = result.content.split('\n').filter(l => l.trim());
      expect(lines.length).toBe(3);
    });
  });

  describe('status tool', () => {
    it('should return status information', async () => {
      const result = await statusTool.execute({}, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('Claw ID: test-claw');
      expect(result.content).toContain('Profile: full');
      expect(result.content).toContain('Step:');
      expect(result.content).toContain('Elapsed:');
    });
  });

  describe('send tool', () => {
    it('should create message in outbox', async () => {
      const result = await sendTool.execute({
        content: 'Test message',
        type: 'report',
      }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('消息已发送');

      // Verify file was created
      const outboxDir = path.join(tempDir, 'outbox', 'pending');
      const files = await fs.readdir(outboxDir);
      expect(files.length).toBe(1);
      expect(files[0]).toContain('report');
    });

    it('should validate message type', async () => {
      const result = await sendTool.execute({
        content: 'Test',
        type: 'invalid',
      }, ctx);

      expect(result.success).toBe(false);
      expect(result.content).toContain('Invalid message type');
    });
  });
});
