/**
 * ContractManager 测试 - 状态转换
 * 
 * 构造函数: new ContractManager(clawDir, fs, monitor?)
 */
import { describe, it, expect, beforeEach } from 'vitest';
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
});
