/**
 * ContractManager 测试 - 状态转换
 * 
 * 注意：这些测试使用真实文件系统
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ContractManager } from '../../src/core/contract/manager.js';
import { NodeFileSystem } from '../../src/foundation/fs/node-fs.js';

const TEST_DIR = '.test-contract-manager';

describe('ContractManager', () => {
  let manager: ContractManager;
  let nodeFs: NodeFileSystem;

  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(path.join(TEST_DIR, 'claws', 'test-claw', 'contract'), { recursive: true });
    nodeFs = new NodeFileSystem(TEST_DIR);
    manager = new ContractManager(nodeFs, TEST_DIR, 'test-claw', undefined);
  });

  it('should create contract with pending subtasks', async () => {
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
    expect(progress.status).toBe('pending');
    expect(progress.subtasks[0].status).toBe('pending');
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
