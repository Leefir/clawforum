/**
 * Tools module tests
 * 
 * Tests:
 * - ToolRegistry: register, get, profile filtering
 * - ToolExecutor: execute with permissions, timeout, errors
 * - ExecContext: permissions, elapsed time
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolRegistry } from '../../src/core/tools/registry.js';
import { ToolExecutorImpl } from '../../src/core/tools/executor.js';
import { ExecContextImpl } from '../../src/core/tools/context.js';
import { TOOL_PROFILES } from '../../src/core/tools/profiles.js';
import type { ITool, ToolResult } from '../../src/core/tools/executor.js';
import type { IFileSystem } from '../../src/foundation/fs/types.js';
import {
  ToolNotFoundError,
  PermissionError,
  ToolTimeoutError,
} from '../../src/types/errors.js';

describe('Tools', () => {
  describe('TOOL_PROFILES', () => {
    it('should define correct tools for readonly profile', () => {
      expect(TOOL_PROFILES.readonly).toEqual(['read', 'search', 'ls', 'status']);
    });

    it('should define correct tools for full profile', () => {
      expect(TOOL_PROFILES.full).toHaveLength(10);
      expect(TOOL_PROFILES.full).toContain('read');
      expect(TOOL_PROFILES.full).toContain('write');
      expect(TOOL_PROFILES.full).toContain('spawn');
    });

    it('should define correct tools for subagent profile', () => {
      expect(TOOL_PROFILES.subagent).toContain('read');
      expect(TOOL_PROFILES.subagent).toContain('write');
      expect(TOOL_PROFILES.subagent).toContain('skill');
      expect(TOOL_PROFILES.subagent).not.toContain('spawn');
    });

    it('should define correct tools for dream profile', () => {
      expect(TOOL_PROFILES.dream).toEqual(['read', 'search', 'ls']);
    });
  });

  describe('ToolRegistry', () => {
    let registry: ToolRegistry;

    beforeEach(() => {
      registry = new ToolRegistry();
    });

    it('should register and retrieve tool', () => {
      const mockTool: ITool = {
        name: 'test-tool',
        description: 'A test tool',
        schema: { type: 'object' },
        requiredPermissions: ['read'],
        readonly: true,
        execute: async () => ({ success: true, content: 'ok' }),
      };

      registry.register(mockTool);

      const retrieved = registry.get('test-tool');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('test-tool');
    });

    it('should overwrite tool with same name', () => {
      const tool1: ITool = {
        name: 'same',
        description: 'First',
        schema: { type: 'object' },
        requiredPermissions: [],
        readonly: true,
        execute: async () => ({ success: true, content: 'v1' }),
      };

      const tool2: ITool = {
        name: 'same',
        description: 'Second',
        schema: { type: 'object' },
        requiredPermissions: [],
        readonly: true,
        execute: async () => ({ success: true, content: 'v2' }),
      };

      registry.register(tool1);
      registry.register(tool2);

      const retrieved = registry.get('same');
      expect(retrieved?.description).toBe('Second');
    });

    it('should check tool existence with has()', () => {
      const mockTool: ITool = {
        name: 'exists',
        description: 'Test',
        schema: { type: 'object' },
        requiredPermissions: [],
        readonly: true,
        execute: async () => ({ success: true, content: '' }),
      };

      registry.register(mockTool);

      expect(registry.has('exists')).toBe(true);
      expect(registry.has('missing')).toBe(false);
    });

    it('should unregister tool', () => {
      const mockTool: ITool = {
        name: 'to-remove',
        description: 'Test',
        schema: { type: 'object' },
        requiredPermissions: [],
        readonly: true,
        execute: async () => ({ success: true, content: '' }),
      };

      registry.register(mockTool);
      expect(registry.has('to-remove')).toBe(true);

      registry.unregister('to-remove');
      expect(registry.has('to-remove')).toBe(false);
    });

    it('should get all tools', () => {
      registry.register({
        name: 'tool-a',
        description: 'A',
        schema: { type: 'object' },
        requiredPermissions: [],
        readonly: true,
        execute: async () => ({ success: true, content: '' }),
      });

      registry.register({
        name: 'tool-b',
        description: 'B',
        schema: { type: 'object' },
        requiredPermissions: [],
        readonly: true,
        execute: async () => ({ success: true, content: '' }),
      });

      const all = registry.getAll();
      expect(all).toHaveLength(2);
    });

    it('should filter tools by profile', () => {
      // Register tools matching profile names
      TOOL_PROFILES.readonly.forEach(name => {
        registry.register({
          name,
          description: `Tool ${name}`,
          schema: { type: 'object' },
          requiredPermissions: [],
          readonly: true,
          execute: async () => ({ success: true, content: '' }),
        });
      });

      // Also register a tool not in readonly profile
      registry.register({
        name: 'write',
        description: 'Write tool',
        schema: { type: 'object' },
        requiredPermissions: ['write'],
        readonly: false,
        execute: async () => ({ success: true, content: '' }),
      });

      const readonlyTools = registry.getForProfile('readonly');
      expect(readonlyTools).toHaveLength(4);
      expect(readonlyTools.every(t => TOOL_PROFILES.readonly.includes(t.name))).toBe(true);
      expect(readonlyTools.some(t => t.name === 'write')).toBe(false);
    });

    it('should format tools for LLM API', () => {
      registry.register({
        name: 'read',
        description: 'Read a file',
        schema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
        requiredPermissions: ['read'],
        readonly: true,
        execute: async () => ({ success: true, content: '' }),
      });

      const formatted = registry.formatForLLM(registry.getAll());

      expect(formatted).toHaveLength(1);
      expect(formatted[0]).toEqual({
        name: 'read',
        description: 'Read a file',
        input_schema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      });
    });
  });

  describe('ExecContext', () => {
    const mockFs = {} as IFileSystem;

    it('should check permissions for full profile', () => {
      const ctx = new ExecContextImpl({
        clawId: 'test',
        clawDir: '/test',
        profile: 'full',
        fs: mockFs,
      });

      expect(ctx.hasPermission('read')).toBe(true);
      expect(ctx.hasPermission('write')).toBe(true);
      expect(ctx.hasPermission('execute')).toBe(true);
      expect(ctx.hasPermission('spawn')).toBe(true);
    });

    it('should check permissions for readonly profile', () => {
      const ctx = new ExecContextImpl({
        clawId: 'test',
        clawDir: '/test',
        profile: 'readonly',
        fs: mockFs,
      });

      expect(ctx.hasPermission('read')).toBe(true);
      expect(ctx.hasPermission('write')).toBe(false);
      expect(ctx.hasPermission('execute')).toBe(false);
      expect(ctx.hasPermission('spawn')).toBe(false);
    });

    it('should track elapsed time', async () => {
      const ctx = new ExecContextImpl({
        clawId: 'test',
        clawDir: '/test',
        profile: 'full',
        fs: mockFs,
      });

      const elapsed1 = ctx.getElapsedMs();
      await new Promise(r => setTimeout(r, 10));
      const elapsed2 = ctx.getElapsedMs();

      expect(elapsed1).toBeGreaterThanOrEqual(0);
      expect(elapsed2).toBeGreaterThan(elapsed1);
    });
  });

  describe('ToolExecutor', () => {
    let registry: ToolRegistry;
    let executor: ToolExecutorImpl;
    let mockFs: IFileSystem;

    beforeEach(() => {
      registry = new ToolRegistry();
      executor = new ToolExecutorImpl(registry);
      mockFs = {} as IFileSystem;
    });

    it('should throw ToolNotFoundError for unknown tool', async () => {
      const ctx = new ExecContextImpl({
        clawId: 'test',
        clawDir: '/test',
        profile: 'full',
        fs: mockFs,
      });

      await expect(
        executor.execute({ toolName: 'unknown', args: {}, ctx })
      ).rejects.toThrow(ToolNotFoundError);
    });

    it('should throw PermissionError for insufficient permissions', async () => {
      registry.register({
        name: 'write-tool',
        description: 'Needs write',
        schema: { type: 'object' },
        requiredPermissions: ['write'],
        readonly: false,
        execute: async () => ({ success: true, content: '' }),
      });

      const ctx = new ExecContextImpl({
        clawId: 'test',
        clawDir: '/test',
        profile: 'readonly',
        fs: mockFs,
      });

      await expect(
        executor.execute({ toolName: 'write-tool', args: {}, ctx })
      ).rejects.toThrow(PermissionError);
    });

    it('should execute tool successfully', async () => {
      const mockExecute = vi.fn(async (): Promise<ToolResult> => ({
        success: true,
        content: 'executed',
      }));

      registry.register({
        name: 'test',
        description: 'Test tool',
        schema: { type: 'object' },
        requiredPermissions: [],
        readonly: true,
        execute: mockExecute,
      });

      const ctx = new ExecContextImpl({
        clawId: 'test',
        clawDir: '/test',
        profile: 'full',
        fs: mockFs,
      });

      const result = await executor.execute({
        toolName: 'test',
        args: { key: 'value' },
        ctx,
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe('executed');
      expect(mockExecute).toHaveBeenCalledWith({ key: 'value' }, ctx);
    });

    it('should throw ToolTimeoutError on timeout', async () => {
      registry.register({
        name: 'slow',
        description: 'Slow tool',
        schema: { type: 'object' },
        requiredPermissions: [],
        readonly: true,
        execute: async () => {
          // Sleep for a long time - longer than timeoutMs
          await new Promise(r => setTimeout(r, 500));
          return { success: true, content: '' };
        },
      });

      const ctx = new ExecContextImpl({
        clawId: 'test',
        clawDir: '/test',
        profile: 'full',
        fs: mockFs,
      });

      // Timeout should trigger before tool completes
      const promise = executor.execute({
        toolName: 'slow',
        args: {},
        ctx,
        timeoutMs: 50, // Tool takes 500ms, timeout at 50ms
      });

      await expect(promise).rejects.toThrow(ToolTimeoutError);
    });

    it('should execute readonly tools in parallel', async () => {
      const executionOrder: number[] = [];

      registry.register({
        name: 'tool1',
        description: 'Tool 1',
        schema: { type: 'object' },
        requiredPermissions: [],
        readonly: true,
        execute: async () => {
          executionOrder.push(1);
          await new Promise(r => setTimeout(r, 10));
          executionOrder.push(-1);
          return { success: true, content: '1' };
        },
      });

      registry.register({
        name: 'tool2',
        description: 'Tool 2',
        schema: { type: 'object' },
        requiredPermissions: [],
        readonly: true,
        execute: async () => {
          executionOrder.push(2);
          await new Promise(r => setTimeout(r, 10));
          executionOrder.push(-2);
          return { success: true, content: '2' };
        },
      });

      registry.register({
        name: 'tool3',
        description: 'Tool 3',
        schema: { type: 'object' },
        requiredPermissions: [],
        readonly: true,
        execute: async () => {
          executionOrder.push(3);
          await new Promise(r => setTimeout(r, 10));
          executionOrder.push(-3);
          return { success: true, content: '3' };
        },
      });

      const ctx = new ExecContextImpl({
        clawId: 'test',
        clawDir: '/test',
        profile: 'full',
        fs: mockFs,
      });

      const results = await executor.executeParallel(
        [
          { toolName: 'tool1', args: {} },
          { toolName: 'tool2', args: {} },
          { toolName: 'tool3', args: {} },
        ],
        ctx
      );

      expect(results).toHaveLength(3);
      expect(results.every(r => r.success)).toBe(true);

      // If executed in parallel, order should be interleaved (starts before previous ends)
      // E.g., [1, 2, 3, -1, -2, -3] or similar
      const starts = executionOrder.filter(n => n > 0);
      const ends = executionOrder.filter(n => n < 0);

      expect(starts).toHaveLength(3);
      expect(ends).toHaveLength(3);
    });
  });
});
