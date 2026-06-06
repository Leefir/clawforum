/**
 * @phase 146 invariant test
 * Forward-defending: prevent re-introduction of Runtime mirror state getters.
 * caller-snapshot 应直接 read 真 owner (Prompt + ToolRegistry + DialogStore)、不经 Runtime mirror。
 */

import { describe, test, expect } from 'vitest';
import { execSync } from 'node:child_process';

describe('no-runtime-current-state-getter invariant', () => {
  test('no src file references Runtime mirror state getters', () => {
    let out = '';
    try {
      out = execSync(
        'grep -rnE "getCurrentSystemPrompt|getCurrentTools|getCurrentMessages" src/ || true',
        { encoding: 'utf-8' }
      );
    } catch (err) {
      // grep -rn 无 match 时 exit 1、|| true 兜
    }

    const lines = out
      .split('\n')
      .filter(line => line.trim() !== '')
      .filter(line => !line.includes('//')); // comment 排除

    expect(lines, `Found illegal Runtime mirror state getter references:\n${lines.join('\n')}`).toEqual([]);
  });
});
