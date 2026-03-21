/**
 * Tool Executor tests - Phase 2 质量审查补充
 * 
 * 覆盖 audit.log JSONL 记录功能（设计缺口 C）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

import { ToolExecutorImpl } from '../../src/core/tools/executor.js';
import { ToolRegistry } from '../../src/core/tools/registry.js';
import { ExecContextImpl } from '../../src/core/tools/context.js';
import { NodeFileSystem } from '../../src/foundation/fs/index.js';

async function createTempDir(): Promise<string> {
  const tempDir = path.join(tmpdir(), `clawforum-executor-test-${randomUUID()}`);
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

describe('ToolExecutor', () => {
  let tempDir: string;
  let mockFs: NodeFileSystem;
  let ctx: ExecContextImpl;
  let registry: ToolRegistry;
  let executor: ToolExecutorImpl;

  beforeEach(async () => {
    tempDir = await createTempDir();
    mockFs = new NodeFileSystem({ baseDir: tempDir, enforcePermissions: false });
    ctx = new ExecContextImpl({
      clawId: 'test-claw',
      clawDir: tempDir,
      profile: 'full',
      fs: mockFs,
    });
    registry = new ToolRegistry();
    executor = new ToolExecutorImpl(registry);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  // Phase 17: executeParallel
  describe('executeParallel', () => {
    it('should execute batch of readonly tools in parallel and return results in original order', async () => {
      registry.register({
        name: 'echo-a',
        description: 'echo a',
        schema: { type: 'object', properties: {}, required: [] },
        requiredPermissions: [],
        readonly: true,
        async execute() { return { success: true, content: 'result-a' }; },
      });
      registry.register({
        name: 'echo-b',
        description: 'echo b',
        schema: { type: 'object', properties: {}, required: [] },
        requiredPermissions: [],
        readonly: true,
        async execute() { return { success: true, content: 'result-b' }; },
      });

      const results = await executor.executeParallel(
        [{ toolName: 'echo-b', args: {} }, { toolName: 'echo-a', args: {} }],
        ctx,
      );

      expect(results).toHaveLength(2);
      expect(results[0].content).toBe('result-b');
      expect(results[1].content).toBe('result-a');
    });

    it('should silently filter out non-readonly tools, returning shorter array', async () => {
      registry.register({
        name: 'write-tool',
        description: 'write',
        schema: { type: 'object', properties: {}, required: [] },
        requiredPermissions: [],
        readonly: false,
        async execute() { return { success: true, content: 'written' }; },
      });
      registry.register({
        name: 'read-tool',
        description: 'read',
        schema: { type: 'object', properties: {}, required: [] },
        requiredPermissions: [],
        readonly: true,
        async execute() { return { success: true, content: 'read-result' }; },
      });

      // batch has 2 items but only 1 is readonly
      const results = await executor.executeParallel(
        [{ toolName: 'write-tool', args: {} }, { toolName: 'read-tool', args: {} }],
        ctx,
      );

      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('read-result');
    });

    it('should return error result when readonly tool throws', async () => {
      registry.register({
        name: 'exploding-tool',
        description: 'explodes',
        schema: { type: 'object', properties: {}, required: [] },
        requiredPermissions: [],
        readonly: true,
        async execute() { throw new Error('boom'); },
      });

      const results = await executor.executeParallel(
        [{ toolName: 'exploding-tool', args: {} }],
        ctx,
      );

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].content).toContain('boom');
    });

    it('should return error result when readonly tool has unmet permission requirement', async () => {
      // 注册一个 readonly 但需要 execute 权限的工具
      registry.register({
        name: 'perm-tool',
        description: 'requires execute permission',
        schema: { type: 'object', properties: {}, required: [] },
        requiredPermissions: ['execute'],
        readonly: true,
        idempotent: true,
        async execute() { return { success: true, content: 'ran' }; },
      });

      // ctx 用 readonly profile（execute: false）
      const readonlyCtx = new ExecContextImpl({
        clawId: 'test-claw',
        clawDir: tempDir,
        profile: 'readonly',
        fs: mockFs,
      });

      // 修复前：Promise.all reject，整批失败
      // 修复后：.catch() 兜住，返回 error ToolResult
      const results = await executor.executeParallel(
        [{ toolName: 'perm-tool', args: {} }],
        readonlyCtx,
      );

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].content).toContain('execute');  // PermissionError 消息含 "execute"
    });
  });

  // Phase 2 质量审查：audit.log 测试
  describe('audit logging', () => {
    it('should write audit log on successful tool execution', async () => {
      // Register a simple tool
      registry.register({
        name: 'test-tool',
        description: 'Test tool',
        schema: { type: 'object', properties: {}, required: [] },
        requiredPermissions: ['read'],
        readonly: true,
        async execute() {
          return { success: true, content: 'ok' };
        },
      });

      await executor.execute({
        toolName: 'test-tool',
        args: { test: 'value' },
        ctx,
      });

      // Wait for async audit log to complete
      await new Promise(r => setTimeout(r, 100));

      // Check audit.log exists
      const auditPath = path.join(tempDir, 'logs', 'audit.log');
      const auditContent = await fs.readFile(auditPath, 'utf-8').catch(() => '');
      
      expect(auditContent).toBeTruthy();
      const entry = JSON.parse(auditContent.trim());
      expect(entry.tool).toBe('test-tool');
      expect(entry.ok).toBe(true);
      expect(entry.ts).toBeTruthy();
      expect(entry.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('should write audit log on failed tool execution', async () => {
      registry.register({
        name: 'failing-tool',
        description: 'Failing tool',
        schema: { type: 'object', properties: {}, required: [] },
        requiredPermissions: ['read'],
        readonly: true,
        async execute() {
          return { success: false, content: 'Something went wrong' };
        },
      });

      await executor.execute({
        toolName: 'failing-tool',
        args: {},
        ctx,
      });

      // Wait for async audit log to complete
      await new Promise(r => setTimeout(r, 100));

      const auditPath = path.join(tempDir, 'logs', 'audit.log');
      const auditContent = await fs.readFile(auditPath, 'utf-8').catch(() => '');
      
      expect(auditContent).toBeTruthy();
      const entry = JSON.parse(auditContent.trim());
      expect(entry.ok).toBe(false);
      expect(entry.error).toContain('Something went wrong');
    });

    it('should not block execution when audit log fails', async () => {
      // Make clawDir read-only to cause audit log failure
      const readonlyDir = path.join(tempDir, 'readonly');
      await fs.mkdir(readonlyDir, { recursive: true });
      await fs.chmod(readonlyDir, 0o444);
      
      const readonlyCtx = new ExecContextImpl({
        clawId: 'test-claw',
        clawDir: readonlyDir,
        profile: 'full',
        fs: mockFs,
      });

      registry.register({
        name: 'test-tool',
        description: 'Test tool',
        schema: { type: 'object', properties: {}, required: [] },
        requiredPermissions: ['read'],
        readonly: true,
        async execute() {
          return { success: true, content: 'ok' };
        },
      });

      // Should not throw even though audit log will fail
      const result = await executor.execute({
        toolName: 'test-tool',
        args: {},
        ctx: readonlyCtx,
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe('ok');

      // Restore permissions for cleanup
      await fs.chmod(readonlyDir, 0o755).catch(() => {});
    });

    it('should include truncated args in audit log', async () => {
      registry.register({
        name: 'test-tool',
        description: 'Test tool',
        schema: { type: 'object', properties: {}, required: [] },
        requiredPermissions: ['read'],
        readonly: true,
        async execute() {
          return { success: true, content: 'ok' };
        },
      });

      const longArgs = { data: 'x'.repeat(200) };
      await executor.execute({
        toolName: 'test-tool',
        args: longArgs,
        ctx,
      });

      // Wait for async audit log to complete
      await new Promise(r => setTimeout(r, 100));

      const auditPath = path.join(tempDir, 'logs', 'audit.log');
      const auditContent = await fs.readFile(auditPath, 'utf-8').catch(() => '');
      
      expect(auditContent).toBeTruthy();
      const entry = JSON.parse(auditContent.trim());
      // Args should be truncated to 80 chars
      expect(entry.args.length).toBeLessThanOrEqual(85); // Allow for "..." and braces
    });
  });
});
