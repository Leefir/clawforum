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
      ? {
          scheduleSubAgent: vi.fn().mockImplementation(mockSchedule),
          addTaskResultHandler: vi.fn().mockReturnValue(() => {}),  // 返回 no-op cleanup
        }
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
    const result = await tool.execute({ goal: 'do something' }, ctx);

    expect(result.success).toBe(false);
    expect(result.content).toContain('recursion');
  });

  it('should allow dispatch when callerType is claw', async () => {
    const mockSchedule = vi.fn().mockResolvedValue('task-123');
    const ctx = makeCtx('claw', mockSchedule);
    const result = await tool.execute({ goal: 'do something' }, ctx);

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
    const result = await tool.execute({ goal: 'generate report' }, ctx);

    expect(result.success).toBe(true);
    expect(result.content).toContain('task-abc');
  });

  it('should succeed without dispatch-skills directory', async () => {
    const mockSchedule = vi.fn().mockResolvedValue('task-xyz');
    const ctx = makeCtx('claw', mockSchedule);
    const result = await tool.execute({ goal: 'some task' }, ctx);

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

      await tool.execute({ goal: 'follow up' }, ctx);

      expect(mockSchedule).toHaveBeenCalled();
      const call = mockSchedule.mock.calls[0][0];
      // messages contains only dialog history; userMessage is passed separately via prompt
      expect(call.messages).toBeDefined();
      expect(call.messages.length).toBe(2);
      expect(call.messages[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(call.messages[1]).toEqual({ role: 'assistant', content: 'Hi there' });
      // userMessage is in prompt field, SubAgent appends it to messages before LLM call
      expect(call.prompt).toContain('follow up');
    });

    it('should send only task prompt when ctx.dialogMessages is undefined', async () => {
      const mockSchedule = vi.fn().mockResolvedValue('task-single');
      const ctx = makeCtx('claw', mockSchedule);

      await tool.execute({ goal: 'standalone task' }, ctx);

      expect(mockSchedule).toHaveBeenCalled();
      const call = mockSchedule.mock.calls[0][0];
      // no dialog history, messages is empty; userMessage is in prompt
      expect(call.messages).toBeDefined();
      expect(call.messages.length).toBe(0);
      expect(call.prompt).toContain('standalone task');
    });
  });

  describe('originClawId propagation', () => {
    it('should pass originClawId=motion when Motion calls dispatch', async () => {
      const mockSchedule = vi.fn().mockResolvedValue('task-motion');
      // Motion 调用：clawId='motion', originClawId=undefined
      const ctx = makeCtx('claw', mockSchedule, { clawId: 'motion' });

      await tool.execute({ goal: 'do something' }, ctx);

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

      await tool.execute({ goal: 'nested dispatch' }, ctx);

      expect(mockSchedule).toHaveBeenCalled();
      // 应该继承，不被覆盖
      expect(mockSchedule.mock.calls[0][0].originClawId).toBe('motion');
    });

    it('should use clawId as originClawId when originClawId not set', async () => {
      const mockSchedule = vi.fn().mockResolvedValue('task-claw');
      // claw 调用：clawId='claw1', originClawId=undefined
      const ctx = makeCtx('claw', mockSchedule, { clawId: 'claw1' });

      await tool.execute({ goal: 'claw task' }, ctx);

      expect(mockSchedule).toHaveBeenCalled();
      // 应该使用 clawId 作为 originClawId
      expect(mockSchedule.mock.calls[0][0].originClawId).toBe('claw1');
    });
  });

  describe('CONTRACT_DONE handler', () => {
    function makeCtxWithMonitor(monitorLog: ReturnType<typeof vi.fn>) {
      let capturedHandler: ((taskId: string, callerType: string, result: string, isError: boolean) => Promise<string>) | null = null;
      const taskSystem = {
        scheduleSubAgent: vi.fn().mockResolvedValue('task-handler-test'),
        addTaskResultHandler: vi.fn().mockImplementation((handler: any) => {
          capturedHandler = handler;
          return () => {};
        }),
      };
      const ctx = new ExecContextImpl({
        clawId: 'test-claw',
        clawDir: tempDir,
        profile: 'full',
        callerType: 'claw',
        fs: mockFs,
        taskSystem: taskSystem as any,
        monitor: { log: monitorLog } as any,
      });
      return { ctx, taskSystem, getHandler: () => capturedHandler };
    }

    it('should warn when dispatcher finishes without [CONTRACT_DONE] block', async () => {
      const monitorLog = vi.fn();
      const { ctx, getHandler } = makeCtxWithMonitor(monitorLog);

      await tool.execute({ goal: 'test task' }, ctx);

      const handler = getHandler();
      expect(handler).not.toBeNull();

      await handler!('task-handler-test', 'dispatcher', 'Dispatcher finished with no marker.', false);

      expect(monitorLog).toHaveBeenCalledWith('warn', expect.objectContaining({
        context: 'dispatch.contractDoneNotFound',
      }));
    });

    it('should warn when [CONTRACT_DONE] parsed but fields missing', async () => {
      const monitorLog = vi.fn();
      const { ctx, getHandler } = makeCtxWithMonitor(monitorLog);

      await tool.execute({ goal: 'test task' }, ctx);

      const handler = getHandler();
      await handler!(
        'task-handler-test',
        'dispatcher',
        'Done.\n[CONTRACT_DONE]{"targetClaw":"my-claw"}[/CONTRACT_DONE]',
        false,
      );

      expect(monitorLog).toHaveBeenCalledWith('warn', expect.objectContaining({
        context: 'dispatch.contractDoneMissingFields',
      }));
    });

    it('should write by-contract file and return summary on valid [CONTRACT_DONE]', async () => {
      const monitorLog = vi.fn();
      const { ctx, getHandler } = makeCtxWithMonitor(monitorLog);

      await tool.execute({ goal: 'test task' }, ctx);

      const handler = getHandler();
      const resultText = 'Work done.\n[CONTRACT_DONE]{"contractId":"c-001","targetClaw":"my-claw"}[/CONTRACT_DONE]';
      const summary = await handler!('task-handler-test', 'dispatcher', resultText, false);

      // by-contract 文件写入
      const byContractPath = path.join(
        tempDir, 'clawspace', 'pending-retrospective', 'by-contract', 'c-001.json',
      );
      const raw = JSON.parse(await fs.readFile(byContractPath, 'utf-8'));
      expect(raw.contractId).toBe('c-001');
      expect(raw.targetClaw).toBe('my-claw');
      expect(raw.dispatcherTaskId).toBe('task-handler-test');

      // 摘要不含 CONTRACT_DONE 块
      expect(summary).not.toContain('[CONTRACT_DONE]');
      expect(summary).toContain('Work done.');

      // 无 warn 日志
      expect(monitorLog).not.toHaveBeenCalledWith('warn', expect.anything());
    });
  });
});
