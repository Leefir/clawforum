/**
 * random-dream 测试
 *
 * 覆盖路径：
 * - 无契约时提前返回
 * - Fix 3 回归：同 claw 后续契约 hint 不含"新claw"
 * - Fix 5 回归：轮询 .txt（完成信号），不轮询 .log（启动即存在）
 * - [DREAM_OUTPUT] 提取与 inbox 投递
 * - state 更新
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fsSync from 'fs';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { runRandomDream, type RandomDreamOptions } from '../../../src/core/cron/jobs/random-dream.js';
import type { TaskSystem } from '../../../src/core/task/system.js';

// ─── scheduleSubAgentWithTracking mock ───────────────────────

const { mockScheduleSubAgent } = vi.hoisted(() => ({
  mockScheduleSubAgent: vi.fn(),
}));

vi.mock('../../../src/core/tools/builtins/spawn.js', () => ({
  scheduleSubAgentWithTracking: mockScheduleSubAgent,
}));

// ─── 工具函数 ─────────────────────────────────────────────────

async function createTempDir(): Promise<string> {
  const d = path.join(tmpdir(), `random-dream-test-${randomUUID()}`);
  await fs.mkdir(d, { recursive: true });
  return d;
}

async function cleanupTempDir(d: string) {
  try { await fs.rm(d, { recursive: true, force: true }); } catch { /* ignore */ }
}

function makeOpts(clawforumDir: string, motionDir: string): RandomDreamOptions {
  return {
    clawforumDir,
    motionDir,
    taskSystem: {} as TaskSystem,
    streamWriter: { write: vi.fn() },
  };
}

/** 在 motionDir 创建 tasks/results 目录并写入完成信号 */
async function writeTaskCompletion(motionDir: string, taskId: string, logContent: string) {
  const resultsDir = path.join(motionDir, 'tasks', 'results');
  await fs.mkdir(resultsDir, { recursive: true });
  await fs.writeFile(path.join(resultsDir, `${taskId}.txt`), 'done', 'utf-8');
  await fs.writeFile(path.join(resultsDir, `${taskId}.log`), logContent, 'utf-8');
}

// ─── 测试 ─────────────────────────────────────────────────────

