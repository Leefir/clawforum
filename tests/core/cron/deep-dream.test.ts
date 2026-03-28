/**
 * deep-dream 测试
 *
 * 覆盖路径：
 * - 目录不存在 / 无 session 文件 → 提前返回
 * - 正常处理：调用 LLM 两次，生成 inbox 消息，更新 state
 * - Fix 1 回归：Call 2 不传 system prompt
 * - Fix 2 回归：空会话时 state 仍落盘
 * - 已处理文件不重复处理
 * - Call 2 失败时降级处理
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fsSync from 'fs';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { runDeepDream } from '../../../src/core/cron/jobs/deep-dream.js';
import type { LLMServiceConfig } from '../../../src/foundation/llm/types.js';

// ─── LLMService mock ──────────────────────────────────────────

const mockLlmCall = vi.fn();
const mockLlmClose = vi.fn();

vi.mock('../../../src/foundation/llm/service.js', () => ({
  LLMService: vi.fn(() => ({
    call: mockLlmCall,
    close: mockLlmClose,
  })),
}));

// ─── 工具函数 ─────────────────────────────────────────────────

function makeTextResponse(text: string) {
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn' };
}

function makeSessionJson(messages: Array<{ role: string; content: string }>) {
  return JSON.stringify({ messages });
}

async function createTempDir(): Promise<string> {
  const d = path.join(tmpdir(), `deep-dream-test-${randomUUID()}`);
  await fs.mkdir(d, { recursive: true });
  return d;
}

async function cleanupTempDir(d: string) {
  try { await fs.rm(d, { recursive: true, force: true }); } catch { /* ignore */ }
}

// LLMService 是 mock，config 字段无实际意义
const fakeLlmConfig: LLMServiceConfig = {
  primary: { name: 'test', apiKey: 'sk-test', model: 'claude-test' } as any,
};

// ─── 测试 ─────────────────────────────────────────────────────

