/**
 * TaskSystem Tool Task Tests
 * 
 * Tests for async tool execution via TaskSystem:
 * - scheduleTool success/failure paths
 * - executor async routing
 * - maxConcurrent limit
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskSystem, SubAgentTask, ToolTask } from '../../src/core/task/system.js';
import { ToolExecutorImpl, ExecuteOptions } from '../../src/core/tools/executor.js';
import { ToolRegistry } from '../../src/core/tools/registry.js';
import { ITool, ToolResult, ExecContext } from '../../src/core/tools/executor.js';
import type { JSONSchema7 } from '../../src/types/message.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR = path.join(__dirname, '../../.test-task-system-tool');

// Mock tool for testing
const createMockTool = (supportsAsync: boolean): ITool => ({
  name: 'mockAsyncTool',
  description: 'Mock tool for async testing',
  schema: { type: 'object', properties: {} },
  requiredPermissions: [],
  readonly: false,
  idempotent: false,
  supportsAsync,
  async execute(args: Record<string, unknown>, ctx: ExecContext): Promise<ToolResult> {
    const shouldFail = args.fail === true;
    if (shouldFail) {
      throw new Error('Mock execution failed');
    }
    return {
      success: true,
      content: args.content as string || 'ok',
    };
  },
});

// Mock transport
const createMockTransport = () => ({
  sendInboxMessage: vi.fn().mockResolvedValue(undefined),
  sendOutboxMessage: vi.fn().mockResolvedValue(undefined),
  readInbox: vi.fn().mockResolvedValue([]),
  readOutbox: vi.fn().mockResolvedValue([]),
  acknowledgeMessage: vi.fn().mockResolvedValue(undefined),
  listInbox: vi.fn().mockResolvedValue([]),
  listOutbox: vi.fn().mockResolvedValue([]),
});

// Mock fs
const createMockFs = () => ({
  read: vi.fn(),
  write: vi.fn().mockResolvedValue(undefined),
  writeAtomic: vi.fn().mockResolvedValue(undefined),
  append: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockResolvedValue(false),
  list: vi.fn().mockResolvedValue([]),
  ensureDir: vi.fn().mockResolvedValue(undefined),
  isDirectory: vi.fn().mockResolvedValue(false),
});

describe('TaskSystem Tool Tasks', () => {
  let taskSystem: TaskSystem;
  let mockTransport: ReturnType<typeof createMockTransport>;
  let mockFs: ReturnType<typeof createMockFs>;
  let testClawDir: string;

  beforeEach(async () => {
    testClawDir = path.join(TEST_DIR, `test-${Date.now()}`);
    await fs.mkdir(testClawDir, { recursive: true });
    await fs.mkdir(path.join(testClawDir, 'tasks', 'pending'), { recursive: true });
    await fs.mkdir(path.join(testClawDir, 'tasks', 'running'), { recursive: true });
    await fs.mkdir(path.join(testClawDir, 'tasks', 'done'), { recursive: true });
    await fs.mkdir(path.join(testClawDir, 'tasks', 'results'), { recursive: true });
    await fs.mkdir(path.join(testClawDir, 'inbox', 'pending'), { recursive: true });
    await fs.mkdir(path.join(testClawDir, 'logs'), { recursive: true });

    mockTransport = createMockTransport();
    
    // Use real fs for integration-like testing
    taskSystem = new TaskSystem(
      testClawDir,
      {
        read: (p: string) => fs.readFile(path.join(testClawDir, p), 'utf-8'),
        write: (p: string, c: string) => fs.writeFile(path.join(testClawDir, p), c),
        writeAtomic: (p: string, c: string) => fs.writeFile(path.join(testClawDir, p), c),
        append: (p: string, c: string) => fs.appendFile(path.join(testClawDir, p), c),
        delete: (p: string) => fs.unlink(path.join(testClawDir, p)),
        exists: (p: string) => fs.access(path.join(testClawDir, p)).then(() => true).catch(() => false),
        list: (p: string) => fs.readdir(path.join(testClawDir, p), { withFileTypes: true }).then(entries => 
          entries.map(e => ({ name: e.name, path: path.join(p, e.name), isDirectory: e.isDirectory() }))
        ),
        ensureDir: (p: string) => fs.mkdir(path.join(testClawDir, p), { recursive: true }),
        isDirectory: (p: string) => fs.stat(path.join(testClawDir, p)).then(s => s.isDirectory()).catch(() => false),
      } as any,
      mockTransport as any,
      { maxConcurrent: 3 }
    );
    
    await taskSystem.initialize();
  });

  afterEach(async () => {
    await taskSystem.shutdown(1000).catch(() => {});
    // Clean up test dir
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  describe('scheduleTool', () => {
    it('should schedule tool task and return taskId immediately', async () => {
      const executeCallback = vi.fn().mockResolvedValue({ success: true, content: 'ok' });
      
      const taskId = await taskSystem.scheduleTool('testTool', executeCallback, 'parent-claw');
      
      expect(taskId).toBeDefined();
      expect(typeof taskId).toBe('string');
      expect(taskSystem.listRunning()).toContain(taskId);
    });

    it('should save task to tasks/running/', async () => {
      const executeCallback = vi.fn().mockResolvedValue({ success: true, content: 'ok' });
      
      const taskId = await taskSystem.scheduleTool('testTool', executeCallback, 'parent-claw');
      
      const taskFile = await fs.readFile(
        path.join(testClawDir, 'tasks', 'running', `${taskId}.json`),
        'utf-8'
      );
      const taskData = JSON.parse(taskFile);
      expect(taskData.kind).toBe('tool');
      expect(taskData.toolName).toBe('testTool');
      expect(taskData.parentClawId).toBe('parent-claw');
    });

    it('should execute callback and send result to inbox', async () => {
      const executeCallback = vi.fn().mockResolvedValue({ success: true, content: 'async result' });
      
      const taskId = await taskSystem.scheduleTool('testTool', executeCallback, 'parent-claw');
      
      // Wait for async execution
      await new Promise(r => setTimeout(r, 100));
      
      expect(executeCallback).toHaveBeenCalled();
      expect(mockTransport.sendInboxMessage).toHaveBeenCalled();
      
      const callArg = mockTransport.sendInboxMessage.mock.calls[0][1];
      expect(callArg.from).toBe('task_system');
      expect(callArg.to).toBe('parent-claw');
      expect(callArg.priority).toBe('normal');
      
      const content = JSON.parse(callArg.content);
      expect(content.taskId).toBe(taskId);
      expect(content.toolName).toBe('testTool');
      expect(content.is_error).toBe(false);
    });

    it('should send error result when callback throws', async () => {
      const executeCallback = vi.fn().mockRejectedValue(new Error('Execution failed'));
      
      const taskId = await taskSystem.scheduleTool('testTool', executeCallback, 'parent-claw');
      
      // Wait for async execution
      await new Promise(r => setTimeout(r, 100));
      
      expect(mockTransport.sendInboxMessage).toHaveBeenCalled();
      
      const callArg = mockTransport.sendInboxMessage.mock.calls[0][1];
      expect(callArg.priority).toBe('high'); // Errors are high priority
      
      const content = JSON.parse(callArg.content);
      expect(content.taskId).toBe(taskId);
      expect(content.is_error).toBe(true);
    });

    it('should move task to done after completion', async () => {
      const executeCallback = vi.fn().mockResolvedValue({ success: true, content: 'ok' });
      
      const taskId = await taskSystem.scheduleTool('testTool', executeCallback, 'parent-claw');
      
      // Wait for async execution
      await new Promise(r => setTimeout(r, 100));
      
      // Task should be in done directory
      const doneFile = await fs.readFile(
        path.join(testClawDir, 'tasks', 'done', `${taskId}.json`),
        'utf-8'
      );
      const doneData = JSON.parse(doneFile);
      expect(doneData.id).toBe(taskId);
      expect(doneData.kind).toBe('tool');
      
      // Should not be in running
      expect(taskSystem.listRunning()).not.toContain(taskId);
    });
  });

  describe('maxConcurrent limit', () => {
    it('should throw when max concurrent reached', async () => {
      // Fill up to max concurrent (3)
      const promises: Promise<string>[] = [];
      for (let i = 0; i < 3; i++) {
        const slowCallback = () => new Promise<ToolResult>(r => setTimeout(() => r({ success: true, content: 'slow' }), 5000));
        promises.push(taskSystem.scheduleTool(`slowTool${i}`, slowCallback, 'parent-claw'));
      }
      await Promise.all(promises);
      
      // 4th should throw
      const fourthCallback = vi.fn().mockResolvedValue({ success: true, content: 'ok' });
      await expect(
        taskSystem.scheduleTool('fourthTool', fourthCallback, 'parent-claw')
      ).rejects.toThrow('Max concurrent tasks (3) reached');
    });
  });
});

describe('ToolExecutor async routing', () => {
  let registry: ToolRegistry;
  let executor: ToolExecutorImpl;
  let mockTaskSystem: { scheduleTool: ReturnType<typeof vi.fn> };
  let mockCtx: ExecContext;

  beforeEach(() => {
    registry = new ToolRegistry();
    executor = new ToolExecutorImpl(registry);
    
    mockTaskSystem = {
      scheduleTool: vi.fn().mockResolvedValue('mock-task-id-123'),
    };
    
    mockCtx = {
      clawId: 'test-claw',
      clawDir: '/tmp/test',
      callerType: 'claw',
      fs: createMockFs() as any,
      profile: { name: 'test', permissions: { read: true, write: true, execute: true, send: true, spawn: true } },
      permissions: { read: true, write: true, execute: true, send: true, spawn: true },
      hasPermission: () => true,
      stepNumber: 1,
      maxSteps: 20,
      getElapsedMs: () => 1000,
      incrementStep: () => {},
      taskSystem: mockTaskSystem as any,
    };
  });

  it('should return error when tool does not support async', async () => {
    // Register tool without supportsAsync
    const nonAsyncTool: ITool = {
      name: 'nonAsyncTool',
      description: 'Tool without async support',
      schema: { type: 'object', properties: {} },
      requiredPermissions: [],
      readonly: false,
      idempotent: false,
      // supportsAsync is undefined (false by default)
      async execute(): Promise<ToolResult> {
        return { success: true, content: 'sync result' };
      },
    };
    registry.register(nonAsyncTool);

    const result = await executor.execute({
      toolName: 'nonAsyncTool',
      args: {},
      ctx: mockCtx,
      async: true, // Request async mode
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain('does not support async mode');
    expect(mockTaskSystem.scheduleTool).not.toHaveBeenCalled();
  });

  it('should return error when taskSystem is not available', async () => {
    // Register tool with supportsAsync
    const asyncTool: ITool = {
      name: 'asyncTool',
      description: 'Tool with async support',
      schema: { type: 'object', properties: {} },
      requiredPermissions: [],
      readonly: false,
      idempotent: false,
      supportsAsync: true,
      async execute(): Promise<ToolResult> {
        return { success: true, content: 'async result' };
      },
    };
    registry.register(asyncTool);

    // ctx without taskSystem
    const ctxWithoutTaskSystem = { ...mockCtx, taskSystem: undefined };

    const result = await executor.execute({
      toolName: 'asyncTool',
      args: {},
      ctx: ctxWithoutTaskSystem,
      async: true,
    });

    expect(result.success).toBe(false);
    expect(result.content).toContain('TaskSystem (not available)');
  });

  it('should schedule async task when tool supports async and taskSystem available', async () => {
    const asyncTool: ITool = {
      name: 'asyncTool',
      description: 'Tool with async support',
      schema: { type: 'object', properties: {} },
      requiredPermissions: [],
      readonly: false,
      idempotent: false,
      supportsAsync: true,
      async execute(): Promise<ToolResult> {
        return { success: true, content: 'async result' };
      },
    };
    registry.register(asyncTool);

    const result = await executor.execute({
      toolName: 'asyncTool',
      args: { arg1: 'value1' },
      ctx: mockCtx,
      async: true,
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain('Async task queued');
    expect(result.content).toContain('mock-task-id-123');
    expect(result.metadata).toEqual({ taskId: 'mock-task-id-123', async: true });
    expect(mockTaskSystem.scheduleTool).toHaveBeenCalledWith(
      'asyncTool',
      expect.any(Function),
      'test-claw'
    );
  });

  it('should execute synchronously when async is false', async () => {
    const syncTool: ITool = {
      name: 'syncTool',
      description: 'Regular sync tool',
      schema: { type: 'object', properties: {} },
      requiredPermissions: [],
      readonly: false,
      idempotent: false,
      async execute(): Promise<ToolResult> {
        return { success: true, content: 'sync result' };
      },
    };
    registry.register(syncTool);

    const result = await executor.execute({
      toolName: 'syncTool',
      args: {},
      ctx: mockCtx,
      async: false,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('sync result');
    expect(mockTaskSystem.scheduleTool).not.toHaveBeenCalled();
  });
});
