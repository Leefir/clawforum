/**
 * phase 1414: MessageFormatterRegistry behavior invariants。
 *
 * Covers:
 * - register / resolve 基本路径
 * - 未注册 type resolve() = undefined（caller 负责 fallback）
 * - last-win 语义（重复注册以最后一次为准）
 * - 业主自家 Messaging formatters（registerMessagingFormatters helper）
 */

import { describe, it, expect } from 'vitest';
import {
  createMessageFormatterRegistry,
  registerMessagingFormatters,
} from '../../../src/foundation/messaging/index.js';
import type { MessageFormatter } from '../../../src/foundation/messaging/index.js';

describe('phase 1414 MessageFormatterRegistry', () => {
  it('register + resolve happy path', async () => {
    const registry = createMessageFormatterRegistry();
    const f: MessageFormatter = async ({ body }) => `[OK] ${body}`;
    registry.register('my_type', f);
    const got = registry.resolve('my_type');
    expect(got).toBe(f);
    const out = await got!({ from: 'x', body: 'hi', timestampSec: '' });
    expect(out).toBe('[OK] hi');
  });

  it('unknown type resolve returns undefined', () => {
    const registry = createMessageFormatterRegistry();
    expect(registry.resolve('never_registered')).toBeUndefined();
  });

  it('repeated register last-win semantics (装配期 idempotent)', async () => {
    const registry = createMessageFormatterRegistry();
    const f1: MessageFormatter = async () => 'first';
    const f2: MessageFormatter = async () => 'second';
    registry.register('shared', f1);
    registry.register('shared', f2);
    const got = registry.resolve('shared');
    const out = await got!({ from: 'x', body: '', timestampSec: '' });
    expect(out).toBe('second');
  });

  it('registerMessagingFormatters 立 Messaging 自家两个通用 formatter', async () => {
    const registry = createMessageFormatterRegistry();
    registerMessagingFormatters(registry);

    const userInbox = await registry.resolve('user_inbox_message')!({
      from: 'a',
      body: 'hello',
      timestampSec: ' (1m ago)',
    });
    expect(userInbox).toBe('[user inbox message (1m ago)]\nhello');

    const generic = await registry.resolve('message')!({
      from: 'sys',
      body: 'world',
      timestampSec: '',
    });
    expect(generic).toBe('[system message] world');
  });
});