describe('runDeepDream', () => {
  let clawforumDir: string;

  beforeEach(async () => {
    clawforumDir = await createTempDir();
    mockLlmCall.mockReset();
    mockLlmClose.mockReset();
    mockLlmCall.mockResolvedValue(makeTextResponse('dream output'));
  });

  afterEach(async () => {
    await cleanupTempDir(clawforumDir);
    vi.clearAllMocks();
  });

  // ── 无 claws 目录 ───────────────────────────────────────────

  it('claws 目录不存在时直接返回，不调用 LLM', async () => {
    await expect(runDeepDream({ clawforumDir, llmConfig: fakeLlmConfig })).resolves.toBeUndefined();
    expect(mockLlmCall).not.toHaveBeenCalled();
  });

  // ── 正常处理流程 ────────────────────────────────────────────

  describe('单个 claw 处理', () => {
    let clawDir: string;
    let archiveDir: string;

    beforeEach(async () => {
      clawDir = path.join(clawforumDir, 'claws', 'test-claw');
      archiveDir = path.join(clawDir, 'dialog', 'archive');
      await fs.mkdir(archiveDir, { recursive: true });
      await fs.mkdir(path.join(clawDir, 'inbox', 'pending'), { recursive: true });
    });

    it('无 session 文件时不调用 LLM', async () => {
      await runDeepDream({ clawforumDir, llmConfig: fakeLlmConfig });
      expect(mockLlmCall).not.toHaveBeenCalled();
    });

    it('处理单个 archive 文件：LLM 调用 2 次，生成 inbox 消息，更新 state', async () => {
      const session = makeSessionJson([
        { role: 'user', content: 'help me with the task' },
        { role: 'assistant', content: 'sure, let me help' },
      ]);
      const filename = `1000000000000_abcd1234.json`;
      await fs.writeFile(path.join(archiveDir, filename), session, 'utf-8');

      mockLlmCall
        .mockResolvedValueOnce(makeTextResponse('dream insight content'))
        .mockResolvedValueOnce(makeTextResponse('compressed summary'));

      await runDeepDream({ clawforumDir, llmConfig: fakeLlmConfig });

      // LLM 调用了两次（Call 1 梦境 + Call 2 压缩）
      expect(mockLlmCall).toHaveBeenCalledTimes(2);

      // state 已更新
      const statePath = path.join(clawDir, '.deep-dream-state.json');
      expect(fsSync.existsSync(statePath)).toBe(true);
      const state = JSON.parse(fsSync.readFileSync(statePath, 'utf-8'));
      expect(state.processedArchives).toContain(filename);

      // inbox 消息已写入
      const inboxDir = path.join(clawDir, 'inbox', 'pending');
      const files = fsSync.readdirSync(inboxDir);
      expect(files.some(f => f.includes('deep_dream'))).toBe(true);
    });

    // ── Fix 1 回归：Call 2 不传 system prompt ──────────────────

    it('Fix 1 回归：Call 1 携带 system prompt，Call 2 不携带', async () => {
      const session = makeSessionJson([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'world' },
      ]);
      await fs.writeFile(path.join(archiveDir, `1000000000001_abcd1234.json`), session, 'utf-8');

      mockLlmCall
        .mockResolvedValueOnce(makeTextResponse('dream'))
        .mockResolvedValueOnce(makeTextResponse('compressed'));

      await runDeepDream({ clawforumDir, llmConfig: fakeLlmConfig });

      expect(mockLlmCall).toHaveBeenCalledTimes(2);
      const call1Args = mockLlmCall.mock.calls[0][0] as Record<string, unknown>;
      const call2Args = mockLlmCall.mock.calls[1][0] as Record<string, unknown>;

      expect(call1Args.system).toBeDefined();     // Call 1 有 system prompt
      expect(call2Args.system).toBeUndefined();   // Call 2 无 system prompt（压缩任务）
    });

    // ── Fix 2 回归：空会话时 state 仍落盘 ──────────────────────

    it('Fix 2 回归：空会话 state 仍落盘，且不写 inbox 消息', async () => {
      const emptySession = JSON.stringify({ messages: [] });
      const filename = `1000000000002_abcd1234.json`;
      await fs.writeFile(path.join(archiveDir, filename), emptySession, 'utf-8');

      await runDeepDream({ clawforumDir, llmConfig: fakeLlmConfig });

      // 空会话无内容，不调用 LLM
      expect(mockLlmCall).not.toHaveBeenCalled();

      // state 必须落盘（Fix 2）
      const statePath = path.join(clawDir, '.deep-dream-state.json');
      expect(fsSync.existsSync(statePath)).toBe(true);
      const state = JSON.parse(fsSync.readFileSync(statePath, 'utf-8'));
      expect(state.processedArchives).toContain(filename);

      // 无 inbox 消息
      const inboxDir = path.join(clawDir, 'inbox', 'pending');
      const files = fsSync.readdirSync(inboxDir);
      expect(files.filter(f => f.includes('deep_dream'))).toHaveLength(0);
    });

    it('仅含 thinking/tool_use 块的会话视为空会话', async () => {
      const session = JSON.stringify({
        messages: [
          { role: 'assistant', content: [{ type: 'thinking', thinking: 'internal thought' }] },
          { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'read', input: {} }] },
        ],
      });
      const filename = `1000000000003_abcd1234.json`;
      await fs.writeFile(path.join(archiveDir, filename), session, 'utf-8');

      await runDeepDream({ clawforumDir, llmConfig: fakeLlmConfig });

      expect(mockLlmCall).not.toHaveBeenCalled();

      // state 落盘
      const statePath = path.join(clawDir, '.deep-dream-state.json');
      const state = JSON.parse(fsSync.readFileSync(statePath, 'utf-8'));
      expect(state.processedArchives).toContain(filename);
    });

    // ── 已处理文件不重复 ────────────────────────────────────────

    it('已在 state 中的 archive 不重复处理', async () => {
      const session = makeSessionJson([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ]);
      const filename = `1000000000004_abcd1234.json`;
      await fs.writeFile(path.join(archiveDir, filename), session, 'utf-8');

      // 预置 state
      const statePath = path.join(clawDir, '.deep-dream-state.json');
      await fs.writeFile(statePath, JSON.stringify({
        processedArchives: [filename],
        currentSessionDreamedDate: '',
      }), 'utf-8');

      await runDeepDream({ clawforumDir, llmConfig: fakeLlmConfig });

      expect(mockLlmCall).not.toHaveBeenCalled();
    });

    // ── Call 2 失败降级 ─────────────────────────────────────────

    it('Call 2 失败时降级，流程继续完成', async () => {
      const session = makeSessionJson([
        { role: 'user', content: 'task description' },
        { role: 'assistant', content: 'task completed' },
      ]);
      const filename = `1000000000005_abcd1234.json`;
      await fs.writeFile(path.join(archiveDir, filename), session, 'utf-8');

      mockLlmCall
        .mockResolvedValueOnce(makeTextResponse('dream insight'))
        .mockRejectedValueOnce(new Error('LLM timeout'));

      // 不抛出异常
      await expect(runDeepDream({ clawforumDir, llmConfig: fakeLlmConfig })).resolves.toBeUndefined();

      // state 已更新，inbox 消息已写入（dreamOutput 仍可用）
      const statePath = path.join(clawDir, '.deep-dream-state.json');
      const state = JSON.parse(fsSync.readFileSync(statePath, 'utf-8'));
      expect(state.processedArchives).toContain(filename);

      const inboxDir = path.join(clawDir, 'inbox', 'pending');
      const files = fsSync.readdirSync(inboxDir);
      expect(files.some(f => f.includes('deep_dream'))).toBe(true);
    });

    // ── current.json 处理 ───────────────────────────────────────

    it('当日未处理的 current.json 被处理，更新 currentSessionDreamedDate', async () => {
      const currentPath = path.join(clawDir, 'dialog', 'current.json');
      await fs.mkdir(path.dirname(currentPath), { recursive: true });
      const session = makeSessionJson([
        { role: 'user', content: 'current task' },
        { role: 'assistant', content: 'in progress' },
      ]);
      await fs.writeFile(currentPath, session, 'utf-8');

      mockLlmCall
        .mockResolvedValueOnce(makeTextResponse('dream'))
        .mockResolvedValueOnce(makeTextResponse('compressed'));

      await runDeepDream({ clawforumDir, llmConfig: fakeLlmConfig });

      expect(mockLlmCall).toHaveBeenCalledTimes(2);

      const statePath = path.join(clawDir, '.deep-dream-state.json');
      const state = JSON.parse(fsSync.readFileSync(statePath, 'utf-8'));
      const today = new Date().toLocaleDateString('sv');
      expect(state.currentSessionDreamedDate).toBe(today);
    });

    it('当日已处理的 current.json 不重复处理', async () => {
      const currentPath = path.join(clawDir, 'dialog', 'current.json');
      await fs.mkdir(path.dirname(currentPath), { recursive: true });
      await fs.writeFile(currentPath, makeSessionJson([
        { role: 'user', content: 'current' },
        { role: 'assistant', content: 'done' },
      ]), 'utf-8');

      const today = new Date().toLocaleDateString('sv');
      const statePath = path.join(clawDir, '.deep-dream-state.json');
      await fs.writeFile(statePath, JSON.stringify({
        processedArchives: [],
        currentSessionDreamedDate: today,
      }), 'utf-8');

      await runDeepDream({ clawforumDir, llmConfig: fakeLlmConfig });

      expect(mockLlmCall).not.toHaveBeenCalled();
    });
  });

  // ── llm.close 调用 ──────────────────────────────────────────

  it('处理完成后调用 llm.close', async () => {
    await fs.mkdir(path.join(clawforumDir, 'claws', 'claw-1', 'dialog', 'archive'), { recursive: true });
    await runDeepDream({ clawforumDir, llmConfig: fakeLlmConfig });
    expect(mockLlmClose).toHaveBeenCalledTimes(1);
  });

  it('处理异常时也调用 llm.close（finally 块）', async () => {
    await fs.mkdir(path.join(clawforumDir, 'claws', 'claw-err', 'dialog', 'archive'), { recursive: true });
    await fs.mkdir(path.join(clawforumDir, 'claws', 'claw-err', 'inbox', 'pending'), { recursive: true });

    const session = makeSessionJson([
      { role: 'user', content: 'test' },
      { role: 'assistant', content: 'ok' },
    ]);
    await fs.writeFile(
      path.join(clawforumDir, 'claws', 'claw-err', 'dialog', 'archive', `1000000000000_err00000.json`),
      session, 'utf-8'
    );
    // Call 1 抛出异常（单 claw 失败不阻断，close 仍被调用）
    mockLlmCall.mockRejectedValue(new Error('fatal'));

    await runDeepDream({ clawforumDir, llmConfig: fakeLlmConfig });

    expect(mockLlmClose).toHaveBeenCalledTimes(1);
  });
});
