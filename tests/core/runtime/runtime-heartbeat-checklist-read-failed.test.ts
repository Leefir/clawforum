/**
 * Heartbeat — HEARTBEAT.md read failed observability (r124 D fork phase 1018)
 *
 * Covers:
 * - ENOENT (not configured) → silent skip, returns base, 0 audit
 * - non-ENOENT (EACCES/IO) → audit CHECKLIST_READ_FAILED, still returns base graceful degrade
 * - Happy path (checklist present) → returns base + checklist, 0 audit
 *
 * phase 1414 cascade: 测试入口从 Runtime.formatInboxMessage 迁到 Heartbeat
 * 自家 inbox-formatter（per A.phase1414-formatter-registry-wiring 业主自管）。
 * 行为不变（phase 1018 r124 D fork 立场保留）、入口迁主。
 */

import { describe, it, expect, vi } from 'vitest';
import { createHeartbeatInboxFormatter } from '../../../src/core/heartbeat/index.js';
import { HEARTBEAT_AUDIT_EVENTS } from '../../../src/core/heartbeat/audit-events.js';

describe('heartbeat inbox-formatter HEARTBEAT.md read failed audit (phase 1414 cascade)', () => {
  it('reverse 1: ENOENT (HEARTBEAT.md not configured) returns base + 0 audit', async () => {
    const auditSpy = vi.fn();
    const enoent: NodeJS.ErrnoException = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    const systemFs = {
      read: vi.fn().mockRejectedValue(enoent),
    } as any;
    const formatter = createHeartbeatInboxFormatter({ systemFs, audit: { write: auditSpy , preview: (s: string) => s, message: (s: string) => s, summary: (s: string) => s} as any });

    const result = await formatter({ from: 'sys', body: 'body', timestampSec: '' });

    expect(result).toContain('Heartbeat triggered');
    expect(auditSpy).not.toHaveBeenCalled();
  });

  it('reverse 2: EACCES (permission) emits CHECKLIST_READ_FAILED audit + returns base', async () => {
    const auditSpy = vi.fn();
    const eacces: NodeJS.ErrnoException = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const systemFs = {
      read: vi.fn().mockRejectedValue(eacces),
    } as any;
    const formatter = createHeartbeatInboxFormatter({ systemFs, audit: { write: auditSpy , preview: (s: string) => s, message: (s: string) => s, summary: (s: string) => s} as any });

    const result = await formatter({ from: 'sys', body: 'body', timestampSec: '' });

    expect(result).toContain('Heartbeat triggered');
    const emits = auditSpy.mock.calls.filter((c: any[]) => c[0] === HEARTBEAT_AUDIT_EVENTS.CHECKLIST_READ_FAILED);
    expect(emits).toHaveLength(1);
    expect(emits[0].join('|')).toMatch(/code=EACCES/);
  });

  it('reverse 3: happy path checklist configured returns base + checklist + 0 audit', async () => {
    const auditSpy = vi.fn();
    const systemFs = {
      read: vi.fn().mockResolvedValue('- item A\n- item B'),
    } as any;
    const formatter = createHeartbeatInboxFormatter({ systemFs, audit: { write: auditSpy , preview: (s: string) => s, message: (s: string) => s, summary: (s: string) => s} as any });

    const result = await formatter({ from: 'sys', body: 'body', timestampSec: '' });

    expect(result).toContain('Heartbeat triggered');
    expect(result).toContain('item A');
    expect(result).toContain('item B');
    expect(auditSpy).not.toHaveBeenCalled();
  });
});
