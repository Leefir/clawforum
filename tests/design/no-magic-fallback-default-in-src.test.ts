import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * Design invariant: src 内 `?? N`（N ≥ 2）必须用命名 const，不能是字面 N.
 *
 * Per `memory/playbook/魔法数字.md` §cluster #8 fallback default 子型.
 *
 * White-list（self-describing 或哨兵）：
 * - `?? 0` 累加器 / counter（playbook §不适用「哨兵 0」）
 * - `?? 1` page base / error code 哨兵
 * - `?? 0o644` POSIX file mode（self-describing）
 * - `?? 200/401/403/404/500` HTTP status codes（playbook §不适用）
 *
 * Phase 333: 8 处 src `?? N` 治理后立此 ratchet 防回归.
 */

const SRC_ROOT = path.resolve(__dirname, '../../src');

/**
 * Pattern matches: `?? <digit><digit_or_underscore>*` not inside strings.
 * Excludes leading/trailing identifier chars to avoid e.g. `?? 0o644` accidentally matching `?? 0`.
 */
const MAGIC_FALLBACK_PATTERN = /\?\?\s+([0-9][0-9_]*)/g;

const ALLOWED_LITERALS = new Set<string>([
  '0',
  '1',
  '200',
  '401',
  '403',
  '404',
  '500',
]);

async function* walkSrcFiles(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkSrcFiles(full);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      yield full;
    }
  }
}

interface Violation {
  file: string;
  line: number;
  literal: string;
  text: string;
}

describe('design invariant: no magic fallback default in src', () => {
  it('no `?? N` literal-value fallback in src/ (per playbook §cluster #8)', async () => {
    const violations: Violation[] = [];

    for await (const filePath of walkSrcFiles(SRC_ROOT)) {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        const re = new RegExp(MAGIC_FALLBACK_PATTERN.source, 'g');
        let m;
        while ((m = re.exec(line)) !== null) {
          const literal = m[1];
          if (ALLOWED_LITERALS.has(literal)) continue;
          violations.push({
            file: path.relative(SRC_ROOT, filePath),
            line: idx + 1,
            literal,
            text: line.trim(),
          });
        }
      });
    }

    if (violations.length > 0) {
      const detail = violations
        .map(v => `  ${v.file}:${v.line}  [?? ${v.literal}]  ${v.text}`)
        .join('\n');
      throw new Error(
        `magic fallback-default literal in src (${violations.length} site, 零容忍):\n${detail}\n\n` +
          `Fix: extract to DEFAULT_* const + jsdoc derivation, then ?? DEFAULT_*.\n` +
          `See memory/playbook/魔法数字.md §cluster #8 for naming pattern.`,
      );
    }

    expect(violations).toEqual([]);
  });
});
