/**
 * Task system + SubAgent tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

import { TaskSystem } from '../../src/core/task/system.js';
import { SubAgent } from '../../src/core/subagent/agent.js';
import { NodeFileSystem } from '../../src/foundation/fs/index.js';
import { ToolRegistry } from '../../src/core/tools/registry.js';
import { registerBuiltinTools } from '../../src/core/tools/builtins/index.js';
import type { LLMResponse } from '../../src/types/message.js';
import type { ILLMService } from '../../src/foundation/llm/index.js';
import type { StreamChunk } from '../../src/foundation/llm/types.js';
import { LocalTransport } from '../../src/foundation/transport/local.js';

/**
 * Convert LLMResponse to stream chunks for mock
 */
async function* responseToStreamChunks(response: LLMResponse): AsyncIterableIterator<StreamChunk> {
  for (const block of response.content) {
    if (block.type === 'text') {
      yield { type: 'text_delta', delta: (block as { text: string }).text };
    } else if (block.type === 'tool_use') {
      const toolBlock = block as { id: string; name: string; input: unknown };
      yield {
        type: 'tool_use_start',
        toolUse: { id: toolBlock.id, name: toolBlock.name, partialInput: '' },
      };
      yield {
        type: 'tool_use_delta',
        toolUse: { id: '', name: '', partialInput: JSON.stringify(toolBlock.input) },
      };
    }
  }
  yield { type: 'done' };
}

