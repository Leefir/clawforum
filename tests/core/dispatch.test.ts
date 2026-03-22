/**
 * DispatchTool tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { DispatchTool } from '../../src/core/tools/builtins/dispatch.js';
import { ExecContextImpl } from '../../src/core/tools/context.js';
import { NodeFileSystem } from '../../src/foundation/fs/index.js';
import { ToolRegistry } from '../../src/core/tools/registry.js';

async function createTempDir(): Promise<string> {
  const d = path.join(tmpdir(), `dispatch-test-${randomUUID()}`);
  await fs.mkdir(d, { recursive: true });
  return d;
}

describe('DispatchTool', () => {
  let tempDir: string;
  let mockFs: NodeFileSystem;
  let registry: ToolRegistry;
  let tool: DispatchTool;

  beforeEach(async () => {
    tempDir = await createTempDir();
    mockFs = new NodeFileSystem({ baseDir: tempDir, enforcePermissions: false });
    registry = new ToolRegistry();
    tool = new DispatchTool(async () => 'mock system prompt', registry);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  function makeCtx(callerType: 'claw' | 'subagent' | 'dispatcher', mockSchedule?: () => Promise<string>) {
    const taskSystem = mockSchedule
      ? { scheduleSubAgent: vi.fn().mockImplementation(mockSchedule) }
      : undefined;
    return new ExecContextImpl({
      clawId: 'test-claw',
      clawDir: tempDir,
      profile: 'full',
      callerType,
      fs: mockFs,
      taskSystem: taskSystem as any,
    });
  }

  it('should reject dispatch when callerType is dispatcher (recursion prevention)', async () => {
    const ctx = makeCtx('dispatcher');
    const result = await tool.execute({ task: 'do something' }, ctx);

    expect(result.success).toBe(false);
    expect(result.content).toContain('recursion');
  });

  it('should allow dispatch when callerType is claw', async () => {
    const mockSchedule = vi.fn().mockResolvedValue('task-123');
    const ctx = makeCtx('claw', mockSchedule);
    const result = await tool.execute({ task: 'do something' }, ctx);

    expect(result.success).toBe(true);
    expect(result.content).toContain('task-123');
    expect(mockSchedule).toHaveBeenCalled();
  });

  it('should succeed when dispatch-skills directory exists', async () => {
    await fs.mkdir(path.join(tempDir, 'clawspace', 'dispatch-skills', 'gen-report'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'clawspace', 'dispatch-skills', 'gen-report', 'SKILL.md'),
      `---
name: gen-report
description: 生成分析报告
---
# Gen Report
Content.
`
    );

    const mockSchedule = vi.fn().mockResolvedValue('task-abc');
    const ctx = makeCtx('claw', mockSchedule);
    const result = await tool.execute({ task: 'generate report' }, ctx);

    expect(result.success).toBe(true);
    expect(result.content).toContain('task-abc');
  });

  it('should succeed without dispatch-skills directory', async () => {
    const mockSchedule = vi.fn().mockResolvedValue('task-xyz');
    const ctx = makeCtx('claw', mockSchedule);
    const result = await tool.execute({ task: 'some task' }, ctx);

    expect(result.success).toBe(true);
    expect(result.content).toContain('task-xyz');
  });
});
