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
import type { StreamChunk } from '../../src/foundation/llm/types.js';

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
    maxAttempts: 1,
    retryDelayMs: 100,
  };
}

function createMockLLM(responses: LLMResponse[]) {
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

  describe('processBatch()', () => {
    it('should return 0 when inbox is empty', async () => {
      const runtime = new ClawRuntime({
        clawId: 'test-claw',
        clawDir,
        llmConfig: createMockLLMConfig(),
      });
      await runtime.initialize();

      const count = await runtime.processBatch();
      expect(count).toBe(0);
    });

    it('should process messages in priority order', async () => {
      const runtime = new ClawRuntime({
        clawId: 'test-claw',
        clawDir,
        llmConfig: createMockLLMConfig(),
      });
      await runtime.initialize();

      // Create messages with different priorities
      const pendingDir = path.join(clawDir, 'inbox', 'pending');
      const messages = [
        { name: 'normal_msg.md', priority: 'normal', content: 'Normal priority' },
        { name: 'critical_msg.md', priority: 'critical', content: 'Critical priority' },
        { name: 'high_msg.md', priority: 'high', content: 'High priority' },
      ];

      for (const msg of messages) {
        const content = `---
id: ${msg.name}
type: message
from: motion
priority: ${msg.priority}
timestamp: ${new Date().toISOString()}
---

${msg.content}
`;
        await fs.writeFile(path.join(pendingDir, msg.name), content);
      }

      // Mock LLM
      const mockLLM = createMockLLM([{
        content: [{ type: 'text', text: 'Processed batch' }],
        stop_reason: 'end_turn',
      }]);
      (runtime as unknown as { llm: typeof mockLLM }).llm = mockLLM;

      // Process batch
      const count = await runtime.processBatch();
      expect(count).toBe(3);

      // Verify messages moved to done/
      const doneDir = path.join(clawDir, 'inbox', 'done');
      const doneFiles = await fs.readdir(doneDir);
      expect(doneFiles.length).toBe(3);

      // Verify LLM was called once (batch processing)
      expect(mockLLM.call).toHaveBeenCalledTimes(1);

      // Verify all inbox messages were merged into a single user message (priority order preserved)
      const callArgs = mockLLM.call.mock.calls[0][0];
      const userMessages = callArgs.messages.filter((m: { role: string }) => m.role === 'user');
      expect(userMessages.length).toBe(1);
      // All three messages present, critical first
      const combined = userMessages[0].content;
      expect(combined).toContain('Critical priority');
      expect(combined).toContain('High priority');
      expect(combined).toContain('Normal priority');
      // Critical appears before High, High before Normal
      expect(combined.indexOf('Critical priority')).toBeLessThan(combined.indexOf('High priority'));
      expect(combined.indexOf('High priority')).toBeLessThan(combined.indexOf('Normal priority'));
    });

    it('should move messages to done before LLM call', async () => {
      const runtime = new ClawRuntime({
        clawId: 'test-claw',
        clawDir,
        llmConfig: createMockLLMConfig(),
      });
      await runtime.initialize();

      // Create a message
      const pendingDir = path.join(clawDir, 'inbox', 'pending');
      const content = `---
id: test-msg
type: message
from: motion
priority: normal
timestamp: ${new Date().toISOString()}
---

Test message
`;
      await fs.writeFile(path.join(pendingDir, 'test.md'), content);

      // Mock LLM that checks if file was moved
      const mockLLM = createMockLLM([{
        content: [{ type: 'text', text: 'Done' }],
        stop_reason: 'end_turn',
      }]);
      (runtime as unknown as { llm: typeof mockLLM }).llm = mockLLM;

      await runtime.processBatch();

      // Pending should be empty
      const pendingFiles = await fs.readdir(pendingDir);
      expect(pendingFiles.filter(f => f.endsWith('.md')).length).toBe(0);

      // Done should have the file
      const doneDir = path.join(clawDir, 'inbox', 'done');
      const doneFiles = await fs.readdir(doneDir);
      expect(doneFiles.length).toBe(1);
    });
  });

  describe('resumeContractIfPaused()', () => {
    it('should not throw when no active contract', async () => {
      const runtime = new ClawRuntime({
        clawId: 'test-claw',
        clawDir,
        llmConfig: createMockLLMConfig(),
      });
      await runtime.initialize();

      // Should not throw
      await expect(runtime.resumeContractIfPaused()).resolves.not.toThrow();
    });
  });

  // ─── inbox edge cases ────────────────────────────────────────────────────────

  describe('_drainOwnInbox edge cases', () => {
    async function makeRuntime() {
      const runtime = new ClawRuntime({
        clawId: 'test-claw',
        clawDir,
        llmConfig: createMockLLMConfig(),
      });
      await runtime.initialize();
      return runtime;
    }

    function writePendingMsg(pendingDir: string, filename: string, content: string) {
      return fs.writeFile(path.join(pendingDir, filename), content);
    }

    function validMsgContent(id: string, body: string, priority = 'normal') {
      return `---\nid: ${id}\ntype: message\nfrom: motion\npriority: ${priority}\ntimestamp: ${new Date().toISOString()}\n---\n\n${body}\n`;
    }

    it('non-.md files in inbox/pending trigger console.warn and are skipped', async () => {
      const runtime = await makeRuntime();
      const pendingDir = path.join(clawDir, 'inbox', 'pending');

      // One valid message + one non-.md intruder
      await writePendingMsg(pendingDir, 'valid.md', validMsgContent('v1', 'hello'));
      await writePendingMsg(pendingDir, 'stray.tmp', 'not a markdown file');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mockLLM = createMockLLM([{
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
      }]);
      (runtime as unknown as { llm: typeof mockLLM }).llm = mockLLM;

      const count = await runtime.processBatch();

      // The .tmp file is skipped but the .md is processed
      expect(count).toBe(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('stray.tmp'));
      warnSpy.mockRestore();
    });

    it('malformed frontmatter .md files are silently skipped', async () => {
      const runtime = await makeRuntime();
      const pendingDir = path.join(clawDir, 'inbox', 'pending');

      // Good message alongside broken one
      await writePendingMsg(pendingDir, 'good.md', validMsgContent('g1', 'good'));
      // File starts with --- but has no closing ---, so parseFrontmatter throws
      await writePendingMsg(pendingDir, 'broken.md', '---\ntype: message\nno-closing-dashes-ever');

      const mockLLM = createMockLLM([{
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
      }]);
      (runtime as unknown as { llm: typeof mockLLM }).llm = mockLLM;

      // Should not throw; only the good message is processed
      await expect(runtime.processBatch()).resolves.toBe(1);
    });

    it('heartbeat type without HEARTBEAT.md returns base text', async () => {
      const runtime = await makeRuntime();
      const pendingDir = path.join(clawDir, 'inbox', 'pending');

      // No HEARTBEAT.md in clawDir — heartbeat catch block returns base
      await writePendingMsg(pendingDir, 'hb.md', `---\nid: hb1\ntype: heartbeat\nfrom: system\npriority: normal\ntimestamp: ${new Date().toISOString()}\n---\n\n`);

      const mockLLM = createMockLLM([{
        content: [{ type: 'text', text: 'checked' }],
        stop_reason: 'end_turn',
      }]);
      (runtime as unknown as { llm: typeof mockLLM }).llm = mockLLM;

      await runtime.processBatch();

      const callArgs = mockLLM.call.mock.calls[0][0];
      const userMsg = callArgs.messages.find((m: { role: string }) => m.role === 'user');
      expect(userMsg?.content).toContain('Heartbeat triggered');
      // No checklist appended when HEARTBEAT.md is absent
      expect(userMsg?.content).not.toContain('\n\n');
    });

    it('heartbeat type with HEARTBEAT.md appends checklist', async () => {
      const runtime = await makeRuntime();
      const pendingDir = path.join(clawDir, 'inbox', 'pending');

      // Write HEARTBEAT.md to clawDir
      await fs.writeFile(path.join(clawDir, 'HEARTBEAT.md'), '- Check disk space\n- Verify connections\n');

      await writePendingMsg(pendingDir, 'hb.md', `---\nid: hb2\ntype: heartbeat\nfrom: system\npriority: normal\ntimestamp: ${new Date().toISOString()}\n---\n\n`);

      const mockLLM = createMockLLM([{
        content: [{ type: 'text', text: 'done' }],
        stop_reason: 'end_turn',
      }]);
      (runtime as unknown as { llm: typeof mockLLM }).llm = mockLLM;

      await runtime.processBatch();

      const callArgs = mockLLM.call.mock.calls[0][0];
      const userMsg = callArgs.messages.find((m: { role: string }) => m.role === 'user');
      expect(userMsg?.content).toContain('Heartbeat triggered');
      expect(userMsg?.content).toContain('Check disk space');
    });

    it('messages with to: a different agent are skipped from injection', async () => {
      const runtime = await makeRuntime();
      const pendingDir = path.join(clawDir, 'inbox', 'pending');

      // Write two messages: one to this agent, one to a subagent
      await writePendingMsg(
        pendingDir,
        'for-me.md',
        `---\nid: msg1\ntype: message\nfrom: motion\nto: test-claw\npriority: normal\ntimestamp: ${new Date().toISOString()}\n---\n\nMessage for me`,
      );
      await writePendingMsg(
        pendingDir,
        'for-subagent.md',
        `---\nid: msg2\ntype: message\nfrom: task_system\nto: some-subagent-uuid\npriority: normal\ntimestamp: ${new Date().toISOString()}\n---\n\nMessage for subagent`,
      );

      const mockLLM = createMockLLM([{
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
      }]);
      (runtime as unknown as { llm: typeof mockLLM }).llm = mockLLM;

      // processBatch drains inbox (2 files moved to done)
      await runtime.processBatch();

      // Only the message addressed to test-claw should be injected into LLM context
      const callArgs = mockLLM.call.mock.calls[0][0];
      const userMsg = callArgs.messages.find((m: { role: string }) => m.role === 'user');
      expect(userMsg?.content).toContain('Message for me');
      expect(userMsg?.content).not.toContain('Message for subagent');

      // Audit log should show inbox_skip for the subagent message
      const auditLog = await fs.readFile(path.join(clawDir, 'logs', 'audit.log'), 'utf-8');
      const entries = auditLog.trim().split('\n').map(line => JSON.parse(line));
      const skipEntry = entries.find((e: { event: string }) => e.event === 'inbox_skip');
      expect(skipEntry).toBeDefined();
      expect(skipEntry.to).toBe('some-subagent-uuid');
    });
  });

  // ─── retryLastTurn() ──────────────────────────────────────────────────────

  describe('retryLastTurn()', () => {
    it('returns immediately when session has no messages (empty session guard)', async () => {
      const runtime = new ClawRuntime({
        clawId: 'test-claw',
        clawDir,
        llmConfig: createMockLLMConfig(),
      });
      await runtime.initialize();

      const mockLLM = createMockLLM([]);
      (runtime as unknown as { llm: typeof mockLLM }).llm = mockLLM;

      // No messages have been exchanged — session is empty
      await expect(runtime.retryLastTurn()).resolves.toBeUndefined();

      // LLM must NOT have been called
      expect(mockLLM.call).not.toHaveBeenCalled();
      expect(mockLLM.stream).not.toHaveBeenCalled();
    });

    it('replays last turn by calling LLM with existing session messages', async () => {
      const runtime = new ClawRuntime({
        clawId: 'test-claw',
        clawDir,
        llmConfig: createMockLLMConfig(),
      });
      await runtime.initialize();

      // Populate session via chat()
      const firstLLM = createMockLLM([{
        content: [{ type: 'text', text: 'Initial answer' }],
        stop_reason: 'end_turn',
      }]);
      (runtime as unknown as { llm: typeof firstLLM }).llm = firstLLM;
      await runtime.chat('What is 2+2?');

      // Now replace LLM and retry — should call the NEW LLM with the saved session
      const retryLLM = createMockLLM([{
        content: [{ type: 'text', text: 'Retry answer' }],
        stop_reason: 'end_turn',
      }]);
      (runtime as unknown as { llm: typeof retryLLM }).llm = retryLLM;

      await runtime.retryLastTurn();

      expect(retryLLM.call).toHaveBeenCalledTimes(1);
      const callArg = retryLLM.call.mock.calls[0][0];
      // The session messages from the first chat() exchange are included
      expect(callArg.messages.length).toBeGreaterThan(0);
    });

    it('cleans up AbortController even when _runReact throws', async () => {
      const runtime = new ClawRuntime({
        clawId: 'test-claw',
        clawDir,
        llmConfig: createMockLLMConfig(),
      });
      await runtime.initialize();

      // Build a session first
      const setupLLM = createMockLLM([
        { content: [{ type: 'text', text: 'setup' }], stop_reason: 'end_turn' },
      ]);
      (runtime as unknown as { llm: typeof setupLLM }).llm = setupLLM;
      await runtime.chat('setup');

      // Replace LLM with one that throws
      const failingLLM = {
        call: vi.fn().mockRejectedValue(new Error('LLM network error')),
        stream: vi.fn().mockImplementation(async function* () { throw new Error('LLM network error'); }),
        close: vi.fn(),
        healthCheck: vi.fn().mockResolvedValue(true),
      };
      (runtime as unknown as { llm: typeof failingLLM }).llm = failingLLM;

      await expect(runtime.retryLastTurn()).rejects.toThrow('LLM network error');

      // finally block must have cleared the AbortController
      expect((runtime as unknown as { currentAbortController: unknown }).currentAbortController).toBeNull();
    });

    it('cleans up AbortController on successful completion', async () => {
      const runtime = new ClawRuntime({
        clawId: 'test-claw',
        clawDir,
        llmConfig: createMockLLMConfig(),
      });
      await runtime.initialize();

      // Build a session first
      const mockLLM = createMockLLM([
        { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' },
        { content: [{ type: 'text', text: 'retry ok' }], stop_reason: 'end_turn' },
      ]);
      (runtime as unknown as { llm: typeof mockLLM }).llm = mockLLM;
      await runtime.chat('setup');

      await runtime.retryLastTurn();

      // AbortController must be null after retryLastTurn resolves
      expect((runtime as unknown as { currentAbortController: unknown }).currentAbortController).toBeNull();
    });
  });
});
