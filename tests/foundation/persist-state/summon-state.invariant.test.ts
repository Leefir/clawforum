import { describe, it, expect } from 'vitest';
import { assertSummonDecisionShape } from '../../../src/core/summon-system/invariants.js';
import type { AuditLog } from '../../../src/foundation/audit/index.js';

function makeFakeAudit(): AuditLog & { entries: string[][] } {
  const entries: string[][] = [];
  return {
    entries,
    write(event: string, ...cols: string[]) {
      entries.push([event, ...cols]);
    },
  };
}

describe('assertSummonDecisionShape', () => {
  it('accepts valid v1 decision', () => {
    const audit = makeFakeAudit();
    assertSummonDecisionShape({
      taskId: 't1',
      verify: true,
      targetClaw: 'claw-a',
      mode: 'shadow',
      dispatchedAt: '2024-01-01T00:00:00Z',
      schema_version: 1,
    }, audit);
    expect(audit.entries).toHaveLength(0);
  });

  it('accepts legacy v0 decision and emits LEGACY_V0_MIGRATED', () => {
    const audit = makeFakeAudit();
    assertSummonDecisionShape({
      taskId: 't1',
      verify: false,
      mode: 'mining',
      dispatchedAt: '2024-01-01T00:00:00Z',
    }, audit);
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0][0]).toBe('summon_state_legacy_v0_migrated');
  });

  it('emits INVARIANT_VIOLATED for non-object', () => {
    const audit = makeFakeAudit();
    assertSummonDecisionShape('not-an-object', audit);
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0][0]).toBe('summon_state_invariant_violated');
    expect(audit.entries[0][1]).toContain('not_object');
  });

  it('emits INVARIANT_VIOLATED for invalid schema_version', () => {
    const audit = makeFakeAudit();
    assertSummonDecisionShape({
      taskId: 't1',
      verify: true,
      mode: 'shadow',
      dispatchedAt: '2024-01-01T00:00:00Z',
      schema_version: 99,
    }, audit);
    expect(audit.entries.some(e => e[0] === 'summon_state_invariant_violated' && e[1].includes('schema_version_mismatch'))).toBe(true);
  });

  it('emits INVARIANT_VIOLATED for missing taskId', () => {
    const audit = makeFakeAudit();
    assertSummonDecisionShape({
      verify: true,
      mode: 'shadow',
      dispatchedAt: '2024-01-01T00:00:00Z',
      schema_version: 1,
    }, audit);
    expect(audit.entries.some(e => e[0] === 'summon_state_invariant_violated' && e[1].includes('taskId'))).toBe(true);
  });

  it('emits INVARIANT_VIOLATED for invalid mode', () => {
    const audit = makeFakeAudit();
    assertSummonDecisionShape({
      taskId: 't1',
      verify: true,
      mode: 'invalid',
      dispatchedAt: '2024-01-01T00:00:00Z',
      schema_version: 1,
    }, audit);
    expect(audit.entries.some(e => e[0] === 'summon_state_invariant_violated' && e[1].includes('mode_invalid'))).toBe(true);
  });

  it('emits INVARIANT_VIOLATED for non-ISO dispatchedAt', () => {
    const audit = makeFakeAudit();
    assertSummonDecisionShape({
      taskId: 't1',
      verify: true,
      mode: 'shadow',
      dispatchedAt: 'not-a-date',
      schema_version: 1,
    }, audit);
    expect(audit.entries.some(e => e[0] === 'summon_state_invariant_violated' && e[1].includes('dispatchedAt_not_iso'))).toBe(true);
  });

  it('works without optional audit parameter', () => {
    expect(() => assertSummonDecisionShape({
      taskId: 't1',
      verify: true,
      mode: 'shadow',
      dispatchedAt: '2024-01-01T00:00:00Z',
      schema_version: 1,
    })).not.toThrow();
  });
});
