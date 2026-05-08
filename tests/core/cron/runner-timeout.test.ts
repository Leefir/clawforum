import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AuditLog } from '../../../src/foundation/audit/index.js';
import { CRON_AUDIT_EVENTS } from '../../../src/core/cron/audit-events.js';
import { CronRunner, type CronJob } from '../../../src/core/cron/runner.js';

// mock helper
function makeMockAudit(): { write: ReturnType<typeof vi.fn> } {
  return { write: vi.fn() };
}

describe('CronRunner timeout escalation', () => {
  let audit: { write: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(2026, 3, 21, 10, 30, 0) });
    audit = makeMockAudit();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('handler 永挂 → timeout escalate + running 清 + 下 tick 可重试', async () => {
    const handler = vi.fn(() => new Promise<void>(() => {}));
    const job: CronJob = {
      name: 'hang',
      enabled: true,
      schedule: { type: 'hourly' },
      handler,
      timeoutMs: 100,
    };
    const runner = new CronRunner([job], audit as unknown as AuditLog);
    runner.tick();
    expect(handler).toHaveBeenCalledTimes(1);
    expect((runner as unknown as { running: Set<string> }).running.has('hang')).toBe(true);

    await vi.advanceTimersByTimeAsync(150);

    expect(audit.write).toHaveBeenCalledWith(
      'cron_handler_timeout',
      'job=hang',
      expect.stringContaining('run_key='),
      'ms=100',
    );
    expect((runner as unknown as { running: Set<string> }).running.has('hang')).toBe(false);

    // 下 tick 应能再次触发（跨小时 key）
    vi.setSystemTime(new Date(2026, 3, 21, 11, 30, 0));
    runner.tick();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('handler 正常 settle 不误杀', async () => {
    const handler = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 50));
    });
    const job: CronJob = {
      name: 'fast',
      enabled: true,
      schedule: { type: 'hourly' },
      handler,
      timeoutMs: 200,
    };
    const runner = new CronRunner([job], audit as unknown as AuditLog);
    runner.tick();
    await vi.advanceTimersByTimeAsync(100);

    expect(audit.write).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('cron_handler_timeout'),
      expect.anything(),
      expect.anything(),
    );
    expect((runner as unknown as { running: Set<string> }).running.has('fast')).toBe(false);
  });

  it('handler 正常 throw 走 JOB_ERROR 路径', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = vi.fn(async () => {
      throw new Error('test');
    });
    const job: CronJob = {
      name: 'thrower',
      enabled: true,
      schedule: { type: 'hourly' },
      handler,
      timeoutMs: 200,
    };
    const runner = new CronRunner([job], audit as unknown as AuditLog);
    runner.tick();
    await vi.advanceTimersByTimeAsync(50);

    expect(audit.write).toHaveBeenCalledWith(
      CRON_AUDIT_EVENTS.JOB_ERROR,
      'job=thrower',
      expect.stringContaining('run_key='),
      'err=test',
    );
    const timeoutCalls = audit.write.mock.calls.filter(
      (c: unknown[]) => c[0] === 'cron_handler_timeout'
    );
    expect(timeoutCalls).toHaveLength(0);
    expect((runner as unknown as { running: Set<string> }).running.has('thrower')).toBe(false);
    errSpy.mockRestore();
  });

  it('undefined timeoutMs 走原路径 regression', async () => {
    const handler = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 50));
    });
    const job: CronJob = {
      name: 'legacy',
      enabled: true,
      schedule: { type: 'hourly' },
      handler,
      // timeoutMs 未传
    };
    const runner = new CronRunner([job], audit as unknown as AuditLog);
    runner.tick();

    // 若误走 race 路径，setTimeout(undefined) → 0ms 立即触发 timeout audit
    await vi.advanceTimersByTimeAsync(10);
    const timeoutCalls = audit.write.mock.calls.filter(
      (c: unknown[]) => c[0] === 'cron_handler_timeout'
    );
    expect(timeoutCalls).toHaveLength(0);

    // 等 handler 完成
    await vi.advanceTimersByTimeAsync(100);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((runner as unknown as { running: Set<string> }).running.has('legacy')).toBe(false);
  });
});
