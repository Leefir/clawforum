import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * phase 1416 F3 — llm-orchestrator defaults/errors barrel-only invariant.
 *
 * ML#7 + ML#9：`llm-orchestrator` 模块对外表面由 `index.ts` barrel 唯一暴露。
 * 跨模块 caller（cli/, daemon/）只能 import barrel、不得深穿
 * `llm-orchestrator/{defaults,errors}.ts`。
 *
 * 历史：3 site 越 barrel 深穿（cli/init + cli/config + daemon/daemon-loop）。
 * phase 1416 F3 加 barrel `DEFAULT_LLM_TIMEOUT_MS` + `LLMAllProvidersFailedError`
 * re-export + 3 site import 路径改 + depcruise `no-deep-into-llm-orchestrator-defaults-errors`
 * + 本 invariant test 防 future drift。
 *
 * allowlist (by-design):
 *   - src/index.ts: SDK 顶层 re-export (公共 SDK 表面边界)
 *   - src/foundation/config/schemas.ts: sister L2 (config schema 直消费 owner const)
 *
 * cross-ref：depcruise `no-deep-into-llm-orchestrator-defaults-errors` 同源 enforce。
 * 形态 mirror phase 1413 + 1416 F1。
 */
describe('phase 1416 F3: llm-orchestrator defaults/errors barrel-only invariant', () => {
  it('cross-module deep imports `from "*/llm-orchestrator/{defaults,errors}.js"` baseline ratchet = 0 (excluding SDK + sister L2)', () => {
    const srcRoot = path.resolve(__dirname, '../../src');
    let hits = '';
    try {
      hits = execSync(
        `grep -rnE "from ['\\\"][^'\\\"]*llm-orchestrator/(defaults|errors)\\.js['\\\"]" ${srcRoot} --include='*.ts' | grep -v "/llm-orchestrator/" | grep -v "^${srcRoot}/index.ts:" | grep -v "^${srcRoot}/foundation/config/schemas.ts:"`,
        { encoding: 'utf8' },
      );
    } catch (e: any) {
      if (e.status === 1) return; // 0 match expected
      throw e;
    }
    if (hits.trim()) {
      const count = hits.split('\n').filter(Boolean).length;
      throw new Error(
        `phase 1416 F3 invariant violation: ${count} cross-module site(s) deep-import from llm-orchestrator/defaults.js or errors.js (outside allowlist):\n${hits}\nUse \`from '.../llm-orchestrator/index.js'\` instead. See coding plan/phase1416/.`,
      );
    }
  });

  it('反向自检 — regex 命中 anti-pattern 样例', () => {
    const sample = `import { DEFAULT_LLM_TIMEOUT_MS } from '../../foundation/llm-orchestrator/defaults.js';`;
    const re = /from ['"][^'"]*llm-orchestrator\/(defaults|errors)\.js['"]/;
    expect(re.test(sample)).toBe(true);
  });

  it('反向自检 — barrel import 样例不被命中', () => {
    const goodSample = `import { DEFAULT_LLM_TIMEOUT_MS } from '../../foundation/llm-orchestrator/index.js';`;
    const re = /from ['"][^'"]*llm-orchestrator\/(defaults|errors)\.js['"]/;
    expect(re.test(goodSample)).toBe(false);
  });
});
