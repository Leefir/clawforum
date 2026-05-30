import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * phase 1435 F8 — foundation/messaging/audit-events.ts barrel-only invariant.
 *
 * ML#7 + ML#9：messaging audit events const 跨模块通道 = barrel。
 * 跨模块 caller (cli/, daemon/) 只能 import messaging/index.ts、不得深穿 audit-events.ts。
 *
 * cross-ref：depcruise `no-deep-into-messaging-audit-events` 同源 enforce。
 * 形态 mirror phase 1423 F4 + phase 1432 F6 同 module 内 const re-export pattern。
 */
describe('phase 1435 F8: messaging/audit-events barrel-only invariant', () => {
  it('cross-module deep imports `from "*/messaging/audit-events.js"` baseline ratchet = 0', () => {
    const srcRoot = path.resolve(__dirname, '../../src');
    let hits = '';
    try {
      hits = execSync(
        `grep -rnE "from ['\\\"][^'\\\"]*messaging/audit-events\\.js['\\\"]" ${srcRoot} --include='*.ts' | grep -vE "^${srcRoot}/foundation/messaging/"`,
        { encoding: 'utf8' },
      );
    } catch (e: any) {
      if (e.status === 1) return;
      throw e;
    }
    if (hits.trim()) {
      const count = hits.split('\n').filter(Boolean).length;
      throw new Error(
        `phase 1435 F8 invariant violation: ${count} cross-module site(s) deep-import from messaging/audit-events.js:\n${hits}\nUse \`from '.../messaging/index.js'\` instead. See coding plan/phase1435/.`,
      );
    }
  });

  it('反向自检 — regex 命中 anti-pattern 样例', () => {
    const sample = `import { MESSAGING_AUDIT_EVENTS } from '../foundation/messaging/audit-events.js';`;
    const re = /from ['"][^'"]*messaging\/audit-events\.js['"]/;
    expect(re.test(sample)).toBe(true);
  });

  it('反向自检 — barrel import 样例不被命中', () => {
    const goodSample = `import { MESSAGING_AUDIT_EVENTS } from '../foundation/messaging/index.js';`;
    const re = /from ['"][^'"]*messaging\/audit-events\.js['"]/;
    expect(re.test(goodSample)).toBe(false);
  });

  it('反向自检 — path-prefix anchor 只排除 owner module 内部、不误排除 cross-module deep import (phase 1440 治 P0-2 substring false-green)', () => {
    const srcRoot = '/test/src';
    const ownerInternal = `${srcRoot}/foundation/messaging/index.ts:9:export { MESSAGING_AUDIT_EVENTS } from './audit-events.js';`;
    const crossModuleDeep = `${srcRoot}/cli/commands/claw-send.ts:42:import { MESSAGING_AUDIT_EVENTS } from '../../foundation/messaging/audit-events.js';`;
    const ownerPrefix = new RegExp(`^${srcRoot}/foundation/messaging/`);
    expect(ownerPrefix.test(ownerInternal)).toBe(true);
    expect(ownerPrefix.test(crossModuleDeep)).toBe(false);
  });
});
