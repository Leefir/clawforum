/**
 * FinalStopReason type sync invariant — phase 1483 audit #2
 *
 * agent-executor.ts 的 AgentResult.stopReason 必须 reference step-executor 的 FinalStopReason
 * named type、不得退化为字面联合复制（M#9 编译器可检 / 跨模块同步漂移 0 tolerance）。
 *
 * 实现：grep src/core/agent-executor/agent-executor.ts、断言文件内
 *   - 不包含完整字面联合 `'end_turn' | 'stop' | 'max_tokens_text'`（即未退化复制）
 *   - 包含 `FinalStopReason` 引用
 *
 * 反向 test 守护：临时把 stopReason: FinalStopReason 改回字面联合 → 此测 FAIL。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const AGENT_EXECUTOR_PATH = resolve(__dirname, '../../src/core/agent-executor/agent-executor.ts');

describe('FinalStopReason type sync invariant (phase 1483 #2)', () => {
  const src = readFileSync(AGENT_EXECUTOR_PATH, 'utf8');

  it('agent-executor.ts uses FinalStopReason named type, not literal union copy', () => {
    // 字面联合 head（出现即退化）
    const literalUnionPattern = /'end_turn'\s*\|\s*'stop'\s*\|\s*'max_tokens_text'/;
    expect(literalUnionPattern.test(src)).toBe(false);
  });

  it('agent-executor.ts imports FinalStopReason from step-executor', () => {
    expect(src).toMatch(/FinalStopReason/);
    expect(src).toMatch(/from\s+['"]\.\.\/step-executor\/index\.js['"]/);
  });
});
