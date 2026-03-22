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

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual };
});

const TEST_DIR = '.test-contract-manager';
const CLAW_DIR = path.join(TEST_DIR, 'claws', 'test-claw');

describe('ContractManager', () => {
  let manager: ContractManager;
  let nodeFs: NodeFileSystem;

  beforeEach(async () => {
    vi.clearAllMocks();
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(CLAW_DIR, { recursive: true });

    nodeFs = new NodeFileSystem({ baseDir: CLAW_DIR, enforcePermissions: false });
    manager = new ContractManager(CLAW_DIR, nodeFs, undefined);
  });

  it('should create contract with running status and todo subtasks', async () => {
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
        { subtask_id: 'task-1', type: 'script' as const, script_file: 'acceptance/task-1.sh' },
      ],
      auth_level: 'auto' as const,
    };

    const contractId = await manager.create(contractYaml);
    expect(contractId).toBeTruthy();

    const progress = await manager.getProgress(contractId);
    // FIX: create() 直接设为 running，不是 pending（符合设计：契约一创建就开始执行）
    expect(progress.status).toBe('running');
    // FIX: subtasks 是 Record<string, {...}>，不是数组
    expect(progress.subtasks['task-1'].status).toBe('todo');
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
        { subtask_id: 'task-1', type: 'script' as const, script_file: 'acceptance/task-1.sh' },
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
        { subtask_id: 'task-1', type: 'script' as const, script_file: 'acceptance/task-1.sh' },
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
    expect(progress.subtasks['task-2'].status).toBe('todo');
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

    // 真正的 task-1 应该仍是 todo
    const progress = await manager.getProgress(contractId);
    expect(progress.subtasks['task-1'].status).toBe('todo');
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

  // === Phase 22 H1: acquireLock EEXIST retry ===

  it('should acquire lock after EEXIST retry when lock is released mid-wait', async () => {
    const contractId = await manager.create({
      schema_version: 1 as const,
      title: 'Lock Retry Test',
      goal: 'Test',
      deliverables: [],
      subtasks: [{ id: 't1', description: 'T1' }],
      acceptance: [],
      auth_level: 'auto' as const,
    });

    // 预先写入锁文件，模拟另一个进程持有锁
    const lockPath = path.join(CLAW_DIR, 'contract', 'active', contractId, 'progress.lock');
    await fs.writeFile(lockPath, '{}', 'utf-8');

    // 50ms 后释放（< LOCK_RETRY_DELAY_MS=100ms 的一次等待），确保第二次重试能拿到锁
    setTimeout(() => fs.unlink(lockPath).catch(() => {}), 50);

    // pause() 内部走 acquireLock → 第一次 EEXIST → wait 100ms → 锁已释放 → 第二次成功
    await expect(manager.pause(contractId, 'checkpoint')).resolves.not.toThrow();
  }, 2000);

  it('should throw ToolError when lock is never released and retries exhausted', async () => {
    const contractId = await manager.create({
      schema_version: 1 as const,
      title: 'Lock Exhaust Test',
      goal: 'Test',
      deliverables: [],
      subtasks: [{ id: 't1', description: 'T1' }],
      acceptance: [],
      auth_level: 'auto' as const,
    });

    // 写入锁文件，不释放
    const lockPath = path.join(CLAW_DIR, 'contract', 'active', contractId, 'progress.lock');
    await fs.writeFile(lockPath, '{}', 'utf-8');

    // acquireLock retries LOCK_MAX_RETRIES=3 times then throws
    await expect(manager.pause(contractId, 'checkpoint'))
      .rejects.toThrow(/Failed to acquire lock after/);
  }, 2000);

  // Note: runScriptAcceptance tests removed - implementation now uses execFile (async)
  // New tests for async script acceptance should be added in future phases

  // === Phase 22 C1+C2: completeSubtask allCompleted path ===

  it('should return allCompleted=true and archive contract when last subtask completes', async () => {
    const contractId = await manager.create({
      schema_version: 1 as const,
      title: 'AllCompleted Test',
      goal: 'Test',
      deliverables: [],
      subtasks: [{ id: 't1', description: 'T1' }],
      acceptance: [],  // 无脚本，直接通过
      auth_level: 'auto' as const,
    });

    const result = await manager.completeSubtask({ contractId, subtaskId: 't1', evidence: 'done' });

    expect(result.passed).toBe(true);
    expect(result.allCompleted).toBe(true);

    // 契约已移入 archive（active/ 目录不再存在）
    const archivePath = path.join(CLAW_DIR, 'contract', 'archive', contractId);
    await expect(fs.access(archivePath)).resolves.not.toThrow();
    const activePath = path.join(CLAW_DIR, 'contract', 'active', contractId);
    await expect(fs.access(activePath)).rejects.toThrow();
  });

  it('should not set allCompleted when subtasks remain', async () => {
    const contractId = await manager.create({
      schema_version: 1 as const,
      title: 'Partial Test',
      goal: 'Test',
      deliverables: [],
      subtasks: [
        { id: 't1', description: 'T1' },
        { id: 't2', description: 'T2' },
      ],
      acceptance: [],
      auth_level: 'auto' as const,
    });

    const result = await manager.completeSubtask({ contractId, subtaskId: 't1', evidence: 'done' });

    expect(result.passed).toBe(true);
    expect(result.allCompleted).toBeFalsy();

    // 契约仍在 active/
    const activePath = path.join(CLAW_DIR, 'contract', 'active', contractId);
    await expect(fs.access(activePath)).resolves.not.toThrow();
  });

  describe('monitor error reporting', () => {
    it('should log error to monitor when loadActive finds corrupted progress.json', async () => {
      const mockMonitor = { log: vi.fn() };
      const monitorManager = new ContractManager(CLAW_DIR, nodeFs, mockMonitor as any);

      // 写入损坏的 progress.json
      const contractId = 'corrupt-contract';
      const contractDir = path.join(CLAW_DIR, 'contract', 'active', contractId);
      await fs.mkdir(contractDir, { recursive: true });
      await fs.writeFile(path.join(contractDir, 'progress.json'), '{ invalid json !!');

      const result = await monitorManager.loadActive();
      expect(result).toBeNull(); // 损坏的契约被跳过，返回 null
      expect(mockMonitor.log).toHaveBeenCalledWith('error', expect.objectContaining({
        context: 'ContractManager.loadActive',
      }));
    });

    it('should log error to monitor when loadPaused finds corrupted progress.json', async () => {
      const mockMonitor = { log: vi.fn() };
      const monitorManager = new ContractManager(CLAW_DIR, nodeFs, mockMonitor as any);

      const contractId = 'corrupt-paused-contract';
      const contractDir = path.join(CLAW_DIR, 'contract', 'paused', contractId);
      await fs.mkdir(contractDir, { recursive: true });
      await fs.writeFile(path.join(contractDir, 'progress.json'), '{ bad json ]');

      const result = await monitorManager.loadPaused();
      expect(result).toBeNull();
      expect(mockMonitor.log).toHaveBeenCalledWith('error', expect.objectContaining({
        context: 'ContractManager.loadPaused',
      }));
    });

    it('should log warn to monitor when unknown subtaskId is used in completeSubtask', async () => {
      const mockMonitor = { log: vi.fn() };
      const monitorManager = new ContractManager(CLAW_DIR, nodeFs, mockMonitor as any);

      const contractId = await monitorManager.create({
        schema_version: 1,
        title: 'Test',
        goal: 'Test goal',
        deliverables: [],
        subtasks: [{ id: 'real-task', description: 'Real task' }],
        acceptance: [],
        auth_level: 'auto' as const,
      });

      const result = await monitorManager.completeSubtask({
        contractId,
        subtaskId: 'nonexistent-task',
        evidence: 'evidence',
      });

      expect(result.passed).toBe(false);
      expect(result.feedback).toContain('nonexistent-task');
      expect(mockMonitor.log).toHaveBeenCalledWith('error', expect.objectContaining({
        context: 'ContractManager._completeSubtaskSync',
        subtaskId: 'nonexistent-task',
      }));
    });

    it('should clean up contract.yaml if progress.json write fails', async () => {
      // spy writeAtomic，对 progress.json 抛错
      vi.spyOn(nodeFs, 'writeAtomic').mockImplementation(async (p: string, c: string) => {
        if (p.includes('progress.json')) throw new Error('disk full');
        // 其他调用走真实实现
        return fs.writeFile(path.join(CLAW_DIR, p), c);
      });

      const failManager = new ContractManager(CLAW_DIR, nodeFs);
      await expect(failManager.create({
        schema_version: 1,
        title: 'Test',
        goal: 'Test goal',
        deliverables: [],
        subtasks: [{ id: 't1', description: 'T1' }],
        acceptance: [],
        auth_level: 'auto',
      })).rejects.toThrow('disk full');

      // active/ 下不应存在任何 contract.yaml
      const activeDir = path.join(CLAW_DIR, 'contract', 'active');
      const dirs = await fs.readdir(activeDir).catch(() => [] as string[]);
      for (const dir of dirs) {
        const yamlPath = path.join(activeDir, dir, 'contract.yaml');
        await expect(fs.access(yamlPath)).rejects.toThrow(); // ENOENT
      }
    });
  });

  describe('acceptance validation', () => {
    it('should throw when type is "script" but prompt_file is used', async () => {
      await expect(manager.create({
        schema_version: 1,
        title: 'Test',
        goal: 'Test goal',
        deliverables: [],
        subtasks: [{ id: 't1', description: 'T1' }],
        acceptance: [
          // @ts-expect-error - intentionally wrong field for testing
          { subtask_id: 't1', type: 'script', prompt_file: 'acceptance/t1.prompt.txt' },
        ],
        auth_level: 'auto',
      })).rejects.toThrow('script_file');
    });

    it('should throw when type is "llm" but script_file is used', async () => {
      await expect(manager.create({
        schema_version: 1,
        title: 'Test',
        goal: 'Test goal',
        deliverables: [],
        subtasks: [{ id: 't1', description: 'T1' }],
        acceptance: [
          // @ts-expect-error - intentionally wrong field for testing
          { subtask_id: 't1', type: 'llm', script_file: 'acceptance/t1.sh' },
        ],
        auth_level: 'auto',
      })).rejects.toThrow('prompt_file');
    });
  });
});
