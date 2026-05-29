import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * phase 1416 F1 + phase 1423 F5 — PM factories + agent-factory barrel-only invariant.
 *
 * ML#7 + ML#9：`createProcessManagerForCLI` (CLI-scoped) + `createAgentProcessManager`
 * (daemon-scoped) 跨模块暴露通道唯一 = `src/foundation/process-manager/index.ts` barrel。
 * 跨模块 caller（cli/, daemon/, watchdog/）只能 import barrel、不得深穿
 * `factories.ts` 或 `agent-factory.ts`。
 *
 * 历史：
 *   - phase 1416 F1: 12 site `factories.ts` → 0
 *   - phase 1423 F5: 2 site `agent-factory.ts` → 0（扩 F1 同型 rule + 本 test）
 *
 * allowlist (by-design):
 *   - src/assembly/assemble.ts: 装配根 L6 bootstrap 允许 deep import L2 internal
 *
 * cross-ref：depcruise `no-deep-into-pm-factories-or-agent-factory` (扩自
 * phase 1416 `no-deep-into-pm-factories`) 同源 enforce。
 */
describe('phase 1416 F1 + phase 1423 F5: PM factories + agent-factory barrel-only invariant', () => {
  it('cross-module deep imports `from "*/process-manager/(factories|agent-factory).js"` baseline ratchet = 0 (excluding assembly bootstrap)', () => {
    const srcRoot = path.resolve(__dirname, '../../src');
    let hits = '';
    try {
      hits = execSync(
        `grep -rnE "from ['\\\"][^'\\\"]*process-manager/(factories|agent-factory)\\.js['\\\"]" ${srcRoot} --include='*.ts' | grep -v "/process-manager/" | grep -v "^${srcRoot}/assembly/assemble.ts:"`,
        { encoding: 'utf8' },
      );
    } catch (e: any) {
      if (e.status === 1) return; // 0 match expected
      throw e;
    }
    if (hits.trim()) {
      const count = hits.split('\n').filter(Boolean).length;
      throw new Error(
        `phase 1416 F1 + 1423 F5 invariant violation: ${count} cross-module site(s) deep-import from process-manager/(factories|agent-factory).js (outside allowlist):\n${hits}\nUse \`from '.../process-manager/index.js'\` instead. See coding plan/phase1416/ + coding plan/phase1423/.`,
      );
    }
  });

  it('反向自检 — regex 命中 anti-pattern 样例 (factories + agent-factory)', () => {
    const sample1 = `import { createProcessManagerForCLI } from '../../foundation/process-manager/factories.js';`;
    const sample2 = `import { createAgentProcessManager } from '../../foundation/process-manager/agent-factory.js';`;
    const re = /from ['"][^'"]*process-manager\/(factories|agent-factory)\.js['"]/;
    expect(re.test(sample1)).toBe(true);
    expect(re.test(sample2)).toBe(true);
  });

  it('反向自检 — barrel import 样例不被命中', () => {
    const goodSample = `import { createProcessManagerForCLI, createAgentProcessManager } from '../../foundation/process-manager/index.js';`;
    const re = /from ['"][^'"]*process-manager\/(factories|agent-factory)\.js['"]/;
    expect(re.test(goodSample)).toBe(false);
  });
});
