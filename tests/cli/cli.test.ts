/**
 * CLI tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import {
  toProviderConfig,
  loadGlobalConfig,
  saveGlobalConfig,
  isInitialized,
  clawExists,
  getGlobalConfigPath,
  getClawDir,
} from '../../src/cli/config.js';
import { listCommand } from '../../src/cli/commands/claw.js';

async function createTempDir(): Promise<string> {
  const tempDir = path.join(tmpdir(), `clawforum-cli-test-${randomUUID()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe('CLI Config', () => {
  let originalCwd: string;
  let tempDir: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await createTempDir();
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await cleanupTempDir(tempDir);
  });

  describe('toProviderConfig', () => {
    // Phase 20: preset field and apiFormat
    it('should set apiFormat=openai when preset is openai', () => {
      const result = toProviderConfig({
        preset: 'openai',
        api_key: 'sk-test',
        model: 'gpt-4o',
        max_tokens: 4096,
        temperature: 0.7,
        timeout_ms: 60000,
      });
      expect(result.apiFormat).toBe('openai');
    });

    it('should set apiFormat=anthropic when using name backward compat', () => {
      const result = toProviderConfig({
        name: 'anthropic',
        api_key: 'test-key',
        model: 'claude-3-5-haiku',
        max_tokens: 4096,
        temperature: 0.7,
        timeout_ms: 60000,
      });
      expect(result.apiFormat).toBe('anthropic');
    });

    it('should use label as name when provided', () => {
      const result = toProviderConfig({
        preset: 'openai',
        label: 'My OpenAI',
        api_key: 'sk-test',
        model: 'gpt-4o',
        max_tokens: 4096,
        temperature: 0.7,
        timeout_ms: 60000,
      });
      expect(result.name).toBe('My OpenAI');
    });

    it('should map snake_case to camelCase', () => {
      const input = {
        name: 'anthropic',
        api_key: 'test-key',
        base_url: 'https://api.anthropic.com',
        model: 'claude-3-5-haiku',
        max_tokens: 4096,
        temperature: 0.7,
        timeout_ms: 60000,
      };

      const result = toProviderConfig(input);

      expect(result.name).toBe('anthropic');
      expect(result.apiKey).toBe('test-key');
      expect(result.baseUrl).toBe('https://api.anthropic.com');
      expect(result.model).toBe('claude-3-5-haiku');
      expect(result.maxTokens).toBe(4096);
      expect(result.temperature).toBe(0.7);
      expect(result.timeoutMs).toBe(60000);
    });

    it('should handle optional base_url', () => {
      const input = {
        name: 'anthropic',
        api_key: 'test-key',
        model: 'claude-3-5-haiku',
        max_tokens: 4096,
        temperature: 0.7,
        timeout_ms: 60000,
      };

      const result = toProviderConfig(input);

      expect(result.baseUrl).toBe('https://api.anthropic.com');
    });
  });

  describe('loadGlobalConfig', () => {
    it('should throw error when config not found', () => {
      expect(() => loadGlobalConfig()).toThrow('Run "clawforum init" first');
    });

    it('should throw error for invalid yaml', () => {
      const configPath = getGlobalConfigPath();
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, 'invalid: yaml: content: [}');

      expect(() => loadGlobalConfig()).toThrow();
    });

    it('should load valid config', () => {
      const config = {
        version: '1',
        llm: {
          primary: {
            name: 'anthropic',
            api_key: 'test-key',
            model: 'claude-3-5-haiku',
            max_tokens: 4096,
            temperature: 0.7,
            timeout_ms: 60000,
          },
          retry_attempts: 3,
          retry_delay_ms: 1000,
        },
      };
      saveGlobalConfig(config);

      const loaded = loadGlobalConfig();

      expect(loaded.version).toBe('1');
      expect(loaded.llm.primary.api_key).toBe('test-key');
    });
  });

  describe('isInitialized', () => {
    it('should return false when not initialized', () => {
      expect(isInitialized()).toBe(false);
    });

    it('should return true when initialized', () => {
      const configPath = getGlobalConfigPath();
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, 'version: 1\n');

      expect(isInitialized()).toBe(true);
    });
  });

  describe('clawExists', () => {
    it('should return false for non-existent claw', () => {
      expect(clawExists('nonexistent')).toBe(false);
    });

    it('should return true for existing claw', () => {
      const clawDir = getClawDir('test-claw');
      fs.mkdirSync(clawDir, { recursive: true });
      fs.writeFileSync(path.join(clawDir, 'config.yaml'), 'name: test-claw\n');

      expect(clawExists('test-claw')).toBe(true);
    });
  });

  describe('listCommand', () => {
    it('should list all claws with their status', async () => {
      // 创建全局配置
      const config = {
        version: '1',
        llm: {
          primary: {
            name: 'anthropic',
            api_key: 'test-key',
            model: 'claude-3-5-haiku',
            max_tokens: 4096,
            temperature: 0.7,
            timeout_ms: 60000,
          },
          retry_attempts: 3,
          retry_delay_ms: 1000,
        },
      };
      saveGlobalConfig(config);

      // 创建两个测试 claw
      const clawDir1 = getClawDir('claw-alpha');
      const clawDir2 = getClawDir('claw-beta');
      fs.mkdirSync(clawDir1, { recursive: true });
      fs.mkdirSync(clawDir2, { recursive: true });
      fs.writeFileSync(path.join(clawDir1, 'config.yaml'), 'name: claw-alpha\n');
      fs.writeFileSync(path.join(clawDir2, 'config.yaml'), 'name: claw-beta\n');

      // 执行 list 命令（不抛出错误即成功）
      await expect(listCommand()).resolves.not.toThrow();
    });

    it('should handle empty claws directory', async () => {
      // 创建全局配置但不创建任何 claw
      const config = {
        version: '1',
        llm: {
          primary: {
            name: 'anthropic',
            api_key: 'test-key',
            model: 'claude-3-5-haiku',
            max_tokens: 4096,
            temperature: 0.7,
            timeout_ms: 60000,
          },
          retry_attempts: 3,
          retry_delay_ms: 1000,
        },
      };
      saveGlobalConfig(config);

      // 执行 list 命令（应该正常返回，提示没有 claws，不抛出错误）
      await expect(listCommand()).resolves.toBeUndefined();
    });

    it('should auto-create claws directory if not exists', async () => {
      // 创建全局配置
      const config = {
        version: '1',
        llm: {
          primary: {
            name: 'anthropic',
            api_key: 'test-key',
            model: 'claude-3-5-haiku',
            max_tokens: 4096,
            temperature: 0.7,
            timeout_ms: 60000,
          },
          retry_attempts: 3,
          retry_delay_ms: 1000,
        },
      };
      saveGlobalConfig(config);

      // 确保 claws 目录不存在
      const clawsDir = path.join(path.dirname(getGlobalConfigPath()), 'claws');
      if (fs.existsSync(clawsDir)) {
        fs.rmSync(clawsDir, { recursive: true });
      }

      // 执行 list 命令应该自动创建目录
      await expect(listCommand()).resolves.toBeUndefined();
      expect(fs.existsSync(clawsDir)).toBe(true);
    });
  });

  // Phase 20: expandEnvVars — exercised through loadGlobalConfig()
  describe('loadGlobalConfig - expandEnvVars', () => {
    it('should expand ${VAR} syntax in api_key', () => {
      process.env.TEST_CLAW_API_KEY_EXPAND = 'resolved-secret-value';
      const configPath = getGlobalConfigPath();
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      // Single-quoted string: no JS template interpolation, ${} written literally
      const rawYaml = 'version: "1"\nllm:\n  primary:\n    name: anthropic\n    api_key: ${TEST_CLAW_API_KEY_EXPAND}\n    model: claude-3-5-haiku\n    max_tokens: 4096\n    temperature: 0.7\n    timeout_ms: 60000\n  retry_attempts: 3\n  retry_delay_ms: 1000\n';
      fs.writeFileSync(configPath, rawYaml);

      const loaded = loadGlobalConfig();
      expect(loaded.llm.primary.api_key).toBe('resolved-secret-value');

      delete process.env.TEST_CLAW_API_KEY_EXPAND;
    });

    it('should throw when referenced env var is not set', () => {
      delete process.env.MISSING_CLAW_TEST_VAR_XYZ;
      const configPath = getGlobalConfigPath();
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      const rawYaml = 'version: "1"\nllm:\n  primary:\n    name: anthropic\n    api_key: ${MISSING_CLAW_TEST_VAR_XYZ}\n    model: test\n    max_tokens: 4096\n    temperature: 0.7\n    timeout_ms: 60000\n  retry_attempts: 3\n  retry_delay_ms: 1000\n';
      fs.writeFileSync(configPath, rawYaml);

      expect(() => loadGlobalConfig()).toThrow(/MISSING_CLAW_TEST_VAR_XYZ/);
    });
  });
});
