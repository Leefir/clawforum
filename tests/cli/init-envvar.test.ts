/**
 * Phase 81 — init.ts API Key 配置测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// ── readline mock ──────────────────────────────────────────────────────────────
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

describe('initCommand — API Key 配置', () => {
  beforeEach(() => {
    setupTempDir();
    mockRl.question.mockClear();
    mockRl.close.mockClear();
    rlAnswers.queue = [];
  });

  afterEach(() => {
    teardownTempDir();
  });

  it('选择环境变量 → 检测到变量 → 选编号 → 使用对应值', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env-test';
    // provider='', apiKeyChoice='1', pick='1'(选第一个检测到的), model=''
    rlAnswers.queue = ['', '1', '1', ''];

    try {
      await initCommand(true);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }

    const config = loadGlobalConfig();
    expect(config.llm.primary.api_key).toBe('sk-ant-env-test');
  });

  it('选择环境变量 → 检测到变量 → 直接输入变量名 → 使用对应值', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env-test2';
    // provider='', apiKeyChoice='1', pick='ANTHROPIC_API_KEY'(直接输变量名), model=''
    rlAnswers.queue = ['', '1', 'ANTHROPIC_API_KEY', ''];

    try {
      await initCommand(true);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }

    const config = loadGlobalConfig();
    expect(config.llm.primary.api_key).toBe('sk-ant-env-test2');
  });

  it('选择环境变量 → 未检测到变量 → 手动输入变量名 → 使用对应值', async () => {
    process.env.MY_CUSTOM_KEY = 'sk-custom-123';
    // 清除所有已知 preset envVar
    const knownVars = ['ANTHROPIC_API_KEY','OPENAI_API_KEY','DEEPSEEK_API_KEY',
      'MOONSHOT_API_KEY','MINIMAX_API_KEY','GEMINI_API_KEY','OLLAMA_API_KEY'];
    const saved: Record<string, string | undefined> = {};
    knownVars.forEach(v => { saved[v] = process.env[v]; delete process.env[v]; });

    // provider='', apiKeyChoice='1', varName='MY_CUSTOM_KEY', model=''
    rlAnswers.queue = ['', '1', 'MY_CUSTOM_KEY', ''];

    try {
      await initCommand(true);
    } finally {
      delete process.env.MY_CUSTOM_KEY;
      knownVars.forEach(v => { if (saved[v] !== undefined) process.env[v] = saved[v]; });
    }

    const config = loadGlobalConfig();
    expect(config.llm.primary.api_key).toBe('sk-custom-123');
  });

  it('选择环境变量 → 未检测到 → 变量名为空 → process.exit(1)', async () => {
    const knownVars = ['ANTHROPIC_API_KEY','OPENAI_API_KEY','DEEPSEEK_API_KEY',
      'MOONSHOT_API_KEY','MINIMAX_API_KEY','GEMINI_API_KEY','OLLAMA_API_KEY'];
    const saved: Record<string, string | undefined> = {};
    knownVars.forEach(v => { saved[v] = process.env[v]; delete process.env[v]; });

    rlAnswers.queue = ['', '1', ''];

    try {
      await expect(initCommand(true)).rejects.toThrow('process.exit(1)');
    } finally {
      knownVars.forEach(v => { if (saved[v] !== undefined) process.env[v] = saved[v]; });
    }
  });

  it('选择手动输入 → 使用手动输入的值', async () => {
    // provider='', apiKeyChoice=''(default=2), apiKey='sk-manual', model=''
    rlAnswers.queue = ['', '', 'sk-manual', ''];

    await initCommand(true);

    const config = loadGlobalConfig();
    expect(config.llm.primary.api_key).toBe('sk-manual');
  });

  it('手动输入但 API Key 为空 → process.exit(1)', async () => {
    rlAnswers.queue = ['', '', '', ''];

    await expect(initCommand(true)).rejects.toThrow('process.exit(1)');
  });
});
