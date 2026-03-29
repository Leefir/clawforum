/**
 * Phase 81 — init.ts 环境变量自动识别测试
 *
 * 覆盖：
 *   - preset 对应 envVar 已设置 → API Key 从环境变量读取，无需手动输入
 *   - preset 对应 envVar 未设置 → 走 passwordQuestion 手动输入路径
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// ── readline mock ──────────────────────────────────────────────────────────────
// answers 队列：按顺序返回每次 question() 的答案（空字符串 = 使用 default）
const { rlAnswers } = vi.hoisted(() => ({ rlAnswers: { queue: [] as string[] } }));

const mockRl = {
  question: vi.fn((_prompt: string, cb: (a: string) => void) => {
    cb(rlAnswers.queue.shift() ?? '');
  }),
  close: vi.fn(),
  _writeToOutput: undefined as unknown,
};

vi.mock('readline', () => ({
  createInterface: vi.fn(() => mockRl),
}));

// mock process.exit 防止测试进程被终止
vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null | undefined) => {
  throw new Error(`process.exit(${_code})`);
});

const { initCommand } = await import('../../src/cli/commands/init.js');
const { getGlobalConfigPath, loadGlobalConfig } = await import('../../src/cli/config.js');

// ── helpers ────────────────────────────────────────────────────────────────────

let originalCwd: string;
let tempDir: string;

function setupTempDir() {
  originalCwd = process.cwd();
  tempDir = path.join(tmpdir(), `clawforum-init-test-${randomUUID()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  process.chdir(tempDir);
}

function teardownTempDir() {
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe('initCommand — env var 自动识别', () => {
  beforeEach(() => {
    setupTempDir();
    mockRl.question.mockClear();
    mockRl.close.mockClear();
    rlAnswers.queue = [];
  });

  afterEach(() => {
    teardownTempDir();
  });

  it('ANTHROPIC_API_KEY 已设置 → 跳过 API Key 提示，config 写入 env 值', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env-test';
    // readline 答案：provider=''(default=1=anthropic), model=''(use default)
    rlAnswers.queue = ['', ''];

    try {
      await initCommand(true);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }

    const configPath = getGlobalConfigPath();
    expect(fs.existsSync(configPath)).toBe(true);
    const config = loadGlobalConfig();
    expect(config.llm.primary.api_key).toBe('sk-ant-env-test');
  });

  it('ANTHROPIC_API_KEY 已设置 → question 只被调用两次（provider + model，无 API Key）', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env-test2';
    rlAnswers.queue = ['', ''];

    try {
      await initCommand(true);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }

    // provider(1次) + model(1次) = 2 次；passwordQuestion 未被触发
    expect(mockRl.question).toHaveBeenCalledTimes(2);
  });

  it('ANTHROPIC_API_KEY 未设置 → passwordQuestion 被调用（第二次 question），返回手动输入值', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    // provider='', apiKey='sk-manual', model=''
    rlAnswers.queue = ['', 'sk-manual', ''];

    await initCommand(true);

    const config = loadGlobalConfig();
    expect(config.llm.primary.api_key).toBe('sk-manual');
    // provider + apiKey + model = 3 次
    expect(mockRl.question).toHaveBeenCalledTimes(3);
  });

  it('ANTHROPIC_API_KEY 未设置且 API Key 输入为空 → process.exit(1)', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    // provider='', apiKey=''(空) → should exit
    rlAnswers.queue = ['', ''];

    await expect(initCommand(true)).rejects.toThrow('process.exit(1)');
  });
});
