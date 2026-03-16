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
  // clawDir 必须是 workspace/claws/{name} 结构
  // runtime.ts:125 做 path.resolve(clawDir, '..', '..') 推算 workspaceDir
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'motion-test-'));
  const clawDir = path.join(base, 'claws', 'motion-test');
  await fs.mkdir(clawDir, { recursive: true });
  return clawDir;
}

async function cleanupDir(clawDir: string): Promise<void> {
  // clawDir = base/claws/motion-test，清理 base 根目录
  const base = path.resolve(clawDir, '..', '..');
  await fs.rm(base, { recursive: true, force: true });
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

  describe('processBatch() - claw outbox routing', () => {
    // 辅助函数：创建 workspace 结构（motion 和 claws/ 是兄弟目录，匹配实际 .clawforum 结构）
    async function createWorkspace(tempDir: string) {
      // 模拟 .clawforum 结构：
      // tempDir/
      //   motion/        <-- motionDir (getMotionDir())
      //   claws/         <-- clawsDir
      //     claw1/
      //     claw2/
      const motionDir = path.join(tempDir, 'motion');
      const clawsDir = path.join(tempDir, 'claws');
      
      // motion 目录结构
      await fs.mkdir(path.join(motionDir, 'dialog'), { recursive: true });
      await fs.writeFile(path.join(motionDir, 'AGENTS.md'), 'Test');
      await fs.mkdir(path.join(motionDir, 'skills'), { recursive: true });
      await fs.mkdir(path.join(motionDir, 'memory'), { recursive: true });
      await fs.mkdir(path.join(motionDir, 'clawspace'), { recursive: true });
      await fs.mkdir(path.join(motionDir, 'inbox', 'pending'), { recursive: true });
      
      return { motionDir, clawsDir };
    }

    it('should return 0 when no claw outbox messages', async () => {
      const { motionDir } = await createWorkspace(tempDir);

      runtime = new MotionRuntime({
        clawId: 'motion',
        clawDir: motionDir,
        llmConfig: mockLLMConfig,
      });

      await runtime.initialize();

      // Act
      const count = await runtime.processBatch();

      // Assert
      expect(count).toBe(0);
    });

    it('should drain claw outbox messages', async () => {
      const { motionDir, clawsDir } = await createWorkspace(tempDir);
      
      // 创建 claw1
      const claw1Dir = path.join(clawsDir, 'claw1');
      await fs.mkdir(path.join(claw1Dir, 'outbox', 'pending'), { recursive: true });
      await fs.writeFile(path.join(claw1Dir, 'outbox', 'pending', 'msg1.md'), 'Hello from claw1');

      runtime = new MotionRuntime({
        clawId: 'motion',
        clawDir: motionDir,
        llmConfig: mockLLMConfig,
      });

      await runtime.initialize();

      // Mock _runReact 避免实际 LLM 调用
      let capturedMessages: any[] = [];
      (runtime as any)._runReact = async (messages: any[]) => {
        capturedMessages = messages;
      };

      // Act
      const count = await runtime.processBatch();

      // Assert
      expect(count).toBe(1);
      expect(capturedMessages.length).toBeGreaterThan(0);
      const userMsg = capturedMessages.find((m: any) => m.role === 'user' && m.content.includes('claw1'));
      expect(userMsg).toBeDefined();
      expect(userMsg.content).toContain('Hello from claw1');

      // 验证消息被移入 done/
      const doneDir = path.join(claw1Dir, 'outbox', 'done');
      const doneFiles = await fs.readdir(doneDir);
      expect(doneFiles.length).toBe(1);
    });

    it('should drain multiple claws outbox', async () => {
      const { motionDir, clawsDir } = await createWorkspace(tempDir);
      
      // claw1 消息
      const claw1Dir = path.join(clawsDir, 'claw1');
      await fs.mkdir(path.join(claw1Dir, 'outbox', 'pending'), { recursive: true });
      await fs.writeFile(path.join(claw1Dir, 'outbox', 'pending', 'msg1.md'), 'Message from claw1');

      // claw2 消息
      const claw2Dir = path.join(clawsDir, 'claw2');
      await fs.mkdir(path.join(claw2Dir, 'outbox', 'pending'), { recursive: true });
      await fs.writeFile(path.join(claw2Dir, 'outbox', 'pending', 'msg1.md'), 'Message from claw2');

      runtime = new MotionRuntime({
        clawId: 'motion',
        clawDir: motionDir,
        llmConfig: mockLLMConfig,
      });

      await runtime.initialize();

      // Mock _runReact
      let capturedMessages: any[] = [];
      (runtime as any)._runReact = async (messages: any[]) => {
        capturedMessages = messages;
      };

      // Act
      const count = await runtime.processBatch();

      // Assert
      expect(count).toBe(2);
      
      const claw1Msg = capturedMessages.find((m: any) => m.content?.includes('claw1'));
      const claw2Msg = capturedMessages.find((m: any) => m.content?.includes('claw2'));
      expect(claw1Msg).toBeDefined();
      expect(claw2Msg).toBeDefined();

      // 都移入 done/
      expect((await fs.readdir(path.join(claw1Dir, 'outbox', 'done'))).length).toBe(1);
      expect((await fs.readdir(path.join(claw2Dir, 'outbox', 'done'))).length).toBe(1);
    });

    it('should skip motion directory in claws/', async () => {
      const { motionDir, clawsDir } = await createWorkspace(tempDir);
      
      // motion 目录（应该被跳过，但 outbox 结构存在）
      await fs.mkdir(path.join(motionDir, 'outbox', 'pending'), { recursive: true });
      await fs.writeFile(path.join(motionDir, 'outbox', 'pending', 'msg.md'), 'Should be ignored');

      // claw1 目录（应该被处理）
      const claw1Dir = path.join(clawsDir, 'claw1');
      await fs.mkdir(path.join(claw1Dir, 'outbox', 'pending'), { recursive: true });
      await fs.writeFile(path.join(claw1Dir, 'outbox', 'pending', 'msg.md'), 'Valid message');

      runtime = new MotionRuntime({
        clawId: 'motion',
        clawDir: motionDir,
        llmConfig: mockLLMConfig,
      });

      await runtime.initialize();

      // Mock _runReact
      let capturedMessages: any[] = [];
      (runtime as any)._runReact = async (messages: any[]) => {
        capturedMessages = messages;
      };

      // Act
      const count = await runtime.processBatch();

      // Assert: 只处理了 claw1，跳过了 motion
      expect(count).toBe(1);
      expect(capturedMessages.some((m: any) => m.content?.includes('Valid message'))).toBe(true);
      expect(capturedMessages.some((m: any) => m.content?.includes('Should be ignored'))).toBe(false);
    });

    it('should move failed reads to failed/', async () => {
      const { motionDir, clawsDir } = await createWorkspace(tempDir);
      
      const claw1Dir = path.join(clawsDir, 'claw1');
      await fs.mkdir(path.join(claw1Dir, 'outbox', 'pending'), { recursive: true });
      // 创建一个无法读取的文件（通过创建目录来模拟）
      await fs.mkdir(path.join(claw1Dir, 'outbox', 'pending', 'bad_msg.md'), { recursive: true });

      runtime = new MotionRuntime({
        clawId: 'motion',
        clawDir: motionDir,
        llmConfig: mockLLMConfig,
      });

      await runtime.initialize();

      // Mock _runReact
      (runtime as any)._runReact = async () => {};

      // Act
      await runtime.processBatch();

      // Assert: 失败文件移入 failed/
      const failedDir = path.join(claw1Dir, 'outbox', 'failed');
      const failedFiles = await fs.readdir(failedDir);
      expect(failedFiles.length).toBe(1);
    });
  });
});
