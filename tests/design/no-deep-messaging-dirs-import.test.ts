import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * phase 1423 F4 — foundation/messaging/dirs.ts barrel-only invariant.
 *
 * ML#7 + ML#9：`messaging/dirs.ts` 的 5 path const 跨模块通道 = `messaging/index.ts` barrel。
 * 跨模块 caller (daemon/, core/) 只能 import barrel、不得深穿 dirs.ts。
 *
 * allowlist (by-design):
 *   - src/foundation/paths.ts: sister L2 path 聚合 owner、内部协作允许 deep import
 *
 * cross-ref：depcruise `no-deep-into-messaging-dirs` 同源 enforce。
 */
describe('phase 1423 F4: messaging/dirs barrel-only invariant', () => {
  it('cross-module deep imports `from "*/messaging/dirs.js"` baseline ratchet = 0 (excluding paths.ts allowlist)', () => {
    const srcRoot = path.resolve(__dirname, '../../src');
    let hits = '';
    try {
      hits = execSync(
        `grep -rnE "from ['\\\"][^'\\\"]*messaging/dirs\\.js['\\\"]" ${srcRoot} --include='*.ts' | grep -v "/messaging/" | grep -v "^${srcRoot}/foundation/paths.ts:"`,
        { encoding: 'utf8' },
      );
    } catch (e: any) {
      if (e.status === 1) return;
      throw e;
    }
    if (hits.trim()) {
      const count = hits.split('\n').filter(Boolean).length;
      throw new Error(
        `phase 1423 F4 invariant violation: ${count} cross-module site(s) deep-import from messaging/dirs.js (outside allowlist):\n${hits}\nUse \`from '.../messaging/index.js'\` instead. See coding plan/phase1423/.`,
      );
    }
  });

  it('反向自检 — regex 命中 anti-pattern 样例', () => {
    const sample = `import { INBOX_PENDING_DIR } from '../../foundation/messaging/dirs.js';`;
    const re = /from ['"][^'"]*messaging\/dirs\.js['"]/;
    expect(re.test(sample)).toBe(true);
  });

  it('反向自检 — barrel import 样例不被命中', () => {
    const goodSample = `import { INBOX_PENDING_DIR } from '../../foundation/messaging/index.js';`;
    const re = /from ['"][^'"]*messaging\/dirs\.js['"]/;
    expect(re.test(goodSample)).toBe(false);
  });
});
