/**
 * done tool 测试 — allCompleted 分支 (Phase 22 C1+C2)
 *
 * 测试 done.ts 中：
 * - result.allCompleted=true → "All subtasks complete!" (不再查 loadActive)
 * - result.allCompleted=false → 显示剩余列表
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { doneTool } from '../../src/core/tools/builtins/done.js';
import { ContractManager } from '../../src/core/contract/manager.js';
import { NodeFileSystem } from '../../src/foundation/fs/node-fs.js';

const TEST_DIR = '.test-done-tool';
const CLAW_DIR = path.join(TEST_DIR, 'claws', 'test-claw');

/** 最小 ExecContext，只注入 contractManager */
function makeCtx(contractManager: ContractManager) {
  return {
    clawId: 'test-claw',
    clawDir: CLAW_DIR,
    contractManager,
  } as any;
}

describe('doneTool', () => {
  let manager: ContractManager;
  let nodeFs: NodeFileSystem;

  beforeEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(CLAW_DIR, { recursive: true });
    nodeFs = new NodeFileSystem({ baseDir: CLAW_DIR, enforcePermissions: false });
    manager = new ContractManager(CLAW_DIR, nodeFs, undefined);
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
  });

  it('should return "All subtasks complete!" when last subtask accepted', async () => {
    // 单子任务契约，无 acceptance 脚本 → 直接通过
    await manager.create({
      schema_version: 1 as const,
      title: 'Single Task Contract',
      goal: 'Test',
      deliverables: [],
      subtasks: [{ id: 't1', description: 'Task One' }],
      acceptance: [],
      auth_level: 'auto' as const,
    });

    const ctx = makeCtx(manager);
    const result = await doneTool.execute({ subtask: 't1', evidence: 'done' }, ctx);

    expect(result.success).toBe(true);
    expect(result.content).toContain('All subtasks complete!');
  });

  it('should show remaining subtask list (not allCompleted) when subtasks remain', async () => {
    await manager.create({
      schema_version: 1 as const,
      title: 'Multi Task Contract',
      goal: 'Test',
      deliverables: [],
      subtasks: [
        { id: 't1', description: 'Task One' },
        { id: 't2', description: 'Task Two' },
      ],
      acceptance: [],
      auth_level: 'auto' as const,
    });

    const ctx = makeCtx(manager);
    const result = await doneTool.execute({ subtask: 't1', evidence: 'done' }, ctx);

    expect(result.success).toBe(true);
    expect(result.content).not.toContain('All subtasks complete!');
    // 剩余任务列表应包含 t2
    expect(result.content).toContain('t2');
    expect(result.content).toContain('Task Two');
  });

  it('should return error when no contractManager in ctx', async () => {
    const result = await doneTool.execute({ subtask: 't1', evidence: 'done' }, {} as any);
    expect(result.success).toBe(false);
    expect(result.content).toContain('No contract manager');
  });

  it('should return error when no active contract', async () => {
    // ContractManager exists but no contract created
    const ctx = makeCtx(manager);
    const result = await doneTool.execute({ subtask: 't1', evidence: 'done' }, ctx);
    expect(result.success).toBe(false);
    expect(result.content).toContain('No active contract');
  });

  it('should return failure when subtaskId is unknown', async () => {
    await manager.create({
      schema_version: 1 as const,
      title: 'Test Contract',
      goal: 'Test',
      deliverables: [],
      subtasks: [{ id: 't1', description: 'Task One' }],
      acceptance: [],
      auth_level: 'auto' as const,
    });

    const ctx = makeCtx(manager);
    const result = await doneTool.execute({ subtask: 'nonexistent', evidence: 'done' }, ctx);

    expect(result.success).toBe(false);
    expect(result.content).toContain('rejected');
  });
});
