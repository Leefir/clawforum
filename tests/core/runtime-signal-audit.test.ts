/**
 * Runtime SignalAudit integration tests
 */

import type { RuntimeTestInternals } from '../helpers/runtime-test-internals.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { Runtime } from '../../src/core/runtime/index.js';
import { makeRuntimeDeps } from '../helpers/runtime-deps.js';
import { writeSessionWithIncompleteToolUse } from '../helpers/session-fixtures.js';
import type { InboxMessage } from '../../src/foundation/messaging/types.js';
import type { Message } from '../../src/foundation/llm-provider/types.js';
import { IdleTimeoutSignal, PriorityInboxInterrupt, UserInterrupt } from '../../src/core/signals.js';
import { createTempDir, cleanupTempDir } from '../utils/temp.js';
import { createTestRuntime, createMockLLMConfig, createMockLLM } from './_runtime-test-helpers.js';


describe('Runtime SignalAudit', () => {
  let tempDir: string;
  let clawDir: string;
  const runtimesToStop: Runtime[] = [];

  function trackRuntime(r: Runtime): Runtime {
    runtimesToStop.push(r);
    return r;
  }

  beforeEach(async () => {
    vi.restoreAllMocks();
    tempDir = await createTempDir();
    clawDir = path.join(tempDir, 'claws', 'test-claw');
  });

  afterEach(async () => {
    for (const r of runtimesToStop.splice(0)) {
      await r.stop().catch(() => {});
    }
    await cleanupTempDir(tempDir);
  });

  describe('processBatch() — signal interrupts do not send outbox notifications', () => {
    class SignalTestRuntime extends Runtime {
      public drainResult: {
        injected: Message[];
        sources: Array<{ text: string; type: string }>;
        count: number;
        infos: Array<{ meta: Record<string, string>; body?: string }>;
        addressedHandles: any[];
      } = { injected: [], sources: [], count: 0, infos: [], addressedHandles: [] };
      public reactThrow: unknown = null;

      protected override async _drainOwnInbox() {
        return this.drainResult as any;
      }

      protected override async _runReact(_messages: Message[]) {
        if (this.reactThrow) throw this.reactThrow;
      }
    }

    let tempDir2: string;
    let clawDir2: string;
    const signalRuntimes: Runtime[] = [];

    beforeEach(async () => {
      tempDir2 = path.join(tmpdir(), `clawforum-signal-test-${randomUUID()}`);
      clawDir2 = path.join(tempDir2, 'claws', 'sig-claw');
      await fs.mkdir(clawDir2, { recursive: true });
    });

    afterEach(async () => {
      for (const r of signalRuntimes.splice(0)) {
        await r.stop().catch(() => {});
      }
      await fs.rm(tempDir2, { recursive: true, force: true }).catch(() => {});
    });

    async function makeSignalRuntime() {
      const deps = await makeRuntimeDeps({ clawDir: clawDir2, clawId: 'sig-claw' });
      const r = new SignalTestRuntime({
        clawId: 'sig-claw',
        clawDir: clawDir2,
        llmConfig: createMockLLMConfig(),
        dependencies: deps,
      });
      signalRuntimes.push(r);
      await r.initialize();
      r.drainResult = {
        injected: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        sources: [],
        count: 1,
        infos: [{
          id: 'msg1',
          type: 'message',
          from: 'sender-claw',
          to: 'sig-claw',
          content: 'hi',
          priority: 'normal',
          timestamp: new Date().toISOString(),
        } as InboxMessage],
        addressedHandles: [],
      };
      return r;
    }

    async function outboxFiles() {
      const dir = path.join(clawDir2, 'outbox', 'pending');
      return (await fs.readdir(dir)).filter(f => f.endsWith('.md'));
    }

    it('IdleTimeoutSignal — no outbox notification sent', async () => {
      const r = await makeSignalRuntime();
      r.reactThrow = new IdleTimeoutSignal(30000);
      await expect(r.processBatch()).rejects.toBeInstanceOf(IdleTimeoutSignal);
      expect(await outboxFiles()).toHaveLength(0);
    });

    it('PriorityInboxInterrupt — no outbox notification sent', async () => {
      const r = await makeSignalRuntime();
      r.reactThrow = new PriorityInboxInterrupt();
      await expect(r.processBatch()).rejects.toBeInstanceOf(PriorityInboxInterrupt);
      expect(await outboxFiles()).toHaveLength(0);
    });

    it('UserInterrupt — no outbox notification sent', async () => {
      const r = await makeSignalRuntime();
      r.reactThrow = new UserInterrupt();
      await expect(r.processBatch()).rejects.toBeInstanceOf(UserInterrupt);
      expect(await outboxFiles()).toHaveLength(0);
    });

    it('generic Error — outbox notification IS sent to sender', async () => {
      const r = await makeSignalRuntime();
      r.reactThrow = new Error('unexpected crash');
      await expect(r.processBatch()).rejects.toThrow('unexpected crash');
      const files = await outboxFiles();
      expect(files.length).toBeGreaterThan(0);
    });
  });

  // ─── onProviderInfo ───────────────────────────────────────────────────────────

  describe('onProviderInfo', () => {
    let piTempDir: string;
    let piClawDir: string;
    const piRuntimes: Runtime[] = [];

    beforeEach(async () => {
      piTempDir = path.join(tmpdir(), `clawforum-pi-test-${randomUUID()}`);
      piClawDir = path.join(piTempDir, 'claws', 'pi-claw');
      await fs.mkdir(piClawDir, { recursive: true });
    });

    afterEach(async () => {
      for (const r of piRuntimes.splice(0)) {
        await r.stop().catch(() => {});
      }
      await fs.rm(piTempDir, { recursive: true, force: true }).catch(() => {});
    });

    it('首个 text_delta 触发 onProviderInfo，携带 getProviderInfo() 返回值', async () => {
      const runtime = await createTestRuntime({
        clawId: 'pi-claw',
        clawDir: piClawDir,
        llmConfig: createMockLLMConfig(),
      });
      piRuntimes.push(runtime);
      const mockLLM = createMockLLM([{
        content: [{ type: 'text', text: 'Hello' }],
        stop_reason: 'end_turn',
      }]);
      mockLLM.getProviderInfo.mockReturnValue({ name: 'anthropic', model: 'claude-opus-4-6', isFallback: false });

      await runtime.initialize();
      (runtime as unknown as RuntimeTestInternals).llm = mockLLM;

      const onProviderInfo = vi.fn();
      await runtime.chat('Hi', { onProviderInfo });

      expect(onProviderInfo).toHaveBeenCalledTimes(1);
      expect(onProviderInfo).toHaveBeenCalledWith({ name: 'anthropic', model: 'claude-opus-4-6', isFallback: false });
    });

    it('同一 turn 多个 delta 只触发一次', async () => {
      const runtime = await createTestRuntime({
        clawId: 'pi-claw',
        clawDir: piClawDir,
        llmConfig: createMockLLMConfig(),
      });
      piRuntimes.push(runtime);

      // 用自定义 stream mock 产生多个 text_delta
      const multiDeltaLLM = {
        call: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'abc' }], stop_reason: 'end_turn' }),
        stream: vi.fn(async function* () {
          yield { type: 'text_delta', delta: 'a' };
          yield { type: 'text_delta', delta: 'b' };
          yield { type: 'text_delta', delta: 'c' };
          yield { type: 'done' };
        }),
        close: vi.fn(),
        healthCheck: vi.fn().mockResolvedValue(true),
        getProviderInfo: vi.fn().mockReturnValue({ name: 'anthropic', model: 'claude-opus-4-6', isFallback: false }),
      };

      await runtime.initialize();
      (runtime as unknown as RuntimeTestInternals).llm = multiDeltaLLM;

      const onProviderInfo = vi.fn();
      await runtime.chat('Hi', { onProviderInfo });

      expect(onProviderInfo).toHaveBeenCalledTimes(1);
    });

    it('fallback provider 时 isFallback=true 被传递', async () => {
      const runtime = await createTestRuntime({
        clawId: 'pi-claw',
        clawDir: piClawDir,
        llmConfig: createMockLLMConfig(),
      });
      piRuntimes.push(runtime);
      const mockLLM = createMockLLM([{
        content: [{ type: 'text', text: 'Hi' }],
        stop_reason: 'end_turn',
      }]);
      mockLLM.getProviderInfo.mockReturnValue({ name: 'openai', model: 'gpt-4o', isFallback: true });

      await runtime.initialize();
      (runtime as unknown as RuntimeTestInternals).llm = mockLLM;

      const onProviderInfo = vi.fn();
      await runtime.chat('Hi', { onProviderInfo });

      expect(onProviderInfo).toHaveBeenCalledWith(
        expect.objectContaining({ isFallback: true, name: 'openai' })
      );
    });

    it('连续两个 turn 各触发一次（每 turn 独立计数）', async () => {
      const runtime = await createTestRuntime({
        clawId: 'pi-claw',
        clawDir: piClawDir,
        llmConfig: createMockLLMConfig(),
      });
      piRuntimes.push(runtime);
      const mockLLM = createMockLLM([
        { content: [{ type: 'text', text: 'First' }], stop_reason: 'end_turn' },
        { content: [{ type: 'text', text: 'Second' }], stop_reason: 'end_turn' },
      ]);
      await runtime.initialize();
      (runtime as unknown as RuntimeTestInternals).llm = mockLLM;

      const onProviderInfo = vi.fn();
      await runtime.chat('Turn 1', { onProviderInfo });
      await runtime.chat('Turn 2', { onProviderInfo });

      expect(onProviderInfo).toHaveBeenCalledTimes(2);
    });
  });

  describe('session_loaded audit timing', () => {
    it('session_loaded should not pollute summarizeLastExit tail-read on restart', async () => {
      const clawDir = await fs.mkdtemp(path.join(tmpdir(), 'clawforum-runtime-audit-'));
      const clawSubDir = path.join(clawDir, 'claws', 'audit-claw');
      await fs.mkdir(clawSubDir, { recursive: true });

      // 构造一个带有 daemon_stop 的 audit.tsv（模拟正常退出的上一次运行）
      const auditPath = path.join(clawSubDir, 'audit.tsv');
      await fs.writeFile(auditPath, `2026-04-17T00:00:00.000Z\tdaemon_stop\treason=sigterm\n`);

      // 不创建 dialog/current.json，使 sessionManager.load() 返回 empty session

      const runtime = trackRuntime(await createTestRuntime({
        clawId: 'audit-claw',
        clawDir: clawSubDir,
        llmConfig: createMockLLMConfig(),
      }));
      await runtime.initialize();

      // 读取 initialize 后 audit.tsv 的内容
      const auditContent = await fs.readFile(auditPath, 'utf-8');
      const lines = auditContent.trim().split('\n');

      // 验证 audit.tsv 中 daemon_stop 在 session_loaded 之前——
      // 如果 session_loaded 在 summarizeLastExit 之前写入，当初 summarizeLastExit 读到的就会是 session_loaded 而非 daemon_stop
      const sessionLoadedIndex = lines.findIndex((l: string) => l.includes('session_loaded'));
      const daemonStopIndex = lines.findIndex((l: string) => l.includes('daemon_stop'));
      expect(sessionLoadedIndex).toBeGreaterThan(daemonStopIndex);

      // 验证 session_loaded 确实被写入了
      expect(sessionLoadedIndex).not.toBe(-1);
    });
  });

  describe('Runtime session-repair failure branches (phase155C)', () => {
    it('snapshot.commit 抛错 → audit snapshot_commit_failed context=session-repair + 不抛', async () => {
      const tmpDir = path.join(tmpdir(), `clawforum-repair-test-${randomUUID()}`);
      const clawSubDir = path.join(tmpDir, 'claws', 'repair-claw');
      await fs.mkdir(clawSubDir, { recursive: true });
      await writeSessionWithIncompleteToolUse(clawSubDir, 'repair-claw');

      const deps = await makeRuntimeDeps({ clawId: 'repair-claw', clawDir: clawSubDir });
      vi.spyOn(deps.taskSystem, 'initialize').mockResolvedValue(undefined);
      vi.spyOn(deps.taskSystem, 'startDispatch').mockImplementation(() => {});

      const events: string[] = [];
      vi.spyOn(deps.auditWriter, 'write').mockImplementation((type: string, ...args: string[]) => {
        events.push([type, ...args].join('\t'));
      });
      vi.spyOn(deps.snapshot, 'commit').mockRejectedValue(new Error('injected fs error'));

      const runtime = new Runtime({
        clawId: 'repair-claw',
        clawDir: clawSubDir,
        llmConfig: createMockLLMConfig(),
        dependencies: deps,
      });

      await expect(runtime.initialize()).resolves.not.toThrow();

      expect(events.some(e =>
        /^snapshot_commit_failed\tcontext=session-repair\treason=injected fs error/.test(e)
      )).toBe(true);

      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });

    it('snapshot.commit 返 uncategorized error → audit snapshot_commit_uncategorized + 不抛', async () => {
      const tmpDir = path.join(tmpdir(), `clawforum-repair-test-${randomUUID()}`);
      const clawSubDir = path.join(tmpDir, 'claws', 'repair-claw');
      await fs.mkdir(clawSubDir, { recursive: true });
      await writeSessionWithIncompleteToolUse(clawSubDir, 'repair-claw');

      const deps = await makeRuntimeDeps({ clawId: 'repair-claw', clawDir: clawSubDir });
      vi.spyOn(deps.taskSystem, 'initialize').mockResolvedValue(undefined);
      vi.spyOn(deps.taskSystem, 'startDispatch').mockImplementation(() => {});

      const events: string[] = [];
      vi.spyOn(deps.auditWriter, 'write').mockImplementation((type: string, ...args: string[]) => {
        events.push([type, ...args].join('\t'));
      });
      vi.spyOn(deps.snapshot, 'commit').mockResolvedValue({
        ok: false,
        error: { kind: 'uncategorized', exitCode: 127 },
      } as any);

      const runtime = new Runtime({
        clawId: 'repair-claw',
        clawDir: clawSubDir,
        llmConfig: createMockLLMConfig(),
        dependencies: deps,
      });

      await expect(runtime.initialize()).resolves.not.toThrow();

      expect(events.some(e =>
        /^snapshot_commit_uncategorized\tcontext=session-repair\texitCode=127/.test(e)
      )).toBe(true);

      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });
  });

  // ─── Runtime audit events direct assertion (phase405) ────────────────────────

  describe('Runtime audit events - turn lifecycle direct assertion', () => {
    it('processBatch emits turn_start + turn_end on success', async () => {
      const runtime = trackRuntime(await createTestRuntime({
        clawId: 'test-claw',
        clawDir,
        llmConfig: createMockLLMConfig(),
      }));
      await runtime.initialize();

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

      const mockLLM = createMockLLM([{
        content: [{ type: 'text', text: 'Processed' }],
        stop_reason: 'end_turn',
      }]);
      (runtime as unknown as RuntimeTestInternals).llm = mockLLM;

      const auditSpy = vi.spyOn((runtime as unknown as RuntimeTestInternals).auditWriter, 'write');
      await runtime.processBatch();
      const calls = auditSpy.mock.calls.map((c: any[]) => c[0]);
      expect(calls).toContain('turn_start');
      expect(calls).toContain('turn_end');
      auditSpy.mockRestore();
    });

    it('processWithMessage emits turn_start + turn_end on success', async () => {
      const runtime = trackRuntime(await createTestRuntime({
        clawId: 'test-claw',
        clawDir,
        llmConfig: createMockLLMConfig(),
      }));
      await runtime.initialize();

      const mockLLM = createMockLLM([{
        content: [{ type: 'text', text: 'Reply' }],
        stop_reason: 'end_turn',
      }]);
      (runtime as unknown as RuntimeTestInternals).llm = mockLLM;

      const auditSpy = vi.spyOn((runtime as unknown as RuntimeTestInternals).auditWriter, 'write');
      await runtime.processWithMessage({ role: 'user', content: 'hello' });
      const calls = auditSpy.mock.calls.map((c: any[]) => c[0]);
      expect(calls).toContain('turn_start');
      expect(calls).toContain('turn_end');
      auditSpy.mockRestore();
    });

    it('retryLastTurn emits turn_start + turn_end on success', async () => {
      const runtime = trackRuntime(await createTestRuntime({
        clawId: 'test-claw',
        clawDir,
        llmConfig: createMockLLMConfig(),
      }));
      await runtime.initialize();

      const mockLLM = createMockLLM([
        { content: [{ type: 'text', text: 'First' }], stop_reason: 'end_turn' },
        { content: [{ type: 'text', text: 'Retry' }], stop_reason: 'end_turn' },
      ]);
      (runtime as unknown as RuntimeTestInternals).llm = mockLLM;
      await runtime.chat('setup');

      const auditSpy = vi.spyOn((runtime as unknown as RuntimeTestInternals).auditWriter, 'write');
      await runtime.retryLastTurn();
      const calls = auditSpy.mock.calls.map((c: any[]) => c[0]);
      expect(calls).toContain('turn_start');
      expect(calls).toContain('turn_end');
      auditSpy.mockRestore();
    });
  });

  describe('Runtime audit events - llm_call / llm_error', () => {
    it('LLM success emits llm_call with model/tokens/ms', async () => {
      const runtime = trackRuntime(await createTestRuntime({
        clawId: 'test-claw',
        clawDir,
        llmConfig: createMockLLMConfig(),
      }));
      await runtime.initialize();

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

      const mockLLM = createMockLLM([{
        content: [{ type: 'text', text: 'Processed' }],
        stop_reason: 'end_turn',
      }]);
      mockLLM.getProviderInfo.mockReturnValue({ name: 'mock', model: 'test-model', isFallback: false });
      (runtime as unknown as RuntimeTestInternals).llm = mockLLM;

      const auditSpy = vi.spyOn((runtime as unknown as RuntimeTestInternals).auditWriter, 'write');
      await runtime.processBatch();
      expect(auditSpy).toHaveBeenCalledWith('llm_call', 'test-model', expect.stringContaining('in='), expect.stringContaining('out='), expect.stringContaining('latency_ms='));
      auditSpy.mockRestore();
    });

    it('LLM failure emits llm_error with model/err/ms', async () => {
      const runtime = trackRuntime(await createTestRuntime({
        clawId: 'test-claw',
        clawDir,
        llmConfig: createMockLLMConfig(),
      }));
      await runtime.initialize();

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

      const failingLLM = {
        call: vi.fn().mockRejectedValue(new Error('LLM network error')),
        stream: vi.fn().mockImplementation(async function* () { throw new Error('LLM network error'); }),
        close: vi.fn(),
        healthCheck: vi.fn().mockResolvedValue(true),
        getProviderInfo: vi.fn().mockReturnValue({ name: 'mock', model: 'failing-model', isFallback: false }),
      };
      (runtime as unknown as RuntimeTestInternals).llm = failingLLM;

      const auditSpy = vi.spyOn((runtime as unknown as RuntimeTestInternals).auditWriter, 'write');
      await expect(runtime.processBatch()).rejects.toThrow('LLM network error');
      expect(auditSpy).toHaveBeenCalledWith('llm_error', 'failing-model', expect.stringContaining('error='), expect.stringContaining('latency_ms='));
      auditSpy.mockRestore();
    });
  });

  describe('Runtime audit events - inbox_meta_failed (zero-coverage)', () => {
    it('_hasHighPriorityInbox emits inbox_meta_failed when readMeta fails', async () => {
      const runtime = trackRuntime(await createTestRuntime({
        clawId: 'test-claw',
        clawDir,
        llmConfig: createMockLLMConfig(),
      }));
      await runtime.initialize();

      // Write a malformed .md file to pending inbox so InboxWriter.readMeta returns parse_failed
      const pendingDir = path.join(clawDir, 'inbox', 'pending');
      await fs.writeFile(path.join(pendingDir, 'bad.md'), '---\nthis is not valid frontmatter');

      const auditSpy = vi.spyOn((runtime as unknown as RuntimeTestInternals).auditWriter, 'write');
      const result = await (runtime as unknown as RuntimeTestInternals)._hasHighPriorityInbox();
      expect(result).toBe(false);
      expect(auditSpy).toHaveBeenCalledWith('inbox_meta_failed', expect.stringContaining('file='), expect.stringContaining('kind='));
      auditSpy.mockRestore();
    });
  });
});