async function createTempDir(): Promise<string> {
  const tempDir = path.join(tmpdir(), `clawforum-task-test-${randomUUID()}`);
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

function createMockLLM(responses: LLMResponse[]): ILLMService {
  let index = 0;
  const callMock = vi.fn(async () => {
    const response = responses[index++] || responses[responses.length - 1];
    return response;
  });
  return {
    call: callMock,
    stream: vi.fn((...args: unknown[]) => {
      // 复用 call mock 的返回值，转换为 stream chunks
      const result = callMock(...args);
      if (result instanceof Promise) {
        return (async function* () {
          const response = await result;
          yield* responseToStreamChunks(response as LLMResponse);
        })();
      }
      return responseToStreamChunks(result as LLMResponse);
    }),
    close: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue(true),
    getProviderInfo: vi.fn().mockReturnValue({ name: 'mock', model: 'test', isFallback: false }),
  } as unknown as ILLMService;
}

describe('Task System + SubAgent', () => {
  let tempDir: string;
  let mockFs: NodeFileSystem;
  let transport: LocalTransport;
  let taskSystem: TaskSystem;
  let registry: ToolRegistry;

  beforeEach(async () => {
    tempDir = await createTempDir();
    mockFs = new NodeFileSystem({ baseDir: tempDir, enforcePermissions: false });
    await mockFs.ensureDir('tasks');
    
    transport = new LocalTransport({ workspaceDir: tempDir });
    await transport.initialize();
    
    taskSystem = new TaskSystem(tempDir, mockFs, transport);
    await taskSystem.initialize();

    registry = new ToolRegistry();
    registerBuiltinTools(registry);
  });

  afterEach(async () => {
    await taskSystem.shutdown(1000);
    await transport.close();
    await cleanupTempDir(tempDir);
  });

  describe('TaskSystem', () => {
    it('should schedule subagent and return taskId', async () => {
      const taskId = await taskSystem.scheduleSubAgent({
        kind: 'subagent',
        prompt: 'Test task',
        skills: [],
        tools: ['read'],
        timeout: 60,
        maxSteps: 10,
        parentClawId: 'parent-claw',
      });

      expect(taskId).toBeDefined();
      expect(typeof taskId).toBe('string');

      // Check task file exists
      const runningExists = await mockFs.exists(`tasks/running/${taskId}.json`);
      expect(runningExists).toBe(true);
    });

    it('should move task to done when completed', async () => {
      // Create parent claw inbox
      await mockFs.ensureDir('claws/parent-claw/inbox/pending');

      const taskId = await taskSystem.scheduleSubAgent({
        kind: 'subagent',
        prompt: 'Simple task',
        skills: [],
        tools: [],
        timeout: 60,
        maxSteps: 5,
        parentClawId: 'parent-claw',
      });

      // Wait for task to complete
      await new Promise(r => setTimeout(r, 500));

      // Task should be moved to done
      const doneExists = await mockFs.exists(`tasks/done/${taskId}.json`);
      expect(doneExists).toBe(true);

      // Running file should not exist
      const runningExists = await mockFs.exists(`tasks/running/${taskId}.json`);
      expect(runningExists).toBe(false);
    });

    it('should cancel task', async () => {
      const taskId = await taskSystem.scheduleSubAgent({
        kind: 'subagent',
        prompt: 'Long running task',
        skills: [],
        tools: [],
        timeout: 300,
        maxSteps: 100,
        parentClawId: 'parent-claw',
      });

      await taskSystem.cancel(taskId);

      // Task should be removed from running
      const runningExists = await mockFs.exists(`tasks/running/${taskId}.json`);
      expect(runningExists).toBe(false);
    });
  });

  describe('SubAgent', () => {
    it('should run and return text result', async () => {
      const mockLLM = createMockLLM([{
        content: [{ type: 'text', text: 'Task completed successfully' }],
        stop_reason: 'end_turn',
      }]);

      const agent = new SubAgent({
        agentId: 'test-agent-1',
        prompt: 'Do something',
        clawDir: tempDir,
        llm: mockLLM,
        registry,
        fs: mockFs,
        maxSteps: 10,
        timeoutMs: 5000,
      });

      const result = await agent.run();

      expect(result).toContain('Task completed');
    });

    it('should execute tools in subagent profile', async () => {
      // Create a test file
      await mockFs.writeAtomic('test.txt', 'Hello from test file');

      const mockLLM = createMockLLM([
        {
          content: [
            { type: 'text', text: 'I will read the file' },
            { type: 'tool_use', id: 'call-1', name: 'read', input: { path: 'test.txt' } },
          ],
          stop_reason: 'tool_use',
        },
        {
          content: [{ type: 'text', text: 'File content is: Hello from test file' }],
          stop_reason: 'end_turn',
        },
      ]);

      const agent = new SubAgent({
        agentId: 'test-agent-2',
        prompt: 'Read test.txt',
        clawDir: tempDir,
        llm: mockLLM,
        registry,
        fs: mockFs,
        maxSteps: 10,
        timeoutMs: 5000,
      });

      const result = await agent.run();

      expect(mockLLM.call).toHaveBeenCalledTimes(2);
      expect(result).toContain('File content');
    });

    it('should have spawn permission disabled', async () => {
      // SubAgent uses 'subagent' profile which has spawn: false
      // This is verified by checking the profile permissions
      const { PERMISSION_PRESETS } = await import('../../src/core/tools/executor.js');
      expect(PERMISSION_PRESETS.subagent.spawn).toBe(false);
    });

    it('should timeout on long running task', async () => {
      const mockLLM = createMockLLM([
        {
          content: [{ type: 'text', text: 'Thinking...' }],
          stop_reason: 'end_turn',
        },
      ]);

      // Mock LLM to delay but check for abort
      (mockLLM.call as ReturnType<typeof vi.fn>).mockImplementation(async (options: { signal?: AbortSignal }) => {
        // Wait 1000ms but check for abort every 50ms
        for (let i = 0; i < 20; i++) {
          if (options.signal?.aborted) {
            throw new Error('Aborted');
          }
          await new Promise(r => setTimeout(r, 50));
        }
        return {
          content: [{ type: 'text', text: 'Done' }],
          stop_reason: 'end_turn',
        };
      });

      const agent = new SubAgent({
        agentId: 'test-agent-3',
        prompt: 'Slow task',
        clawDir: tempDir,
        llm: mockLLM,
        registry,
        fs: mockFs,
        maxSteps: 10,
        timeoutMs: 100, // Very short timeout
      });

      await expect(agent.run()).rejects.toThrow();
    });
  });
});
