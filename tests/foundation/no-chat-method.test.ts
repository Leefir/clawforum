/**
 * @phase 151 invariant test
 * Forward-defending: prevent re-introduction of Runtime.chat() method.
 * chat() 已 phase 151 删（src 0 caller、tests refactor 用 processWithMessage）.
 */

import { describe, test, expect } from 'vitest';
import { execSync } from 'node:child_process';

describe('no-chat-method invariant', () => {
  test('no src file defines or calls runtime.chat() method', () => {
    let out = '';
    try {
      out = execSync(
        'grep -rnE "(\\.chat\\s*\\(|async\\s+chat\\s*\\()" src/ || true',
        { encoding: 'utf-8' }
      );
    } catch (err) {
      // grep -rn 0 hit → exit 1、|| true 兜
    }

    const lines = out
      .split('\n')
      .filter(line => line.trim() !== '')
      .filter(line => !line.includes('//')) // comment 排除
      .filter(line => !line.includes('LLM')) // LLM provider chat API 字面排除
      .filter(line => !line.includes('claude'))
      .filter(line => !line.includes('anthropic'))
      .filter(line => !line.includes('messages')); // messages.chat 等

    expect(lines, `Found illegal chat() references:\n${lines.join('\n')}`).toEqual([]);
  });
});
