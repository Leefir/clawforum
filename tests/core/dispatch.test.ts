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
import type { Message } from '../../src/types/message.js';

async function createTempDir(): Promise<string> {
  const d = path.join(tmpdir(), `dispatch-test-${randomUUID()}`);
  await fs.mkdir(d, { recursive: true });
  return d;
}

describe('DispatchTool', () => {
  let tempDir: string;
  let mockFs: NodeFileSystem;
  let tool: DispatchTool;

  beforeEach(async () => {
    tempDir = await createTempDir();
    mockFs = new NodeFileSystem({ baseDir: tempDir, enforcePermissions: false });
    tool = new DispatchTool(
      async () => 'mock system prompt',
      () => [{ name: 'mock_tool', description: 'Mock tool', input_schema: { type: 'object' } }],
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  function makeCtx(callerType: 'claw' | 'subagent' | 'dispatcher', mockSchedule?: () => Promise<string>, options?: { originClawId?: string; clawId?: string; dialogMessages?: Message[] }) {
    const taskSystem = mockSchedule
      ? { scheduleSubAgent: vi.fn().mockImplementation(mockSchedule) }
      : undefined;
    return new ExecContextImpl({
      clawId: options?.clawId ?? 'test-claw',
      clawDir: tempDir,
      profile: 'full',
      callerType,
      fs: mockFs,
      taskSystem: taskSystem as any,
      originClawId: options?.originClawId,
      dialogMessages: options?.dialogMessages,
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

  describe('dialogMessages', () => {
    it('should include dialogMessages in dispatcherMessages when ctx.dialogMessages is set', async () => {
      const dialogMessages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ];
      const mockSchedule = vi.fn().mockResolvedValue('task-dialog');
      const ctx = makeCtx('claw', mockSchedule, { dialogMessages });

      await tool.execute({ task: 'follow up' }, ctx);

      expect(mockSchedule).toHaveBeenCalled();
      const passedMessages = mockSchedule.mock.calls[0][0].messages;
      expect(passedMessages).toBeDefined();
      expect(passedMessages.length).toBe(3); // 2 dialog + 1 task prompt
      expect(passedMessages[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(passedMessages[1]).toEqual({ role: 'assistant', content: 'Hi there' });
      expect(passedMessages[2].role).toBe('user');
      expect(passedMessages[2].content).toContain('follow up');
    });

    it('should send only task prompt when ctx.dialogMessages is undefined', async () => {
      const mockSchedule = vi.fn().mockResolvedValue('task-single');
      const ctx = makeCtx('claw', mockSchedule);

      await tool.execute({ task: 'standalone task' }, ctx);

      expect(mockSchedule).toHaveBeenCalled();
      const passedMessages = mockSchedule.mock.calls[0][0].messages;
      expect(passedMessages).toBeDefined();
      expect(passedMessages.length).toBe(1);
      expect(passedMessages[0].role).toBe('user');
      expect(passedMessages[0].content).toContain('standalone task');
    });
  });

  describe('originClawId propagation', () => {
    it('should pass originClawId=motion when Motion calls dispatch', async () => {
      const mockSchedule = vi.fn().mockResolvedValue('task-motion');
      // Motion 调用：clawId='motion', originClawId=undefined
      const ctx = makeCtx('claw', mockSchedule, { clawId: 'motion' });

      await tool.execute({ task: 'do something' }, ctx);

      expect(mockSchedule).toHaveBeenCalled();
      expect(mockSchedule.mock.calls[0][0].originClawId).toBe('motion');
    });

    it('should inherit originClawId when originClawId already set', async () => {
      const mockSchedule = vi.fn().mockResolvedValue('task-inherit');
      // 模拟 subagent with full profile，已有 originClawId='motion'
      const ctx = makeCtx('claw', mockSchedule, { 
        clawId: 'task-uuid', 
        originClawId: 'motion' 
      });

      await tool.execute({ task: 'nested dispatch' }, ctx);

      expect(mockSchedule).toHaveBeenCalled();
      // 应该继承，不被覆盖
      expect(mockSchedule.mock.calls[0][0].originClawId).toBe('motion');
    });

    it('should use clawId as originClawId when originClawId not set', async () => {
      const mockSchedule = vi.fn().mockResolvedValue('task-claw');
      // claw 调用：clawId='claw1', originClawId=undefined
      const ctx = makeCtx('claw', mockSchedule, { clawId: 'claw1' });

      await tool.execute({ task: 'claw task' }, ctx);

      expect(mockSchedule).toHaveBeenCalled();
      // 应该使用 clawId 作为 originClawId
      expect(mockSchedule.mock.calls[0][0].originClawId).toBe('claw1');
    });
  });
});
