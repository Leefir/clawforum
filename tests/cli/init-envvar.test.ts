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
const { loadGlobalConfig } = await import('../../src/cli/config.js');

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

const knownVars = [
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY',
  'MOONSHOT_API_KEY', 'MINIMAX_API_KEY', 'GEMINI_API_KEY', 'OLLAMA_API_KEY',
  'XAI_API_KEY', 'OPENROUTER_API_KEY', 'DASHSCOPE_API_KEY',
];

function clearKnownVars(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  knownVars.forEach(v => { saved[v] = process.env[v]; delete process.env[v]; });
  return saved;
}

function restoreKnownVars(saved: Record<string, string | undefined>) {
  knownVars.forEach(v => { if (saved[v] !== undefined) process.env[v] = saved[v]; });
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe('initCommand — Branch 1: 扫描环境变量', () => {
  beforeEach(() => {
    setupTempDir();
    mockRl.question.mockClear();
    mockRl.close.mockClear();
    rlAnswers.queue = [];
  });

  afterEach(() => {
    teardownTempDir();
  });

  it('检测到变量 → 选编号 → 使用对应值', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env-test';
    // configMethod='1', pick='1'(第一个), model=''
    rlAnswers.queue = ['1', '1', ''];

    try {
      await initCommand(true);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }

    const config = loadGlobalConfig();
    expect(config.llm.primary.api_key).toBe('sk-ant-env-test');
    expect(config.llm.primary.preset).toBe('anthropic');
  });

  it('检测到变量 → 直接输入变量名 → 使用对应值', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env-test2';
    // configMethod='1', pick='ANTHROPIC_API_KEY', model=''
    rlAnswers.queue = ['1', 'ANTHROPIC_API_KEY', ''];

    try {
      await initCommand(true);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }

    const config = loadGlobalConfig();
    expect(config.llm.primary.api_key).toBe('sk-ant-env-test2');
  });

  it('未检测到变量 → 输入自定义变量名 → 变量在已知 preset 中 → 使用对应值', async () => {
    // 清空已知变量后只保留 OPENAI_API_KEY，但不让它被扫描到（直接输入变量名场景）
    const saved = clearKnownVars();
    process.env.OPENAI_API_KEY = 'sk-openai-123';
    // configMethod='1', varName='OPENAI_API_KEY', model=''
    rlAnswers.queue = ['1', 'OPENAI_API_KEY', ''];

    try {
      await initCommand(true);
    } finally {
      delete process.env.OPENAI_API_KEY;
      restoreKnownVars(saved);
    }

    const config = loadGlobalConfig();
    expect(config.llm.primary.api_key).toBe('sk-openai-123');
    expect(config.llm.primary.preset).toBe('openai');
  });

  it('未检测到变量 → 变量名为空 → throws CliError', async () => {
    const saved = clearKnownVars();
    // configMethod='1', varName=''
    rlAnswers.queue = ['1', ''];

    try {
      await expect(initCommand(true)).rejects.toThrow('Variable name is required');
    } finally {
      restoreKnownVars(saved);
    }
  });

  it('检测到变量 → 输入无效（非编号非变量名格式）→ throws CliError', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-xxx';
    // configMethod='1', pick='sk-ant-api03-...'（key 格式，不是变量名）
    rlAnswers.queue = ['1', 'sk-ant-api03-invalid'];

    try {
      await expect(initCommand(true)).rejects.toThrow('Invalid input. Enter a number or a variable name');
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });
});

describe('initCommand — Branch 2: 手动配置', () => {
  beforeEach(() => {
    setupTempDir();
    mockRl.question.mockClear();
    mockRl.close.mockClear();
    rlAnswers.queue = [];
  });

  afterEach(() => {
    teardownTempDir();
  });

  it('选 OpenAI 格式 → 填完整信息 → 写入配置', async () => {
    // configMethod='2', fmt='2'(OpenAI), baseUrl, apiKey, model
    rlAnswers.queue = ['2', '2', 'https://api.openai.com/v1', 'sk-manual', 'gpt-4o'];

    await initCommand(true);

    const config = loadGlobalConfig();
    expect(config.llm.primary.preset).toBe('custom-openai');
    expect(config.llm.primary.api_key).toBe('sk-manual');
    expect(config.llm.primary.model).toBe('gpt-4o');
    expect((config.llm.primary as any).base_url).toBe('https://api.openai.com/v1');
  });

  it('选 Anthropic 格式 → 填完整信息 → 写入配置', async () => {
    rlAnswers.queue = ['2', '1', 'https://api.anthropic.com', 'sk-ant-key', 'claude-3-7-sonnet'];

    await initCommand(true);

    const config = loadGlobalConfig();
    expect(config.llm.primary.preset).toBe('custom-anthropic');
    expect(config.llm.primary.api_key).toBe('sk-ant-key');
  });

  it('Base URL 为空 → throws CliError', async () => {
    // configMethod='2', fmt='2', baseUrl=''
    rlAnswers.queue = ['2', '2', ''];

    await expect(initCommand(true)).rejects.toThrow('Base URL is required');
  });

  it('API Key 为空 → throws CliError', async () => {
    // configMethod='2', fmt='2', baseUrl, apiKey=''
    rlAnswers.queue = ['2', '2', 'https://api.example.com', ''];

    await expect(initCommand(true)).rejects.toThrow('API Key is required');
  });
});

describe('initCommand — Branch 3: 选择 provider（未实现）', () => {
  beforeEach(() => {
    setupTempDir();
    mockRl.question.mockClear();
    mockRl.close.mockClear();
    rlAnswers.queue = [];
  });

  afterEach(() => {
    teardownTempDir();
  });

  it('选 3 → throws CliError', async () => {
    rlAnswers.queue = ['3'];

    await expect(initCommand(true)).rejects.toThrow('Provider selection is not yet implemented');
  });
});
