import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Minimum acceptable TASK_STALE_TIMEOUT_MS expressed in minutes.
 * Derivation: 实测 kimi-k2.5 thinking 单调 latency 5.29min / ×4 safety = 21min /
 * 选 20 留小 fudge / 防 regression 误改回 5min；当前 src 实然 30min, 下限 20.
 */
const MIN_STALE_TIMEOUT_MINUTES = 20;

/** Sample regression value (5min) intentionally below MIN — 反向自检. */
const REGRESSION_TIMEOUT_MINUTES = 5;

// phase 1401 Bug B invariant: TASK_STALE_TIMEOUT_MS 必 ≥ 20min。
// 实测 kimi-k2.5 thinking 单调 latency 5.29min；5min 阈值会误杀长 LLM 首调。
// 30min 是当前选定值，下限 20min 留 fudge 给后续微调；防 regression 误改回 5min。
describe('phase 1401: TASK_STALE_TIMEOUT_MS 必 >= 20min', () => {
  const ROOT = path.resolve(__dirname, '../..');
  const FILE = `${ROOT}/src/cli/commands/chat-viewport.ts`;

  it('常量声明 minutes 系数 ≥ 20', () => {
    const src = readFileSync(FILE, 'utf-8');
    const m = src.match(/TASK_STALE_TIMEOUT_MS\s*=\s*(\d+)\s*\*\s*60\s*\*\s*1000/);
    expect(m, 'TASK_STALE_TIMEOUT_MS 必声明为 N * 60 * 1000 格式').not.toBeNull();
    const minutes = Number(m![1]);
    expect(minutes).toBeGreaterThanOrEqual(MIN_STALE_TIMEOUT_MINUTES);
  });

  it('反向自检 — 5 应被拦', () => {
    const sample = `const TASK_STALE_TIMEOUT_MS = ${REGRESSION_TIMEOUT_MINUTES} * 60 * 1000;`;
    const m = sample.match(/TASK_STALE_TIMEOUT_MS\s*=\s*(\d+)\s*\*\s*60\s*\*\s*1000/);
    expect(Number(m![1])).toBe(REGRESSION_TIMEOUT_MINUTES);
    expect(Number(m![1])).toBeLessThan(MIN_STALE_TIMEOUT_MINUTES);
  });
});
