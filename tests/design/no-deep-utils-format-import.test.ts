import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * phase 1423 F2 — foundation/utils/format.ts barrel-only invariant.
 *
 * ML#7 + ML#9：`foundation/utils/format.ts` 跨模块通道唯一 = `utils/index.ts` barrel。
 * 跨模块 caller (cli/, core/, daemon/, watchdog/, sister foundation/*) 只能 import barrel、
 * 不得深穿 format.ts。
 *
 * 历史：phase 1413+1416 form 复用 / barrel + SUMMARY_MAX_CHARS 补齐 / ~24 site import 路径替换。
 *
 * allowlist (by-design):
 *   - src/index.ts: SDK 顶层 re-export (公共 SDK 表面边界)
 *   - src/core/{spawn-system,async-task-system,shadow-system}/_helpers.ts:
 *     模块内 helper file 直 re-export owner 给同模块用、是合法 re-export pattern
 *
 * cross-ref：depcruise `no-deep-into-utils-format` 同源 enforce。
 */
describe('phase 1423 F2: utils/format barrel-only invariant', () => {
  it('cross-module deep imports `from "*/utils/format.js"` baseline ratchet = 0 (excluding allowlist)', () => {
    const srcRoot = path.resolve(__dirname, '../../src');
    let hits = '';
    try {
      hits = execSync(
        `grep -rnE "from ['\\\"][^'\\\"]*utils/format\\.js['\\\"]" ${srcRoot} --include='*.ts' | grep -v "/utils/" | grep -v "^${srcRoot}/index.ts:" | grep -vE "_helpers\\.ts:"`,
        { encoding: 'utf8' },
      );
    } catch (e: any) {
      if (e.status === 1) return;
      throw e;
    }
    if (hits.trim()) {
      const count = hits.split('\n').filter(Boolean).length;
      throw new Error(
        `phase 1423 F2 invariant violation: ${count} cross-module site(s) deep-import from utils/format.js (outside allowlist):\n${hits}\nUse \`from '.../utils/index.js'\` instead. See coding plan/phase1423/.`,
      );
    }
  });

  it('反向自检 — regex 命中 anti-pattern 样例', () => {
    const sample = `import { formatErr } from '../../foundation/utils/format.js';`;
    const re = /from ['"][^'"]*utils\/format\.js['"]/;
    expect(re.test(sample)).toBe(true);
  });

  it('反向自检 — barrel import 样例不被命中', () => {
    const goodSample = `import { formatErr } from '../../foundation/utils/index.js';`;
    const re = /from ['"][^'"]*utils\/format\.js['"]/;
    expect(re.test(goodSample)).toBe(false);
  });
});
