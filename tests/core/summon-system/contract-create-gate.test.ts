import { describe, it, expect, vi } from 'vitest';
import { createSummonContractCreateGate } from '../../../src/core/summon-system/contract-create-gate.js';
import { CliError } from '../../../src/cli/errors.js';
import type { SummonStateStore } from '../../../src/core/summon-system/index.js';

function makeStore(decision?: { verify: boolean; targetClaw?: string; mode: 'shadow' | 'mining'; dispatchedAt: string }): SummonStateStore {
  return {
    write: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockImplementation(async (taskId: string) => {
      if (!decision) return undefined;
      return { taskId, ...decision };
    }),
  };
}

function makeContract(verification?: Array<Record<string, unknown>>) {
  return {
    schema_version: 1,
    title: 'test',
    goal: 'test',
    subtasks: [{ id: 'a', description: 'do it' }],
    verification,
  };
}

describe('SummonContractCreateGate', () => {
  it('subagentTaskId undefined → no-op pass', async () => {
    const gate = createSummonContractCreateGate(makeStore());
    await expect(gate.check(undefined, makeContract([{ subtask_id: 'a', type: 'llm' }]), 'any-claw')).resolves.toBeUndefined();
  });

describe('SummonContractCreateGate phase 119: target_claw boundary', () => {
  it('verify=false + targetClaw match → pass', async () => {
    const store = makeStore({ verify: false, targetClaw: 'my-claw', mode: 'shadow', dispatchedAt: '2024-01-01T00:00:00.000Z' });
    const gate = createSummonContractCreateGate(store);
    const contract = makeContract();
    await expect(gate.check('task-1', contract, 'my-claw')).resolves.toBeUndefined();
  });

  it('verify=false + targetClaw mismatch → throw SUMMON_TARGET_CLAW_VIOLATION', async () => {
    const store = makeStore({ verify: false, targetClaw: 'statsvc-auditor', mode: 'shadow', dispatchedAt: '2024-01-01T00:00:00.000Z' });
    const gate = createSummonContractCreateGate(store);
    const contract = makeContract();
    await expect(gate.check('task-1', contract, 'gateway-auditor')).rejects.toThrow(
      /SUMMON_TARGET_CLAW_VIOLATION.*targetClaw=statsvc-auditor.*claw=gateway-auditor/s,
    );
  });

  it('verify=false + decision.targetClaw unset → pass (motion 未指定 targetClaw 由子代理自决)', async () => {
    const store = makeStore({ verify: false, mode: 'shadow', dispatchedAt: '2024-01-01T00:00:00.000Z' });
    const gate = createSummonContractCreateGate(store);
    const contract = makeContract();
    await expect(gate.check('task-1', contract, 'any-claw')).resolves.toBeUndefined();
  });

  it('verify=true + targetClaw mismatch → pass (verify=true 路径不校 target_claw)', async () => {
    const store = makeStore({ verify: true, targetClaw: 'statsvc-auditor', mode: 'shadow', dispatchedAt: '2024-01-01T00:00:00.000Z' });
    const gate = createSummonContractCreateGate(store);
    const contract = makeContract();
    await expect(gate.check('task-1', contract, 'gateway-auditor')).resolves.toBeUndefined();
  });

  it('subagentTaskId unset → pass even with target_claw mismatch', async () => {
    const store = makeStore({ verify: false, targetClaw: 'my-claw', mode: 'shadow', dispatchedAt: '2024-01-01T00:00:00.000Z' });
    const gate = createSummonContractCreateGate(store);
    const contract = makeContract();
    await expect(gate.check(undefined, contract, 'other-claw')).resolves.toBeUndefined();
  });

  it('audit event SUMMON_TARGET_CLAW_VIOLATION 触发 + 载荷正确', async () => {
    const store = makeStore({ verify: false, targetClaw: 'statsvc-auditor', mode: 'shadow', dispatchedAt: '2024-01-01T00:00:00.000Z' });
    const auditWrites: string[][] = [];
    const audit = { write: (...args: string[]) => auditWrites.push(args) , preview: (s: string) => s, message: (s: string) => s, summary: (s: string) => s};
    const gate = createSummonContractCreateGate(store, audit as any);
    const contract = makeContract();
    await expect(gate.check('task-1', contract, 'gateway-auditor')).rejects.toThrow();
    expect(auditWrites).toHaveLength(1);
    expect(auditWrites[0]).toEqual([
      'summon_target_claw_violation',
      'subagentTaskId=task-1',
      'expectedTargetClaw=statsvc-auditor',
      'requestedClawId=gateway-auditor',
    ]);
  });
});

  it('store file missing → audit warn + pass', async () => {
    const audit = { write: vi.fn() , preview: vi.fn((s: string) => s), message: vi.fn((s: string) => s), summary: vi.fn((s: string) => s)};
    const gate = createSummonContractCreateGate(makeStore(), audit as any);
    await expect(gate.check('task-1', makeContract([{ subtask_id: 'a', type: 'llm' }]), 'any-claw')).resolves.toBeUndefined();
    expect(audit.write).toHaveBeenCalledWith('summon_gate_no_decision', expect.stringContaining('task-1'), 'reason=likely_non_summon_subagent');
  });

  it('verify=true + verification non-empty → pass', async () => {
    const gate = createSummonContractCreateGate(makeStore({ verify: true, mode: 'shadow', dispatchedAt: '2024-01-01T00:00:00.000Z' }));
    await expect(gate.check('task-1', makeContract([{ subtask_id: 'a', type: 'llm' }]), 'any-claw')).resolves.toBeUndefined();
  });

  it('verify=false + verification empty → pass', async () => {
    const gate = createSummonContractCreateGate(makeStore({ verify: false, mode: 'shadow', dispatchedAt: '2024-01-01T00:00:00.000Z' }));
    await expect(gate.check('task-1', makeContract([]), 'any-claw')).resolves.toBeUndefined();
  });

  it('verify=false + verification missing → pass', async () => {
    const gate = createSummonContractCreateGate(makeStore({ verify: false, mode: 'shadow', dispatchedAt: '2024-01-01T00:00:00.000Z' }));
    await expect(gate.check('task-1', makeContract(), 'any-claw')).resolves.toBeUndefined();
  });

  it('verify=false + verification non-empty → throw CliError', async () => {
    const audit = { write: vi.fn() , preview: vi.fn((s: string) => s), message: vi.fn((s: string) => s), summary: vi.fn((s: string) => s)};
    const gate = createSummonContractCreateGate(makeStore({ verify: false, targetClaw: 'foo', mode: 'shadow', dispatchedAt: '2024-01-01T00:00:00.000Z' }), audit as any);
    await expect(gate.check('task-1', makeContract([{ subtask_id: 'a', type: 'llm' }]), 'any-claw')).rejects.toThrow(CliError);
    await expect(gate.check('task-1', makeContract([{ subtask_id: 'a', type: 'llm' }]), 'any-claw')).rejects.toThrow(/SUMMON_VERIFY_FALSE_VIOLATION/);
    expect(audit.write).toHaveBeenCalledWith('summon_verify_false_violation', expect.stringContaining('task-1'), 'targetClaw=foo', 'verificationCount=1');
  });
});
