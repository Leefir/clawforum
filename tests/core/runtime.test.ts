/**
 * ClawRuntime integration tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { ClawRuntime } from '../../src/core/runtime.js';
import type { LLMServiceConfig } from '../../src/foundation/llm/types.js';
import type { LLMResponse } from '../../src/types/message.js';

async function createTempDir(): Promise<string> {
  const tempDir = path.join(tmpdir(), `clawforum-runtime-test-${randomUUID()}`);
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

async function cleanupTempDir(tempDir: string): Promise<void> {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

function createMockLLMConfig(): LLMServiceConfig {
  return {
    primary: {
      name: 'mock',
      apiKey: 'test-key',
      model: 'test-model',
      maxTokens: 1024,
      temperature: 0.7,
      timeoutMs: 30000,
    },
    retryAttempts: 1,
    retryDelayMs: 100,
  };
}

function createMockLLM(responses: LLMResponse[]) {
  let index = 0;
  return {
    call: vi.fn(async () => {
      const response = responses[index++] || responses[responses.length - 1];
      return response;
    }),
    stream: vi.fn(),
    close: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true),
    getProviderInfo: vi.fn().mockReturnValue({ name: 'mock', model: 'test', isFallback: false }),
  };
}

describe('ClawRuntime', () => {
  let tempDir: string;
  let clawDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    clawDir = path.join(tempDir, 'claws', 'test-claw');
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('initialization', () => {
    it('should create all necessary directories', async () => {
      const runtime = new ClawRuntime({
        clawId: 'test-claw',
        clawDir,
        llmConfig: createMockLLMConfig(),
      });

      await runtime.initialize();

      // Check directories exist
      const dirs = [
        'dialog',
        'dialog/archive',
        'inbox/pending',
        'outbox/pending',
        'tasks',
        'memory',
        'contract',
        'skills',
        'clawspace',
        'logs',
      ];

      for (const dir of dirs) {
        const exists = await fs.stat(path.join(clawDir, dir)).then(() => true).catch(() => false);
        expect(exists).toBe(true);
      }
    });

    it('should be initialized after initialize()', async () => {
      const runtime = new ClawRuntime({
        clawId: 'test-claw',
        clawDir,
        llmConfig: createMockLLMConfig(),
      });

      expect(runtime.getStatus().initialized).toBe(false);
      await runtime.initialize();
      expect(runtime.getStatus().initialized).toBe(true);
    });
  });

  describe('chat()', () => {
    it('should return text response from LLM', async () => {
      const runtime = new ClawRuntime({
        clawId: 'test-claw',
        clawDir,
        llmConfig: createMockLLMConfig(),
      });

      // Mock LLM responses
      const mockLLM = createMockLLM([{
        content: [{ type: 'text', text: 'Hello from Claw!' }],
        stop_reason: 'end_turn',
      }]);

      // Replace LLM after initialization
      await runtime.initialize();
      (runtime as unknown as { llm: typeof mockLLM }).llm = mockLLM;

      const response = await runtime.chat('Hi!');
      expect(response).toBe('Hello from Claw!');
    });

    it('should maintain conversation history across calls', async () => {
      const runtime = new ClawRuntime({
        clawId: 'test-claw',
        clawDir,
        llmConfig: createMockLLMConfig(),
      });

      const mockLLM = createMockLLM([
        { content: [{ type: 'text', text: 'First' }], stop_reason: 'end_turn' },
        { content: [{ type: 'text', text: 'Second' }], stop_reason: 'end_turn' },
      ]);

      await runtime.initialize();
      (runtime as unknown as { llm: typeof mockLLM }).llm = mockLLM;

      await runtime.chat('Message 1');
      await runtime.chat('Message 2');

      // LLM should have been called twice
      expect(mockLLM.call).toHaveBeenCalledTimes(2);

      // Second call should include history from first
      const secondCallArgs = mockLLM.call.mock.calls[1][0];
      expect(secondCallArgs.messages.length).toBeGreaterThan(1);
    });

    it('should save session after chat', async () => {
      const runtime = new ClawRuntime({
        clawId: 'test-claw',
        clawDir,
        llmConfig: createMockLLMConfig(),
      });

      const mockLLM = createMockLLM([{
        content: [{ type: 'text', text: 'Saved!' }],
        stop_reason: 'end_turn',
      }]);

      await runtime.initialize();
      (runtime as unknown as { llm: typeof mockLLM }).llm = mockLLM;

      await runtime.chat('Save this');

      // Check current.json exists
      const currentPath = path.join(clawDir, 'dialog', 'current.json');
      const exists = await fs.stat(currentPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      // Check content
      const content = await fs.readFile(currentPath, 'utf-8');
      const session = JSON.parse(content);
      expect(session.clawId).toBe('test-claw');
      expect(session.messages.length).toBeGreaterThan(0);
    });
  });

  describe('start/stop', () => {
    it('should start and stop without error', async () => {
      const runtime = new ClawRuntime({
        clawId: 'test-claw',
        clawDir,
        llmConfig: createMockLLMConfig(),
      });

      await runtime.start();
      expect(runtime.getStatus().running).toBe(true);

      await runtime.stop();
      expect(runtime.getStatus().running).toBe(false);
    });

    it('should auto-initialize on start', async () => {
      const runtime = new ClawRuntime({
        clawId: 'test-claw',
        clawDir,
        llmConfig: createMockLLMConfig(),
      });

      expect(runtime.getStatus().initialized).toBe(false);
      await runtime.start();
      expect(runtime.getStatus().initialized).toBe(true);
    });
  });

  describe('status', () => {
    it('should return correct clawId', async () => {
      const runtime = new ClawRuntime({
        clawId: 'my-claw-123',
        clawDir,
        llmConfig: createMockLLMConfig(),
      });

      expect(runtime.getStatus().clawId).toBe('my-claw-123');
    });
  });
});
