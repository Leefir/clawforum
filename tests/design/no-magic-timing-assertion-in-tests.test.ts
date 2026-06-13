import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * Design invariant: tests/ ms-related timing assertion 不能用字面阈值.
 *
 * Per `memory/playbook/魔法数字.md` §T-3/T-4 + phase 333 教训.
 *
 * Matched: `expect(<...elapsed|ms|Ms|duration|backoff|spanMs|minutes|durationMs>)
 *           .toBe(Less|Greater)Than(OrEqual)?(<N>)` 中 N 是 ≥ 10 数字字面
 *
 * White-list：仅 self path（design invariant test 自身的 doc 示例除外、用 N placeholder）
 *
 * Phase 333: ms-related timing assertion 治理后立此 ratchet 防回归.
 */

const TESTS_ROOT = path.resolve(__dirname, '..');
const SELF_RELATIVE = path.join('design', 'no-magic-timing-assertion-in-tests.test.ts');

const MS_RELATED_NAMES = [
  'elapsed',
  'ms',
  'Ms',
  'duration',
  'backoff',
  'spanMs',
  'minutes',
  'durationMs',
  'backoffMs',
  'delayMs',
  'gapMs',
  'timeoutMs',
];

const TIMING_ASSERT_PATTERN = new RegExp(
  `expect\\([^)]*\\b(${MS_RELATED_NAMES.join('|')})\\b[^)]*\\)\\.toBe(Less|Greater)Than(OrEqual)?\\(\\s*([1-9][0-9]+)\\s*\\)`,
);

const ALLOWED_RELATIVE_PATHS = new Set<string>([SELF_RELATIVE]);

async function* walkTestFiles(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkTestFiles(full);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      yield full;
    }
  }
}

interface Violation {
  file: string;
  line: number;
  text: string;
}

describe('design invariant: no magic timing-assertion literal in tests', () => {
  it('ms-related timing assertion 不能用字面阈值 (per playbook §test 侧)', async () => {
    const violations: Violation[] = [];

    for await (const filePath of walkTestFiles(TESTS_ROOT)) {
      const relative = path.relative(TESTS_ROOT, filePath);
      if (ALLOWED_RELATIVE_PATHS.has(relative)) continue;

      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (TIMING_ASSERT_PATTERN.test(line)) {
          violations.push({
            file: relative,
            line: idx + 1,
            text: line.trim(),
          });
        }
      });
    }

    if (violations.length > 0) {
      const detail = violations
        .map(v => `  ${v.file}:${v.line}  ${v.text}`)
        .join('\n');
      throw new Error(
        `magic timing-assertion literal in tests (${violations.length} site, 零容忍):\n${detail}\n\n` +
          `Fix: rename literal to NAME_MS / NAME_BUDGET_MS / NAME_MARGIN_MS with derivation comment.\n` +
          `See memory/playbook/魔法数字.md §T-3/T-4.`,
      );
    }

    expect(violations).toEqual([]);
  });
});
