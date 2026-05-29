import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * phase 1416 F1 — PM factories barrel-only invariant.
 *
 * ML#7 + ML#9：`createProcessManagerForCLI` 跨模块暴露通道唯一 =
 * `src/foundation/process-manager/index.ts` barrel。跨模块 caller（cli/, watchdog/）
 * 只能 import barrel、不得深穿 `process-manager/factories.ts`。
 *
 * 历史：12 site 越 barrel 深穿（10 cli/commands + 2 watchdog）。phase 1416 F1
 * 加 import 路径替换 12 → 0 + depcruise `no-deep-into-pm-factories` rule +
 * 本 invariant test 防 future drift。
 *
 * cross-ref：depcruise `no-deep-into-pm-factories` forbidden rule 同源 enforce。
 * 形态 mirror phase 1413 `no-deep-assembly-internal-import.test.ts`。
 */
describe('phase 1416 F1: PM factories barrel-only invariant', () => {
  it('cross-module deep imports `from "*/process-manager/factories.js"` baseline ratchet = 0', () => {
    const srcRoot = path.resolve(__dirname, '../../src');
    let hits = '';
    try {
      hits = execSync(
        `grep -rnE "from ['\\\"][^'\\\"]*process-manager/factories\\.js['\\\"]" ${srcRoot} --include='*.ts' | grep -v "/process-manager/"`,
        { encoding: 'utf8' },
      );
    } catch (e: any) {
      if (e.status === 1) return; // 0 match expected
      throw e;
    }
    if (hits.trim()) {
      const count = hits.split('\n').filter(Boolean).length;
      throw new Error(
        `phase 1416 F1 invariant violation: ${count} cross-module site(s) deep-import from process-manager/factories.js:\n${hits}\nUse \`from '.../process-manager/index.js'\` instead. See coding plan/phase1416/.`,
      );
    }
  });

  it('反向自检 — regex 命中 anti-pattern 样例', () => {
    const sample = `import { createProcessManagerForCLI } from '../../foundation/process-manager/factories.js';`;
    const re = /from ['"][^'"]*process-manager\/factories\.js['"]/;
    expect(re.test(sample)).toBe(true);
  });

  it('反向自检 — barrel import 样例不被命中', () => {
    const goodSample = `import { createProcessManagerForCLI } from '../../foundation/process-manager/index.js';`;
    const re = /from ['"][^'"]*process-manager\/factories\.js['"]/;
    expect(re.test(goodSample)).toBe(false);
  });
});
