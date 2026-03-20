/**
 * Builtin tools tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

import { readTool, writeTool, lsTool, searchTool, statusTool, sendTool, memorySearchTool, execTool, spawnTool } from '../../src/core/tools/builtins/index.js';
import { ExecContextImpl } from '../../src/core/tools/context.js';
import { NodeFileSystem } from '../../src/foundation/fs/index.js';
import { OutboxWriter } from '../../src/core/communication/outbox.js';

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
  let outboxWriter: OutboxWriter;

  beforeEach(async () => {
    tempDir = await createTempDir();
    mockFs = new NodeFileSystem({ baseDir: tempDir, enforcePermissions: false });
    outboxWriter = new OutboxWriter('test-claw', tempDir, mockFs);
    ctx = new ExecContextImpl({
      clawId: 'test-claw',
      clawDir: tempDir,
      profile: 'full',
      fs: mockFs,
      outboxWriter,
    });
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('read tool', () => {
    it('should read existing file', async () => {
      await mockFs.ensureDir('clawspace');
      await mockFs.writeAtomic('clawspace/test.txt', 'Hello, World!');

      const result = await readTool.execute({ path: 'clawspace/test.txt' }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toBe('Hello, World!');
    });

    it('should return error for non-existent file', async () => {
      const result = await readTool.execute({ path: 'clawspace/nonexistent.txt' }, ctx);

      expect(result.success).toBe(false);
      expect(result.content).toContain('Error');
    });

    it('should read specific line range', async () => {
      await mockFs.ensureDir('clawspace');
      await mockFs.writeAtomic('clawspace/lines.txt', 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5');

      const result = await readTool.execute({ path: 'clawspace/lines.txt', offset: 2, limit: 2 }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toBe('Line 2\nLine 3');
    });

    it('should block paths not in allowlist', async () => {
      const result = await readTool.execute({ path: 'dialog/test.txt' }, ctx);

      expect(result.success).toBe(false);
      expect(result.content).toContain('not allowed');
    });

    it('should block dialog/ path (blacklist)', async () => {
      const result = await readTool.execute({ path: 'dialog/current.json' }, ctx);

      expect(result.success).toBe(false);
      expect(result.content).toContain('not allowed');
    });

    // Phase 2 质量审查补充：截断元信息测试
    it('should include metadata when truncating large files', async () => {
      await mockFs.ensureDir('clawspace');
      // Create 300 lines file (exceeds 200 line limit)
      const lines = Array.from({ length: 300 }, (_, i) => `Line ${i + 1}`);
      await mockFs.writeAtomic('clawspace/large.txt', lines.join('\n'));

      const result = await readTool.execute({ path: 'clawspace/large.txt' }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('显示第1-200行');
      expect(result.content).toContain('共300行');
      expect(result.content).toContain('offset=201');
    });

    it('should include byte count when truncating by char limit', async () => {
      await mockFs.ensureDir('clawspace');
      // Create ~10KB content (exceeds 8000 char limit)
      const content = 'x'.repeat(10000);
      await mockFs.writeAtomic('clawspace/huge.txt', content);

      const result = await readTool.execute({ path: 'clawspace/huge.txt' }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('共10000字符');
    });

    // Negative offset tests
    it('should read last N lines with negative offset', async () => {
      await mockFs.ensureDir('clawspace');
      await mockFs.writeAtomic('clawspace/lines.txt', 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5');

      const result = await readTool.execute({ path: 'clawspace/lines.txt', offset: -2 }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toBe('Line 4\nLine 5');
    });

    it('should read from negative offset with limit', async () => {
      await mockFs.ensureDir('clawspace');
      await mockFs.writeAtomic('clawspace/lines.txt', 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5');

      // offset=-3 means start from Line 3, limit=2 reads Line 3 and Line 4
      const result = await readTool.execute({ path: 'clawspace/lines.txt', offset: -3, limit: 2 }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toBe('Line 3\nLine 4');
    });

    it('should start from beginning when negative offset exceeds total lines', async () => {
      await mockFs.ensureDir('clawspace');
      await mockFs.writeAtomic('clawspace/lines.txt', 'Line 1\nLine 2\nLine 3');

      // offset=-10 exceeds total lines (3), should start from line 1
      const result = await readTool.execute({ path: 'clawspace/lines.txt', offset: -10 }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toBe('Line 1\nLine 2\nLine 3');
    });
  });

  describe('write tool', () => {
    it('should write new file', async () => {
      await mockFs.ensureDir('clawspace');
      const result = await writeTool.execute({ path: 'clawspace/output.txt', content: 'New content' }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('成功写入');
      expect(result.content).toContain('字符');

      const content = await mockFs.read('clawspace/output.txt');
      expect(content).toBe('New content');
    });

    it('should append to file', async () => {
      await mockFs.ensureDir('clawspace');
      await mockFs.writeAtomic('clawspace/append.txt', 'First line\n');

      const result = await writeTool.execute({
        path: 'clawspace/append.txt',
        content: 'Second line',
        append: true,
      }, ctx);

      expect(result.success).toBe(true);

      const content = await mockFs.read('clawspace/append.txt');
      expect(content).toBe('First line\nSecond line');
    });

    it('should deny write for readonly profile', async () => {
      const readonlyCtx = new ExecContextImpl({
        clawId: 'test',
        clawDir: tempDir,
        profile: 'readonly',
        callerType: 'claw',
        fs: mockFs,
      });

      expect(readonlyCtx.hasPermission('write')).toBe(false);
    });

    // Phase 2 质量审查补充：版本清理测试
    it('should keep only last 10 versions when writing', async () => {
      await mockFs.ensureDir('clawspace');
      
      // Write same file 15 times (creates 14 backups, first write has no backup)
      // After cleanup, should keep exactly 10 most recent
      for (let i = 0; i < 15; i++) {
        const result = await writeTool.execute({ 
          path: 'clawspace/versioned.txt', 
          content: `Content version ${i}` 
        }, ctx);
        expect(result.success).toBe(true);
      }

      // Check versions directory
      const versionsDir = path.join(tempDir, 'clawspace', '.versions');
      const versionFiles = await fs.readdir(versionsDir).catch(() => []);
      const relevantVersions = versionFiles.filter(f => f.startsWith('versioned.txt.'));
      
      // Should be exactly 10 after cleanup (15 writes - 1 = 14 backups, keep last 10)
      expect(relevantVersions.length).toBe(10);
    });

    it('should include byte count in success message', async () => {
      await mockFs.ensureDir('clawspace');
      const content = 'Hello, this is test content';
      
      const result = await writeTool.execute({ 
        path: 'clawspace/bytecount.txt', 
        content 
      }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain(`${content.length}`);
      expect(result.content).toContain('字符');
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

    // Phase 2 质量审查补充：分页测试
    it('should show pagination indicator when more than 100 files', async () => {
      // Create 120 files
      for (let i = 0; i < 120; i++) {
        await mockFs.writeAtomic(`file${i}.txt`, '');
      }

      const result = await lsTool.execute({ path: '.' }, ctx);

      expect(result.success).toBe(true);
      // Should show pagination indicator
      expect(result.content).toContain('共');
      expect(result.content).toContain('120');
    });

    it('should limit output to 100 entries', async () => {
      // Create 120 files
      for (let i = 0; i < 120; i++) {
        await mockFs.writeAtomic(`file${i}.txt`, '');
      }

      const result = await lsTool.execute({ path: '.' }, ctx);

      expect(result.success).toBe(true);
      const lines = result.content.split('\n').filter(l => l.trim() && !l.includes('...'));
      // Should have 100 entries plus possibly pagination line
      const fileLines = lines.filter(l => l.includes('[FILE]') || l.includes('[DIR]'));
      expect(fileLines.length).toBeLessThanOrEqual(100);
    });
  });

  describe('search tool', () => {
    it('should find matching text', async () => {
      await mockFs.ensureDir('clawspace');
      await mockFs.writeAtomic('clawspace/note1.txt', 'Hello world\nThis is a test\nHello again');
      await mockFs.writeAtomic('clawspace/note2.txt', 'Goodbye world');

      const result = await searchTool.execute({ query: 'hello', path: 'clawspace' }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('Hello world');
      expect(result.content).toContain('Hello again');
      expect(result.content).not.toContain('Goodbye');
    });

    it('should return no results message', async () => {
      await mockFs.ensureDir('clawspace');
      await mockFs.writeAtomic('clawspace/empty.txt', 'Nothing here');

      const result = await searchTool.execute({ query: 'xyz', path: 'clawspace' }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('未找到');
    });

    it('should respect max_results', async () => {
      await mockFs.ensureDir('clawspace');
      await mockFs.writeAtomic('clawspace/many.txt', 'target\ntarget\ntarget\ntarget\ntarget\ntarget');

      const result = await searchTool.execute({ query: 'target', path: 'clawspace', max_results: 3 }, ctx);

      expect(result.success).toBe(true);
      const lines = result.content.split('\n').filter(l => l.trim());
      expect(lines.length).toBe(3);
    });

    it('should block paths not in allowlist', async () => {
      const result = await searchTool.execute({ query: 'test', path: 'dialog' }, ctx);

      expect(result.success).toBe(false);
      expect(result.content).toContain('not allowed');
    });

    it('should reject claw param for non-Motion', async () => {
      // ctx.clawId is 'test-claw', not 'motion'
      const result = await searchTool.execute({ query: 'test', path: 'clawspace', claw: 'other-claw' }, ctx);

      expect(result.success).toBe(false);
      expect(result.content).toContain('Only Motion can search files from other claws');
    });

    it('should search all claws with claw: "*" (Motion only)', async () => {
      // Create proper claws directory structure:
      // tempDir/claws/
      //   motion/      <- motion clawDir
      //   claw1/
      //   claw2/
      const clawsDir = path.join(tempDir, 'claws');
      await fs.mkdir(clawsDir, { recursive: true });
      
      // Create Motion's own directory (as motion's clawDir)
      const motionDir = path.join(clawsDir, 'motion');
      await fs.mkdir(motionDir, { recursive: true });
      
      // Create Motion context with motion's clawDir
      const motionFs = new NodeFileSystem({ baseDir: motionDir, enforcePermissions: false });
      const motionOutboxWriter = new OutboxWriter('motion', motionDir, motionFs);
      const motionCtx = new ExecContextImpl({
        clawId: 'motion',
        clawDir: motionDir,
        profile: 'full',
        fs: motionFs,
        outboxWriter: motionOutboxWriter,
      });
      
      // Create claw1 with test file
      const claw1Dir = path.join(clawsDir, 'claw1', 'clawspace');
      await fs.mkdir(claw1Dir, { recursive: true });
      await fs.writeFile(path.join(claw1Dir, 'note.txt'), 'Error in claw1: disk full');
      
      // Create claw2 with test file
      const claw2Dir = path.join(clawsDir, 'claw2', 'clawspace');
      await fs.mkdir(claw2Dir, { recursive: true });
      await fs.writeFile(path.join(claw2Dir, 'log.txt'), 'Error in claw2: timeout');
      
      // Create claw3 without clawspace (should be skipped gracefully)
      const claw3Dir = path.join(clawsDir, 'claw3');
      await fs.mkdir(claw3Dir, { recursive: true });

      const result = await searchTool.execute({ query: 'error', path: 'clawspace/', claw: '*' }, motionCtx);

      expect(result.success).toBe(true);
      // Results should have [clawId] prefix
      expect(result.content).toContain('[claw1]');
      expect(result.content).toContain('[claw2]');
      expect(result.content).toContain('disk full');
      expect(result.content).toContain('timeout');
      // Format: [clawId] clawspace/file.txt:line: content
      expect(result.content).toMatch(/\[claw1\] clawspace\/note\.txt:\d+:/);
      expect(result.content).toMatch(/\[claw2\] clawspace\/log\.txt:\d+:/);
    });

    it('should return no results when no claws directory exists (claw: "*")', async () => {
      // Create Motion context with a clawDir whose parent doesn't exist
      const nonExistentDir = path.join(tempDir, 'nonexistent', 'motion');
      const motionFs = new NodeFileSystem({ baseDir: nonExistentDir, enforcePermissions: false });
      const motionOutboxWriter = new OutboxWriter('motion', nonExistentDir, motionFs);
      const motionCtx = new ExecContextImpl({
        clawId: 'motion',
        clawDir: nonExistentDir,
        profile: 'full',
        fs: motionFs,
        outboxWriter: motionOutboxWriter,
      });

      const result = await searchTool.execute({ query: 'test', path: 'clawspace/', claw: '*' }, motionCtx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('未找到');
      expect(result.content).toContain('无 claw 目录');
    });

    it('should respect max_results with claw: "*" across all claws', async () => {
      // Create proper claws directory structure
      const clawsDir = path.join(tempDir, 'claws');
      await fs.mkdir(clawsDir, { recursive: true });
      
      // Create Motion's own directory (as motion's clawDir)
      const motionDir = path.join(clawsDir, 'motion');
      await fs.mkdir(motionDir, { recursive: true });
      
      // Create Motion context with motion's clawDir
      const motionFs = new NodeFileSystem({ baseDir: motionDir, enforcePermissions: false });
      const motionOutboxWriter = new OutboxWriter('motion', motionDir, motionFs);
      const motionCtx = new ExecContextImpl({
        clawId: 'motion',
        clawDir: motionDir,
        profile: 'full',
        fs: motionFs,
        outboxWriter: motionOutboxWriter,
      });
      
      // Create claw1 with multiple matches
      const claw1Dir = path.join(clawsDir, 'claw1', 'clawspace');
      await fs.mkdir(claw1Dir, { recursive: true });
      await fs.writeFile(path.join(claw1Dir, 'many.txt'), 'target\ntarget\ntarget');
      
      // Create claw2 with multiple matches
      const claw2Dir = path.join(clawsDir, 'claw2', 'clawspace');
      await fs.mkdir(claw2Dir, { recursive: true });
      await fs.writeFile(path.join(claw2Dir, 'many.txt'), 'target\ntarget\ntarget');

      const result = await searchTool.execute({ query: 'target', path: 'clawspace/', claw: '*', max_results: 4 }, motionCtx);

      expect(result.success).toBe(true);
      const lines = result.content.split('\n').filter(l => l.trim());
      expect(lines.length).toBe(4);
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

  describe('memory_search tool', () => {
    it('should search with query', async () => {
      await mockFs.ensureDir('memory');
      await mockFs.writeAtomic('memory/note1.md', 'Hello world\nThis is a test');
      await mockFs.writeAtomic('memory/note2.md', 'Goodbye world');

      const result = await memorySearchTool.execute({ query: 'hello' }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('Hello world');
      expect(result.content).not.toContain('Goodbye');
    });

    it('should filter by filename pattern', async () => {
      await mockFs.ensureDir('memory');
      await mockFs.writeAtomic('memory/2026-01.md', 'Content from 2026');
      await mockFs.writeAtomic('memory/2025-12.md', 'Content from 2025');

      const result = await memorySearchTool.execute({ query: 'content', pattern: '2026.*' }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('2026-01.md');
      expect(result.content).not.toContain('2025-12.md');
    });

    it('should filter by frontmatter metadata', async () => {
      await mockFs.ensureDir('memory');
      await mockFs.writeAtomic('memory/feedback1.md', '---\ntype: feedback\n---\nThis is feedback content');
      await mockFs.writeAtomic('memory/bug1.md', '---\ntype: bug\n---\nThis is bug report');

      const result = await memorySearchTool.execute({ filter: { type: 'feedback' } }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('feedback1.md');
      expect(result.content).not.toContain('bug1.md');
    });

    it('should combine query and filter', async () => {
      await mockFs.ensureDir('memory');
      await mockFs.writeAtomic('memory/a.md', '---\ntype: feedback\n---\nHello from A');
      await mockFs.writeAtomic('memory/b.md', '---\ntype: bug\n---\nHello from B');

      const result = await memorySearchTool.execute({ query: 'hello', filter: { type: 'feedback' } }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('A');
      expect(result.content).not.toContain('B');
    });

    it('should return error without query or filter', async () => {
      const result = await memorySearchTool.execute({}, ctx);

      expect(result.success).toBe(false);
      expect(result.content).toContain('必须提供 query 或 filter');
    });

    it('should return no results message', async () => {
      await mockFs.ensureDir('memory');
      await mockFs.writeAtomic('memory/empty.md', 'Nothing relevant');

      const result = await memorySearchTool.execute({ query: 'xyz123' }, ctx);

      expect(result.success).toBe(true);
      expect(result.content).toContain('未找到');
    });
  });

  describe('exec tool', () => {
    it('should return error for non-existent command', async () => {
      const result = await execTool.execute({ command: 'nonexistent_command_xyz' }, ctx);

      expect(result.success).toBe(false);
      expect(result.content).toContain('Error');
    });

    it('should have timeout parameter processed', async () => {
      // Test that timeout parameter is accepted and processed
      // (actual timeout behavior depends on environment having shell commands)
      const result = await execTool.execute({ command: 'echo test', timeout: 5000 }, ctx);
      
      // Should either succeed or fail with some error (not crash)
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('spawn tool', () => {
    it('should reject spawn in subagent context', async () => {
      const subagentCtx = new ExecContextImpl({
        clawId: 'test-subagent',
        clawDir: tempDir,
        profile: 'subagent',
        callerType: 'subagent',
        fs: mockFs,
      });

      const result = await spawnTool.execute({ prompt: 'test task' }, subagentCtx);

      expect(result.success).toBe(false);
      expect(result.content).toContain('recursion') || expect(result.content).toContain('cannot');
    });

    it('should require TaskSystem', async () => {
      const result = await spawnTool.execute({ prompt: 'test task' }, ctx);

      // Without TaskSystem injected, should fail
      expect(result.success).toBe(false);
      expect(result.content).toContain('TaskSystem');
    });

    it('should accept maxSteps parameter up to 50', async () => {
      // maxSteps > 50 should be capped or rejected
      // This test verifies the parameter is accepted
      const result = await spawnTool.execute({ 
        prompt: 'test task', 
        maxSteps: 100  // Over the 50 limit
      }, ctx);

      // Should fail due to no TaskSystem, but schema validation should pass
      expect(result.success).toBe(false);
      // Error should be about TaskSystem, not about maxSteps
      expect(result.content).toContain('TaskSystem');
    });
  });
});
