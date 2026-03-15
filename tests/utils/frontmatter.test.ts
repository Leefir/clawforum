/**
 * Frontmatter 解析工具测试
 * 
 * 测试内容：
 * - 正常 frontmatter 解析
 * - 引号去除（"value" 和 'value' → value）
 * - 格式错误（缺少闭合 ---）
 * - 空 frontmatter
 * - 消息体提取
 */
import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../../src/utils/frontmatter.js';

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
});
