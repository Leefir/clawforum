/**
 * phase 1487 γ5: contract-events real composer unit test.
 * phase 205: 3 旁路删 + 主路精简（state-driven CLI block + 兜底 <unknown>）
 */

import { describe, it, expect } from 'vitest';
import { composer } from '../../../src/assembly/guidance/composers/contract-events.js';
import { CLAW_VERBS, CONTRACT_COMMANDS } from '../../../src/cli/commands/registry.js';

describe('phase 205: contract-events composer', () => {
  it('A3 single path (source_claw + contract_id) → trace + show', () => {
    const result = composer({ source_claw: 'motion', contract_id: 'abc-123' });
    expect(result).not.toBeNull();
    expect(result!.text).toContain(`chestnut claw motion ${CLAW_VERBS.TRACE} --contract abc-123`);
    expect(result!.text).toContain(`${CONTRACT_COMMANDS.SHOW} -c motion --contract abc-123`);
  });

  it('A3 path without contract_id → fallback <unknown> placeholder', () => {
    const result = composer({ source_claw: 'motion' });
    expect(result).not.toBeNull();
    expect(result!.text).toContain('<unknown>');
  });

  it('A4 batch path (1 pair) → trace + show with real ids', () => {
    const result = composer({ problem_pairs: 'worker-1:1780-abcd' });
    expect(result).not.toBeNull();
    expect(result!.text).toContain(`chestnut claw worker-1 ${CLAW_VERBS.TRACE} --contract 1780-abcd`);
    expect(result!.text).toContain(`${CONTRACT_COMMANDS.SHOW} -c worker-1 --contract 1780-abcd`);
  });

  it('A4 batch path (2 pairs) → enumerate trace + show per pair', () => {
    const result = composer({ problem_pairs: 'worker-1:1780-abcd,worker-2:1780-cdef' });
    expect(result).not.toBeNull();
    expect(result!.text).toContain(`chestnut claw worker-1 ${CLAW_VERBS.TRACE} --contract 1780-abcd`);
    expect(result!.text).toContain(`${CONTRACT_COMMANDS.SHOW} -c worker-1 --contract 1780-abcd`);
    expect(result!.text).toContain(`chestnut claw worker-2 ${CLAW_VERBS.TRACE} --contract 1780-cdef`);
    expect(result!.text).toContain(`${CONTRACT_COMMANDS.SHOW} -c worker-2 --contract 1780-cdef`);
  });

  it('empty state → fallback <unknown> placeholder', () => {
    const result = composer({});
    expect(result).not.toBeNull();
    expect(result!.text).toContain('<unknown>');
  });

  it('empty problem_pairs → fallback <unknown> placeholder', () => {
    const result = composer({ problem_pairs: '' });
    expect(result).not.toBeNull();
    expect(result!.text).toContain('<unknown>');
  });

  it('malformed pair (no colon) → skipped, others kept', () => {
    const result = composer({ problem_pairs: 'malformed,worker-1:1780-abcd' });
    expect(result).not.toBeNull();
    expect(result!.text).toContain(`chestnut claw worker-1 ${CLAW_VERBS.TRACE} --contract 1780-abcd`);
    expect(result!.text).not.toContain('malformed');
  });

  it('all malformed pairs → fallback <unknown> placeholder', () => {
    const result = composer({ problem_pairs: 'malformed1,malformed2' });
    expect(result).not.toBeNull();
    expect(result!.text).toContain('<unknown>');
  });

  it('trims whitespace around pairs', () => {
    const result = composer({ problem_pairs: ' worker-1:abc , worker-2:def ' });
    expect(result).not.toBeNull();
    expect(result!.text).toContain(`chestnut claw worker-1 ${CLAW_VERBS.TRACE} --contract abc`);
    expect(result!.text).toContain(`chestnut claw worker-2 ${CLAW_VERBS.TRACE} --contract def`);
  });

  it('caps at MAX_PAIR_RENDER=10 and shows overflow hint', () => {
    const pairs = Array.from({ length: 12 }, (_, i) => `worker-${i}:c${i}`).join(',');
    const result = composer({ problem_pairs: pairs });
    expect(result).not.toBeNull();
    expect(result!.text).toContain('(12 contract events、显示前 10)');
    // 只应出现前 10 个
    expect(result!.text).toContain('worker-0');
    expect(result!.text).toContain('worker-9');
    expect(result!.text).not.toContain('worker-10');
    expect(result!.text).not.toContain('worker-11');
  });
});
