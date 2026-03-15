/**
 * MotionRuntime 单元测试
 * 
 * 覆盖场景:
 * - buildSystemPrompt() 注入顺序正确
 * - buildSystemPrompt() 包含 SOUL.md/REVIEW.md 内容
 * - 缺少模板文件时的降级行为
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { MotionRuntime } from '../../src/core/motion/runtime.js';
import type { LLMServiceConfig } from '../../src/foundation/llm/types.js';

// 测试用的 LLM 配置
const mockLLMConfig: LLMServiceConfig = {
  primary: {
    name: 'test',
    apiKey: 'test-key',
    model: 'test-model',
    maxTokens: 100,
    temperature: 0,
  },
  maxAttempts: 1,
  retryDelayMs: 0,
};

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'motion-test-'));
}

async function cleanupDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

describe('MotionRuntime', () => {
  let tempDir: string;
  let runtime: MotionRuntime;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    if (runtime) {
      await runtime.stop().catch(() => {});
    }
    await cleanupDir(tempDir);
  });

  describe('buildSystemPrompt()', () => {
    it('should include SOUL.md content when present', async () => {
      // Arrange: 创建必要的文件
      await fs.mkdir(path.join(tempDir, 'dialog'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'AGENTS.md'), '## Agent Role\nTest agent');
      await fs.writeFile(path.join(tempDir, 'SOUL.md'), '## Soul\nEfficiency first');
      await fs.mkdir(path.join(tempDir, 'skills'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'memory'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'clawspace'), { recursive: true });

      runtime = new MotionRuntime({
        clawId: 'motion-test',
        clawDir: tempDir,
        llmConfig: mockLLMConfig,
      });

      // Act
      await runtime.initialize();
      const prompt = await (runtime as any).buildSystemPrompt();

      // Assert
      expect(prompt).toContain('## Agent Role');
      expect(prompt).toContain('## Soul');
      expect(prompt).toContain('Efficiency first');
    });

    it('should include REVIEW.md content when present', async () => {
      // Arrange
      await fs.mkdir(path.join(tempDir, 'dialog'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'AGENTS.md'), '## Agent Role');
      await fs.writeFile(path.join(tempDir, 'REVIEW.md'), '## Review Guide\nWeekly review');
      await fs.mkdir(path.join(tempDir, 'skills'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'memory'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'clawspace'), { recursive: true });

      runtime = new MotionRuntime({
        clawId: 'motion-test',
        clawDir: tempDir,
        llmConfig: mockLLMConfig,
      });

      // Act
      await runtime.initialize();
      const prompt = await (runtime as any).buildSystemPrompt();

      // Assert
      expect(prompt).toContain('## Review Guide');
      expect(prompt).toContain('Weekly review');
    });

    it('should have correct injection order: AGENTS → SOUL → REVIEW → MEMORY', async () => {
      // Arrange
      await fs.mkdir(path.join(tempDir, 'dialog'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'AGENTS.md'), 'AGENTS_CONTENT');
      await fs.writeFile(path.join(tempDir, 'SOUL.md'), 'SOUL_CONTENT');
      await fs.writeFile(path.join(tempDir, 'REVIEW.md'), 'REVIEW_CONTENT');
      await fs.writeFile(path.join(tempDir, 'MEMORY.md'), 'MEMORY_CONTENT');
      await fs.mkdir(path.join(tempDir, 'skills'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'memory'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'clawspace'), { recursive: true });

      runtime = new MotionRuntime({
        clawId: 'motion-test',
        clawDir: tempDir,
        llmConfig: mockLLMConfig,
      });

      // Act
      await runtime.initialize();
      const prompt = await (runtime as any).buildSystemPrompt();

      // Assert: 验证顺序
      const agentsIndex = prompt.indexOf('AGENTS_CONTENT');
      const soulIndex = prompt.indexOf('SOUL_CONTENT');
      const reviewIndex = prompt.indexOf('REVIEW_CONTENT');
      const memoryIndex = prompt.indexOf('MEMORY_CONTENT');

      expect(agentsIndex).toBeGreaterThanOrEqual(0);
      expect(soulIndex).toBeGreaterThan(agentsIndex);
      expect(reviewIndex).toBeGreaterThan(soulIndex);
      expect(memoryIndex).toBeGreaterThan(reviewIndex);
    });

    it('should gracefully degrade when SOUL.md is missing', async () => {
      // Arrange: 不创建 SOUL.md
      await fs.mkdir(path.join(tempDir, 'dialog'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'AGENTS.md'), 'AGENTS_CONTENT');
      await fs.mkdir(path.join(tempDir, 'skills'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'memory'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'clawspace'), { recursive: true });

      runtime = new MotionRuntime({
        clawId: 'motion-test',
        clawDir: tempDir,
        llmConfig: mockLLMConfig,
      });

      // Act & Assert: 不应抛出错误
      await runtime.initialize();
      const prompt = await (runtime as any).buildSystemPrompt();
      expect(prompt).toContain('AGENTS_CONTENT');
      expect(prompt).not.toContain('SOUL_CONTENT');
    });

    it('should gracefully degrade when REVIEW.md is missing', async () => {
      // Arrange: 不创建 REVIEW.md
      await fs.mkdir(path.join(tempDir, 'dialog'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'AGENTS.md'), 'AGENTS_CONTENT');
      await fs.writeFile(path.join(tempDir, 'SOUL.md'), 'SOUL_CONTENT');
      await fs.mkdir(path.join(tempDir, 'skills'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'memory'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'clawspace'), { recursive: true });

      runtime = new MotionRuntime({
        clawId: 'motion-test',
        clawDir: tempDir,
        llmConfig: mockLLMConfig,
      });

      // Act & Assert
      await runtime.initialize();
      const prompt = await (runtime as any).buildSystemPrompt();
      expect(prompt).toContain('AGENTS_CONTENT');
      expect(prompt).toContain('SOUL_CONTENT');
      expect(prompt).not.toContain('REVIEW_CONTENT');
    });

    it('should gracefully degrade when AGENTS.md is missing', async () => {
      // Arrange: 不创建 AGENTS.md
      await fs.mkdir(path.join(tempDir, 'dialog'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'SOUL.md'), 'SOUL_CONTENT');
      await fs.mkdir(path.join(tempDir, 'skills'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'memory'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'clawspace'), { recursive: true });

      runtime = new MotionRuntime({
        clawId: 'motion-test',
        clawDir: tempDir,
        llmConfig: mockLLMConfig,
      });

      // Act & Assert
      await runtime.initialize();
      const prompt = await (runtime as any).buildSystemPrompt();
      expect(prompt).toContain('SOUL_CONTENT');
      expect(prompt).not.toContain('AGENTS_CONTENT');
    });

    it('should skip empty SOUL.md content', async () => {
      // Arrange: 创建空的 SOUL.md
      await fs.mkdir(path.join(tempDir, 'dialog'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'AGENTS.md'), 'AGENTS_CONTENT');
      await fs.writeFile(path.join(tempDir, 'SOUL.md'), '   \n   '); // 只有空白字符
      await fs.mkdir(path.join(tempDir, 'skills'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'memory'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'clawspace'), { recursive: true });

      runtime = new MotionRuntime({
        clawId: 'motion-test',
        clawDir: tempDir,
        llmConfig: mockLLMConfig,
      });

      // Act
      await runtime.initialize();
      const prompt = await (runtime as any).buildSystemPrompt();

      // Assert: AGENTS 后面应该直接是 skills/contract（没有 SOUL）
      expect(prompt).toContain('AGENTS_CONTENT');
      // 空白内容被 trim() 后为空，不应加入 sections
    });
  });

  describe('inheritance', () => {
    it('should extend ClawRuntime correctly', async () => {
      // Arrange
      await fs.mkdir(path.join(tempDir, 'dialog'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'AGENTS.md'), 'Test');
      await fs.mkdir(path.join(tempDir, 'skills'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'memory'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'clawspace'), { recursive: true });

      runtime = new MotionRuntime({
        clawId: 'motion-test',
        clawDir: tempDir,
        llmConfig: mockLLMConfig,
      });

      // Act & Assert
      await runtime.initialize();
      expect(runtime).toBeInstanceOf(MotionRuntime);
      
      // 验证继承的方法可用
      const status = runtime.getStatus();
      expect(status.clawId).toBe('motion-test');
      expect(status.initialized).toBe(true);
    });
  });
});
