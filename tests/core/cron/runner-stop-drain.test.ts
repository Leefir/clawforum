import { describe, it, expect, vi } from 'vitest';
import type { AuditLog } from '../../../src/foundation/audit/index.js';
import { CRON_AUDIT_EVENTS } from '../../../src/core/cron/audit-events.js';
import { CronRunner, type CronJob } from '../../../src/core/cron/runner.js';

// mock helper
function makeMockAudit(): { write: ReturnType<typeof vi.fn> } {
  return { write: vi.fn() };
}

describe('CronRunner.stop drain (phase 793 / P0.22)', () => {
  it('drains inflight handlers before resolving stop', async () => {
    let handlerResolved = false;
    const slowHandler = () => new Promise<void>(resolve => setTimeout(() => {
      handlerResolved = true;
      resolve();
    }, 200));

    const audit = makeMockAudit();
    const runner = new CronRunner([{
      name: 'slow', enabled: true,
      schedule: { type: 'interval', minutes: 1 },
      handler: slowHandler,
    }], audit as unknown as AuditLog);

    runner.start();
    runner.tick();  // 触发 schedule slowHandler

    // stop 应等 handler settle
    await runner.stop(1000);   // cap 1s > handler 200ms

    expect(handlerResolved).toBe(true);
  });

  it('drains with cap timeout when handler exceeds cap', async () => {
    const hangingHandler = () => new Promise<void>(() => { /* never resolve */ });

    const audit = makeMockAudit();
    const runner = new CronRunner([{
      name: 'hang', enabled: true,
      schedule: { type: 'interval', minutes: 1 },
      handler: hangingHandler,
    }], audit as unknown as AuditLog);

    runner.start();
    runner.tick();

    await runner.stop(100);   // cap 100ms

    // 期 audit RUNNER_DRAIN_TIMEOUT 写
    const calls = (audit.write as any).mock.calls;
    const timeoutCalls = calls.filter((c: any) => c[0] === CRON_AUDIT_EVENTS.RUNNER_DRAIN_TIMEOUT);
    expect(timeoutCalls.length).toBe(1);
  });
});
