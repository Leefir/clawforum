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

      expect(result.baseUrl).toBeUndefined();
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
});
