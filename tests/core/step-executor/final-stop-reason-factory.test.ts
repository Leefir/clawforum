/**
 * FinalStopReason factory + brand pattern unit tests — phase 299 Step B
 *
 * Replaces tests/design/finalstopreason-type-sync-invariant.test.ts grep ratchet.
 * Brand pattern provides compile-time enforce; these tests verify the factory
 * behavior contract.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  FINAL_STOP_REASONS,
  asFinalStopReason,
  tryAsFinalStopReason,
  type FinalStopReason,
} from '../../../src/core/step-executor/types.js';

describe('FinalStopReason factory + brand pattern (phase 299 B 类编译期)', () => {
  it('FINAL_STOP_REASONS const 含 6 个 known stop reason', () => {
    expect(FINAL_STOP_REASONS).toEqual([
      'end_turn',
      'stop',
      'max_tokens_text',
      'no_tool',
      'content_filter',
      'unknown',
    ]);
  });

  it('asFinalStopReason 接收 RawFinalStopReason 返回 FinalStopReason', () => {
    const r = asFinalStopReason('end_turn');
    expect(r).toBe('end_turn');
    expectTypeOf(r).toEqualTypeOf<FinalStopReason>();
  });

  it('tryAsFinalStopReason 真 string 已知 → 返回 FinalStopReason', () => {
    const r = tryAsFinalStopReason('content_filter');
    expect(r).toBe('content_filter');
    expectTypeOf(r).toEqualTypeOf<FinalStopReason | undefined>();
  });

  it('tryAsFinalStopReason 未知 string → 返回 undefined', () => {
    expect(tryAsFinalStopReason('definitely_not_a_stop_reason')).toBeUndefined();
    expect(tryAsFinalStopReason('')).toBeUndefined();
    expect(tryAsFinalStopReason('END_TURN' /* 大写 */)).toBeUndefined();
  });

  // 行为契约：6 known stop reasons 全部能经 tryAsFinalStopReason validate
  it('tryAsFinalStopReason 对 6 known stop reasons 全部返回 typed value', () => {
    for (const s of FINAL_STOP_REASONS) {
      const r = tryAsFinalStopReason(s);
      expect(r).toBe(s);
    }
  });

  // 反向自检（编译期）：字面 string 不能直接 assign 到 FinalStopReason
  it('反向：字面 string 不能直接 assign 到 FinalStopReason（编译期）', () => {
    // @ts-expect-error: 'end_turn' literal 缺 brand symbol、不能 satisfy FinalStopReason
    const x: FinalStopReason = 'end_turn';
    expect(x).toBeDefined();
  });
});
