/**
 * Frontmatter 解析工具测试
 *
 * 测试内容：
 * - 正常 frontmatter 解析
 * - 引号去除（"value" 和 'value' → value）
 * - 格式错误（缺少闭合 ---）
 * - 空 frontmatter
 * - 消息体提取
 * - CRLF 支持
 */
import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../../src/foundation/frontmatter/index.js';
import { decodeInbox, encodeInbox } from '../../src/foundation/messaging/codec-inbox.js';

describe('parseFrontmatter', () => {
  it('parses normal frontmatter', () => {
    const raw = '---\ntitle: Test\nauthor: John\n---\nBody content here';
    const { meta, body } = parseFrontmatter(raw);

    expect(meta.title).toBe('Test');
    expect(meta.author).toBe('John');
    expect(body).toBe('Body content here');
  });

  it('strips double quotes from values', () => {
    const raw = '---\nkey: "quoted value"\n---\n';
    const { meta } = parseFrontmatter(raw);
    expect(meta.key).toBe('quoted value');
  });

  it('strips single quotes from values', () => {
    const raw = "---\nkey: 'single quoted'\n---\n";
    const { meta } = parseFrontmatter(raw);
    expect(meta.key).toBe('single quoted');
  });

  it('throws on malformed frontmatter (no closing ---)', () => {
    const raw = '---\nkey: value\nBody without closing delimiter';
    expect(() => parseFrontmatter(raw)).toThrow('Malformed frontmatter');
  });

  it('returns empty meta for non-frontmatter content', () => {
    const { meta, body } = parseFrontmatter('No frontmatter at all');
    expect(Object.keys(meta)).toHaveLength(0);
    expect(body).toBe('No frontmatter at all');
  });

  it('returns empty meta for empty frontmatter (with newline)', () => {
    // 空 frontmatter 需要换行后才能有结束标记
    const raw = '---\n\n---\nBody only';
    const { meta, body } = parseFrontmatter(raw);
    expect(Object.keys(meta)).toHaveLength(0);
    expect(body).toBe('Body only');
  });

  it('handles multiline body', () => {
    const raw = `---
title: Multi
---
Line 1
Line 2
Line 3`;
    const { meta, body } = parseFrontmatter(raw);
    expect(meta.title).toBe('Multi');
    expect(body).toBe('Line 1\nLine 2\nLine 3');
  });

  it('handles empty body', () => {
    const raw = '---\nkey: value\n---\n';
    const { meta, body } = parseFrontmatter(raw);
    expect(meta.key).toBe('value');
    expect(body).toBe('');
  });

  it('preserves nested colons in values', () => {
    const raw = '---\ntime: 12:30:45\nurl: https://example.com:8080\n---\n';
    const { meta } = parseFrontmatter(raw);
    expect(meta.time).toBe('12:30:45');
    expect(meta.url).toBe('https://example.com:8080');
  });

  it('handles mixed quotes in different fields', () => {
    const raw = `---
field1: "double quoted"
field2: 'single quoted'
field3: unquoted
---
Body`;
    const { meta } = parseFrontmatter(raw);
    expect(meta.field1).toBe('double quoted');
    expect(meta.field2).toBe('single quoted');
    expect(meta.field3).toBe('unquoted');
  });

  it('trims whitespace from keys and values', () => {
    const raw = '---\n  key  :  value  \n---\n';
    const { meta } = parseFrontmatter(raw);
    expect(meta.key).toBe('value');
  });

  it('handles frontmatter with only whitespace between delimiters', () => {
    const raw = '---\n   \n---\nContent';
    const { meta, body } = parseFrontmatter(raw);
    expect(Object.keys(meta)).toHaveLength(0);
    expect(body).toBe('Content');
  });

  it('normalizes CRLF to LF', () => {
    const raw = '---\r\ntitle: Test\r\n---\r\nBody content';
    const { meta, body } = parseFrontmatter(raw);
    expect(meta.title).toBe('Test');
    expect(body).toBe('Body content');
  });
});


describe('decodeInbox extraMeta（A.1/A.2/A.3）', () => {
  // A.1: 未识别 key → extraMeta
  it('A.1 未识别 meta key 装入 extraMeta', () => {
    const raw = '---\nid: test-id\ntype: message\nfrom: claw-a\nto: motion\npriority: normal\ntimestamp: 2026-01-01T00:00:00.000Z\ncustom_field: hello\n---\nbody';
    const msg = decodeInbox(raw);
    expect(msg.extraMeta?.custom_field).toBe('hello');
    expect((msg as any).custom_field).toBeUndefined();
  });

  // A.2: 非白名单 priority → fallback + extraMeta.__original_priority
  it('A.2 非白名单 priority fallback normal + 原值进 extraMeta', () => {
    const raw = '---\nid: test-id\ntype: message\nfrom: claw-a\nto: motion\npriority: urgent\ntimestamp: 2026-01-01T00:00:00.000Z\n---\nbody';
    const msg = decodeInbox(raw);
    expect(msg.priority).toBe('normal');
    expect(msg.extraMeta?.__original_priority).toBe('urgent');
  });

  // A.3: 非白名单 type → fallback + extraMeta.__original_type
  it('A.3 非白名单 type fallback message + 原值进 extraMeta', () => {
    const raw = '---\nid: test-id\ntype: watchdog_claw_inactivity\nfrom: watchdog\nto: motion\npriority: high\ntimestamp: 2026-01-01T00:00:00.000Z\n---\nbody';
    const msg = decodeInbox(raw);
    expect(msg.type).toBe('message');
    expect(msg.extraMeta?.__original_type).toBe('watchdog_claw_inactivity');
  });

  // round-trip: 普通 extraMeta 字段写出再解码
  it('encodeInbox 写出非 __ 前缀 extraMeta 字段', () => {
    const msg = {
      id: 'test-id', type: 'message' as const, from: 'claw-a', to: 'motion',
      content: 'hello', priority: 'normal' as const, timestamp: '2026-01-01T00:00:00.000Z',
      extraMeta: { custom_field: 'world' },
    };
    const encoded = encodeInbox(msg);
    const decoded = decodeInbox(encoded);
    expect(decoded.extraMeta?.custom_field).toBe('world');
  });
});
