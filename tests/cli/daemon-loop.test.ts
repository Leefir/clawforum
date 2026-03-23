/**
 * daemon-loop tests
 *
 * fix 7 — waitForInbox done() idempotency (settled guard prevents double-resolve)
 * fix 9 — interrupt poller circuit breaker (disables after 20 consecutive errors)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fsp from 'fs/promises';
import * as fsNative from 'fs';
import * as os from 'os';
import * as path from 'path';
import { waitForInbox, startDaemonLoop } from '../../src/cli/commands/daemon-loop.js';
import type { ClawRuntime } from '../../src/core/runtime.js';

// Module-level mock so ESM named exports are replaceable
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

// ─── fix 7: waitForInbox idempotency ──────────────────────────────────────────

describe('waitForInbox', () => {
  it('resolves via timeout when dir does not exist (mkdirSync throws → done() via catch, then timer fires)', async () => {
    vi.useFakeTimers();

    // '/nonexistent-fs-watch-path' will cause mkdirSync to fail in some environments,
    // but mkdirSync with { recursive: true } on a bad path may not throw on macOS.
    // So use a path that will trigger the watcher error path instead.
    const p = waitForInbox('/tmp/__daemon_test_no_inbox__', 1000);

    vi.advanceTimersByTime(1001);
    await expect(p).resolves.toBeUndefined();

    vi.useRealTimers();
  });

  it('resolves before timeout when a file is created in the watched dir', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'daemon-inbox-test-'));
    try {
      const timeoutMs = 5000;
      const p = waitForInbox(tmpDir, timeoutMs);

      // Write a file to trigger fs.watch event
      await fsp.writeFile(path.join(tmpDir, 'msg.md'), 'test');

      // Should resolve well before 5s timeout
      await expect(p).resolves.toBeUndefined();
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('calling done() multiple times via timeout does not reject or hang', async () => {
    vi.useFakeTimers();
    const p = waitForInbox('/tmp/__daemon_test_double__', 500);
    // Advance twice to ensure timer fires and any second invocation is guarded
    vi.advanceTimersByTime(600);
    vi.advanceTimersByTime(600);
    await expect(p).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});

// ─── fix 9: interrupt poller circuit breaker ──────────────────────────────────

describe('startDaemonLoop interrupt poller circuit breaker', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    // existsSync is already replaced by the module-level vi.mock above
    vi.mocked(fsNative.existsSync).mockImplementation(() => {
      throw new Error('eperm');
    });
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(fsNative.existsSync).mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('disables interrupt poller after 20 consecutive errors', async () => {
    // processBatch returns 0 → daemon goes to waitForInbox
    // The try block starts the interrupt poller, then awaits processBatch/waitForInbox
    // We want to advance timers to trigger the poller 20 times
    const processBatch = vi.fn().mockResolvedValue(0);
    const mockRuntime = {
      processBatch,
      abort: vi.fn(),
      retryLastTurn: vi.fn(),
    } as unknown as ClawRuntime;

    const { stop } = startDaemonLoop({
      runtime: mockRuntime,
      agentDir: '/tmp/test-agent-fix9',
      inboxPendingDir: '/tmp/test-inbox-fix9',
      label: '[test-fix9]',
      fallbackTimeoutMs: 60_000,
    });

    // Let processBatch resolve (tick microtasks)
    await Promise.resolve();

    // Advance 200ms × 21 to trigger the poller 20+ times
    for (let i = 0; i < 21; i++) {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    }

    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('disabling'),
    );

    stop();
    // Advance to flush waitForInbox timeout so the loop can terminate cleanly
    vi.advanceTimersByTime(60_001);
    await Promise.resolve();
  });
});