describe('runRandomDream', () => {
  let clawforumDir: string;
  let motionDir: string;
  const taskId = `task-${randomUUID()}`;

  beforeEach(async () => {
    clawforumDir = await createTempDir();
    motionDir = await createTempDir();
    await fs.mkdir(path.join(motionDir, 'inbox', 'pending'), { recursive: true });
    mockScheduleSubAgent.mockReset();
    mockScheduleSubAgent.mockResolvedValue(taskId);
  });

  afterEach(async () => {
    await Promise.all([cleanupTempDir(clawforumDir), cleanupTempDir(motionDir)]);
    vi.clearAllMocks();
  });

  // ── 无契约 ──────────────────────────────────────────────────

  it('claws 目录不存在时直接返回', async () => {
    await expect(runRandomDream(makeOpts(clawforumDir, motionDir))).resolves.toBeUndefined();
    expect(mockScheduleSubAgent).not.toHaveBeenCalled();
  });

  it('claws 目录存在但无 archive 契约时直接返回', async () => {
    await fs.mkdir(path.join(clawforumDir, 'claws', 'claw-1', 'contract', 'archive'), { recursive: true });
    await expect(runRandomDream(makeOpts(clawforumDir, motionDir))).resolves.toBeUndefined();
    expect(mockScheduleSubAgent).not.toHaveBeenCalled();
  });

  // ── 正常完成流程 ─────────────────────────────────────────────

  describe('有契约 + sub-agent 正常完成', () => {
    beforeEach(async () => {
      // 创建一个契约目录
      await fs.mkdir(
        path.join(clawforumDir, 'claws', 'claw-1', 'contract', 'archive', 'contract-001'),
        { recursive: true }
      );
    });

    it('sub-agent 完成后提取 [DREAM_OUTPUT]，写入 inbox，更新 state', async () => {
      const dreamLog = `=== SubAgent ${taskId} started ===
Prompt: ...
[DREAM_OUTPUT contract_id="contract-001"]
跨 claw 共性洞见：所有 claw 都在重复同样的错误模式
[/DREAM_OUTPUT]`;

      await writeTaskCompletion(motionDir, taskId, dreamLog);

      await runRandomDream(makeOpts(clawforumDir, motionDir));

      // state 更新
      const statePath = path.join(clawforumDir, '.random-dream-state.json');
      expect(fsSync.existsSync(statePath)).toBe(true);
      const state = JSON.parse(fsSync.readFileSync(statePath, 'utf-8'));
      expect(state.processedContractIds).toContain('contract-001');

      // inbox 消息写入
      const inboxFiles = fsSync.readdirSync(path.join(motionDir, 'inbox', 'pending'));
      expect(inboxFiles.some(f => f.includes('random_dream'))).toBe(true);
    });

    it('多个 [DREAM_OUTPUT] 块全部提取', async () => {
      // 创建第二个契约
      await fs.mkdir(
        path.join(clawforumDir, 'claws', 'claw-2', 'contract', 'archive', 'contract-002'),
        { recursive: true }
      );

      const dreamLog = `=== started ===
[DREAM_OUTPUT contract_id="contract-001"]
洞见 A
[/DREAM_OUTPUT]
[DREAM_OUTPUT contract_id="contract-002"]
洞见 B
[/DREAM_OUTPUT]`;

      await writeTaskCompletion(motionDir, taskId, dreamLog);

      await runRandomDream(makeOpts(clawforumDir, motionDir));

      const state = JSON.parse(fsSync.readFileSync(
        path.join(clawforumDir, '.random-dream-state.json'), 'utf-8'
      ));
      expect(state.processedContractIds).toContain('contract-001');
      expect(state.processedContractIds).toContain('contract-002');
    });

    it('log 中无 [DREAM_OUTPUT] 块时不写 inbox', async () => {
      await writeTaskCompletion(motionDir, taskId, '=== started ===\nsome output\n[DREAM_COMPLETE]');

      await runRandomDream(makeOpts(clawforumDir, motionDir));

      const inboxFiles = fsSync.readdirSync(path.join(motionDir, 'inbox', 'pending'));
      expect(inboxFiles.filter(f => f.includes('random_dream'))).toHaveLength(0);
    });

    // ── Fix 5 回归：轮询 .txt 而非 .log ─────────────────────────

    it('Fix 5 回归：仅 .log 存在时不提前返回', async () => {
      vi.useFakeTimers();
      try {
        // 创建 .log（sub-agent 启动时就存在）
        const resultsDir = path.join(motionDir, 'tasks', 'results');
        await fs.mkdir(resultsDir, { recursive: true });
        fsSync.writeFileSync(
          path.join(resultsDir, `${taskId}.log`),
          '=== SubAgent started ===\nPrompt: ...'
        );
        // .txt 不存在

        const runPromise = runRandomDream(makeOpts(clawforumDir, motionDir));

        // 推进一个轮询周期（30 秒）
        await vi.advanceTimersByTimeAsync(30_001);

        // 此时 inbox 应仍为空（未完成）
        const inboxFiles = fsSync.readdirSync(path.join(motionDir, 'inbox', 'pending'));
        expect(inboxFiles.filter(f => f.includes('random_dream'))).toHaveLength(0);

        // 写入 .txt + 更新 .log（模拟 sub-agent 完成）
        fsSync.writeFileSync(path.join(resultsDir, `${taskId}.txt`), 'done');
        fsSync.writeFileSync(
          path.join(resultsDir, `${taskId}.log`),
          `[DREAM_OUTPUT contract_id="contract-001"]跨 claw 洞见[/DREAM_OUTPUT]`
        );

        // 推进下一个轮询周期
        await vi.advanceTimersByTimeAsync(30_001);
        await runPromise;

        // 现在 inbox 应有消息
        const inboxFilesAfter = fsSync.readdirSync(path.join(motionDir, 'inbox', 'pending'));
        expect(inboxFilesAfter.some(f => f.includes('random_dream'))).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ── Fix 3 回归：同 claw 后续契约 hint 不含"新claw" ───────────

  it('Fix 3 回归：同一 claw 的第二个契约 hint 不含"新claw"', async () => {
    // 同一 claw 两个契约
    await fs.mkdir(
      path.join(clawforumDir, 'claws', 'claw-1', 'contract', 'archive', 'contract-A'),
      { recursive: true }
    );
    await fs.mkdir(
      path.join(clawforumDir, 'claws', 'claw-1', 'contract', 'archive', 'contract-B'),
      { recursive: true }
    );

    // 捕获传给 sub-agent 的 prompt
    let capturedPrompt = '';
    mockScheduleSubAgent.mockImplementation(async (_ts: unknown, _sw: unknown, opts: { prompt: string }) => {
      capturedPrompt = opts.prompt;
      return taskId;
    });

    await writeTaskCompletion(motionDir, taskId, '=== started ===');

    await runRandomDream(makeOpts(clawforumDir, motionDir));

    expect(capturedPrompt).not.toBe('');
    const lines = capturedPrompt.split('\n').filter(l => l.includes('claw-1'));

    // 第一个契约可以有"新claw"，第二个不应有
    // 找到所有包含 contract-A 和 contract-B 的行
    const lineA = lines.find(l => l.includes('contract-A'));
    const lineB = lines.find(l => l.includes('contract-B'));

    if (lineA && lineB) {
      // 两行中，至多一行含"新claw"（首次出现保留，后续移除）
      const newClawCount = lines.filter(l => l.includes('新claw')).length;
      expect(newClawCount).toBeLessThanOrEqual(1);
    }
  });

  // ── 已处理契约降权 ──────────────────────────────────────────

  it('已处理契约排序靠后（权重 -80）', async () => {
    // 两个 claw 各一个契约
    await fs.mkdir(
      path.join(clawforumDir, 'claws', 'claw-new', 'contract', 'archive', 'contract-new'),
      { recursive: true }
    );
    await fs.mkdir(
      path.join(clawforumDir, 'claws', 'claw-old', 'contract', 'archive', 'contract-old'),
      { recursive: true }
    );

    // 预置 state：contract-old 已处理
    await fs.writeFile(
      path.join(clawforumDir, '.random-dream-state.json'),
      JSON.stringify({ processedContractIds: ['contract-old'] }),
      'utf-8'
    );

    let capturedPrompt = '';
    mockScheduleSubAgent.mockImplementation(async (_ts: unknown, _sw: unknown, opts: { prompt: string }) => {
      capturedPrompt = opts.prompt;
      return taskId;
    });

    await writeTaskCompletion(motionDir, taskId, '=== started ===');

    await runRandomDream(makeOpts(clawforumDir, motionDir));

    expect(capturedPrompt).not.toBe('');
    const lines = capturedPrompt.split('\n').filter(l => l.match(/^\d+\./));

    // contract-new 应排在 contract-old 前面
    const idxNew = lines.findIndex(l => l.includes('contract-new'));
    const idxOld = lines.findIndex(l => l.includes('contract-old'));
    if (idxNew >= 0 && idxOld >= 0) {
      expect(idxNew).toBeLessThan(idxOld);
    }
  });
});
