/**
 * ContractManager 测试 - 状态转换
 * 
 * 构造函数: new ContractManager(clawDir, fs, monitor?)
 * 
 * 新增测试：
 * - loadActive() 按 started_at 排序
 * - 状态验证错误 (pause/resume/cancel)
 * - completeSubtask 覆盖
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ContractManager } from '../../src/core/contract/manager.js';
import { NodeFileSystem } from '../../src/foundation/fs/node-fs.js';

const TEST_DIR = '.test-contract-manager';
const CLAW_DIR = path.join(TEST_DIR, 'claws', 'test-claw');

describe('ContractManager', () => {
  let manager: ContractManager;
  let nodeFs: NodeFileSystem;

  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(CLAW_DIR, { recursive: true });
    
    nodeFs = new NodeFileSystem({ baseDir: CLAW_DIR, enforcePermissions: false });
    manager = new ContractManager(CLAW_DIR, nodeFs, undefined);
  });

  it('should create contract with running status and pending subtasks', async () => {
    // Note: create() 创建契约后立即设为 running 状态（manager.ts:141）
    const contractYaml = {
      schema_version: 1 as const,
      title: 'Test Contract',
      goal: 'Test goal',
      deliverables: ['clawspace/test.txt'],
      subtasks: [
        { id: 'task-1', description: 'Task 1' },
      ],
      acceptance: [
        { subtask_id: 'task-1', type: 'script' as const, command: 'test -f clawspace/test.txt' },
      ],
      auth_level: 'auto' as const,
    };

    const contractId = await manager.create(contractYaml);
    expect(contractId).toBeTruthy();

    const progress = await manager.getProgress(contractId);
    // FIX: create() 直接设为 running，不是 pending（符合设计：契约一创建就开始执行）
    expect(progress.status).toBe('running');
    // FIX: subtasks 是 Record<string, {...}>，不是数组
    expect(progress.subtasks['task-1'].status).toBe('pending');
  });

  it('should pause and resume contract', async () => {
    const contractYaml = {
      schema_version: 1 as const,
      title: 'Test Contract',
      goal: 'Test goal',
      deliverables: ['clawspace/test.txt'],
      subtasks: [
        { id: 'task-1', description: 'Task 1' },
      ],
      acceptance: [
        { subtask_id: 'task-1', type: 'script' as const, command: 'test -f clawspace/test.txt' },
      ],
      auth_level: 'auto' as const,
    };

    const contractId = await manager.create(contractYaml);
    
    // Pause
    await manager.pause(contractId, 'Test pause');
    let progress = await manager.getProgress(contractId);
    expect(progress.status).toBe('paused');

    // Resume
    await manager.resume(contractId);
    progress = await manager.getProgress(contractId);
    expect(progress.status).toBe('running');
  });

  it('should cancel contract', async () => {
    const contractYaml = {
      schema_version: 1 as const,
      title: 'Test Contract',
      goal: 'Test goal',
      deliverables: ['clawspace/test.txt'],
      subtasks: [
        { id: 'task-1', description: 'Task 1' },
      ],
      acceptance: [
        { subtask_id: 'task-1', type: 'script' as const, command: 'test -f clawspace/test.txt' },
      ],
      auth_level: 'auto' as const,
    };

    const contractId = await manager.create(contractYaml);
    await manager.cancel(contractId, 'Test cancel');

    const progress = await manager.getProgress(contractId);
    expect(progress.status).toBe('cancelled');
  });

  // === 新增测试：状态转换验证 ===
  
  it('should throw when pausing non-running contract', async () => {
    const contractYaml = {
      schema_version: 1 as const,
      title: 'Test',
      goal: 'Test',
      deliverables: [],
      subtasks: [{ id: 't1', description: 'T1' }],
      acceptance: [],
      auth_level: 'auto' as const,
    };

    const contractId = await manager.create(contractYaml);
    await manager.pause(contractId, 'First pause');
    
    // 第二次 pause 应该抛错
    await expect(manager.pause(contractId, 'Second pause')).rejects.toThrow('Cannot pause');
  });

  it('should throw when resuming non-paused contract', async () => {
    const contractYaml = {
      schema_version: 1 as const,
      title: 'Test',
      goal: 'Test',
      deliverables: [],
      subtasks: [{ id: 't1', description: 'T1' }],
      acceptance: [],
      auth_level: 'auto' as const,
    };

    const contractId = await manager.create(contractYaml);
    // running 状态不能 resume
    await expect(manager.resume(contractId)).rejects.toThrow('Cannot resume');
  });

  it('should throw when cancelling already completed contract', async () => {
    const contractYaml = {
      schema_version: 1 as const,
      title: 'Test',
      goal: 'Test',
      deliverables: [],
      subtasks: [{ id: 't1', description: 'T1' }],
      acceptance: [],
      auth_level: 'auto' as const,
    };

    const contractId = await manager.create(contractYaml);
    await manager.cancel(contractId, 'Cancel');
    
    // 再次 cancel 应该抛错
    await expect(manager.cancel(contractId, 'Cancel again')).rejects.toThrow('Cannot cancel');
  });

  // === 新增测试：loadActive 返回最新的 running 契约 ===
  
  it('should loadActive return latest running contract by started_at', async () => {
    // 创建第一个契约
    const contract1 = await manager.create({
      schema_version: 1 as const,
      title: 'First',
      goal: 'First',
      deliverables: [],
      subtasks: [{ id: 't1', description: 'T1' }],
      acceptance: [],
      auth_level: 'auto' as const,
    });
    
    // 稍微等待确保时间戳不同
    await new Promise(r => setTimeout(r, 50));
    
    // 创建第二个契约（会自动归档第一个）
    const contract2 = await manager.create({
      schema_version: 1 as const,
      title: 'Second',
      goal: 'Second',
      deliverables: [],
      subtasks: [{ id: 't2', description: 'T2' }],
      acceptance: [],
      auth_level: 'auto' as const,
    });

    // loadActive 应该返回最新的（第二个），第一个已被归档
    const active = await manager.loadActive();
    expect(active).toBeTruthy();
    expect(active?.id).toBe(contract2);
    
    // 验证第一个已被归档
    const progress1 = await manager.getProgress(contract1);
    expect(progress1.status).toBe('running'); // status 不变，但位置在 archive/
  });

  it('should create() auto-archive existing running contract', async () => {
    const contract1 = await manager.create({
      schema_version: 1 as const,
      title: 'First',
      goal: 'First',
      deliverables: [],
      subtasks: [{ id: 't1', description: 'T1' }],
      acceptance: [],
      auth_level: 'auto' as const,
    });

    // 创建第二个，第一个应该被归档（不是暂停）
    const contract2 = await manager.create({
      schema_version: 1 as const,
      title: 'Second',
      goal: 'Second',
      deliverables: [],
      subtasks: [{ id: 't2', description: 'T2' }],
      acceptance: [],
      auth_level: 'auto' as const,
    });

    // 第一个被归档（status 仍为 running，但不在 active/）
    const progress1 = await manager.getProgress(contract1);
    expect(progress1.status).toBe('running');
    
    // 第二个是当前的 active
    const progress2 = await manager.getProgress(contract2);
    expect(progress2.status).toBe('running');
    
    // loadActive 只返回第二个
    const active = await manager.loadActive();
    expect(active?.id).toBe(contract2);
  });

  // === 新增测试：completeSubtask 覆盖 ===

  it('should complete subtask and update status', async () => {
    const contractYaml = {
      schema_version: 1 as const,
      title: 'Test',
      goal: 'Test',
      deliverables: [],
      subtasks: [
        { id: 'task-1', description: 'Task 1' },
        { id: 'task-2', description: 'Task 2' },
      ],
      acceptance: [],
      auth_level: 'auto' as const,
    };
    const contractId = await manager.create(contractYaml);
    expect(contractId).toBeTruthy();

    await manager.completeSubtask({ contractId, subtaskId: 'task-1', evidence: 'Task completed' });

    const progress = await manager.getProgress(contractId);
    expect(progress.subtasks['task-1'].status).toBe('completed');
    expect(progress.subtasks['task-2'].status).toBe('pending');
  });

  it('should reject unknown subtaskId in completeSubtask with valid IDs', async () => {
    const contractYaml = {
      schema_version: 1 as const,
      title: 'Test',
      goal: 'Test',
      deliverables: [],
      subtasks: [{ id: 'task-1', description: 'Task 1' }],
      acceptance: [],
      auth_level: 'auto' as const,
    };
    const contractId = await manager.create(contractYaml);
    expect(contractId).toBeTruthy();

    // 尝试完成不存在的子任务
    const result = await manager.completeSubtask({ 
      contractId, 
      subtaskId: 'unknown-task', 
      evidence: 'Test' 
    });

    // 应该返回失败，并包含有效 ID 列表
    expect(result.passed).toBe(false);
    expect(result.feedback).toContain('Unknown subtask');
    expect(result.feedback).toContain('task-1');

    // 真正的 task-1 应该仍是 pending
    const progress = await manager.getProgress(contractId);
    expect(progress.subtasks['task-1'].status).toBe('pending');
  });

  it('should mark contract completed when all subtasks done', async () => {
    const contractYaml = {
      schema_version: 1 as const,
      title: 'Test',
      goal: 'Test',
      deliverables: [],
      subtasks: [
        { id: 'task-1', description: 'Task 1' },
        { id: 'task-2', description: 'Task 2' },
      ],
      acceptance: [],
      auth_level: 'auto' as const,
    };
    const contractId = await manager.create(contractYaml);
    expect(contractId).toBeTruthy();

    // 完成所有子任务
    await manager.completeSubtask({ contractId, subtaskId: 'task-1', evidence: 'Task 1 done' });
    await manager.completeSubtask({ contractId, subtaskId: 'task-2', evidence: 'Task 2 done' });

    const progress = await manager.getProgress(contractId);
    expect(progress.status).toBe('completed');
  });

  it('should throw state validation errors with correct message', async () => {
    const contractId = await manager.create({
      schema_version: 1 as const,
      title: 'Test',
      goal: 'Test',
      deliverables: [],
      subtasks: [{ id: 't1', description: 'T1' }],
      acceptance: [],
      auth_level: 'auto' as const,
    });

    // cancel 后不应该能 pause
    await manager.cancel(contractId, 'Cancelled');
    await expect(manager.pause(contractId, 'Try pause')).rejects.toThrow('Cannot pause');
  });

  // === 新增测试：损坏 progress.json 抛出 ToolError ===

  it('should throw ToolError when progress.json is corrupted', async () => {
    const contractYaml = {
      schema_version: 1 as const,
      title: 'Test',
      goal: 'Test',
      deliverables: [],
      subtasks: [{ id: 't1', description: 'T1' }],
      acceptance: [],
      auth_level: 'auto' as const,
    };
    const contractId = await manager.create(contractYaml);
    expect(contractId).toBeTruthy();

    // 手动损坏 progress.json（create() 创建在 active/ 子目录下）
    const progressPath = path.join(CLAW_DIR, 'contract', 'active', contractId, 'progress.json');
    await fs.writeFile(progressPath, '{ broken json', 'utf-8');

    // 应该抛出包含解析错误的 ToolError
    await expect(manager.getProgress(contractId)).rejects.toThrow(/parse|JSON|Unexpected token/i);
  });
});
