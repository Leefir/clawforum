import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * phase 1435 F9 — foundation/skill-system/skill-paths.ts barrel-only invariant.
 *
 * ML#7 + ML#9：skill-system paths const 跨模块通道 = barrel。
 * 跨模块 caller (cli/) 只能 import skill-system/index.ts、不得深穿 skill-paths.ts。
 *
 * cross-ref：depcruise `no-deep-into-skill-paths` 同源 enforce。
 * 形态 mirror phase 1423 + phase 1432 同 module 内 const re-export pattern。
 */
describe('phase 1435 F9: skill-system/skill-paths barrel-only invariant', () => {
  it('cross-module deep imports `from "*/skill-system/skill-paths.js"` baseline ratchet = 0', () => {
    const srcRoot = path.resolve(__dirname, '../../src');
    let hits = '';
    try {
      hits = execSync(
        `grep -rnE "from ['\\\"][^'\\\"]*skill-system/skill-paths\\.js['\\\"]" ${srcRoot} --include='*.ts' | grep -vE "^${srcRoot}/foundation/skill-system/"`,
        { encoding: 'utf8' },
      );
    } catch (e: any) {
      if (e.status === 1) return;
      throw e;
    }
    if (hits.trim()) {
      const count = hits.split('\n').filter(Boolean).length;
      throw new Error(
        `phase 1435 F9 invariant violation: ${count} cross-module site(s) deep-import from skill-system/skill-paths.js:\n${hits}\nUse \`from '.../skill-system/index.js'\` instead. See coding plan/phase1435/.`,
      );
    }
  });

  it('反向自检 — regex 命中 anti-pattern 样例', () => {
    const sample = `import { SKILLS_DIR_DEFAULT } from '../../foundation/skill-system/skill-paths.js';`;
    const re = /from ['"][^'"]*skill-system\/skill-paths\.js['"]/;
    expect(re.test(sample)).toBe(true);
  });

  it('反向自检 — barrel import 样例不被命中', () => {
    const goodSample = `import { SKILLS_DIR_DEFAULT } from '../../foundation/skill-system/index.js';`;
    const re = /from ['"][^'"]*skill-system\/skill-paths\.js['"]/;
    expect(re.test(goodSample)).toBe(false);
  });

  it('反向自检 — path-prefix anchor 只排除 owner module 内部、不误排除 cross-module deep import (phase 1440 治 P0-2 substring false-green)', () => {
    const srcRoot = '/test/src';
    const ownerInternal = `${srcRoot}/foundation/skill-system/index.ts:11:export { SKILLS_DIR_DEFAULT } from './skill-paths.js';`;
    const crossModuleDeep = `${srcRoot}/cli/commands/skill-list.ts:7:import { SKILLS_DIR_DEFAULT } from '../../foundation/skill-system/skill-paths.js';`;
    const ownerPrefix = new RegExp(`^${srcRoot}/foundation/skill-system/`);
    expect(ownerPrefix.test(ownerInternal)).toBe(true);
    expect(ownerPrefix.test(crossModuleDeep)).toBe(false);
  });
});
