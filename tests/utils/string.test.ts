/**
 * Phase 88：string 工具 ANSI 支持测试
 *
 * 验证 sliceFromStart 跳过 ANSI CSI 序列后宽度计算正确，
 * 以及 wrapLine 能正确处理含 ANSI 前缀的字符串。
 */

import { describe, it, expect } from 'vitest';
import { sliceFromStart, wrapLine } from '../../src/cli/utils/string.js';

describe('sliceFromStart — ANSI CSI 支持', () => {
  it('ANSI 前缀不计入可见宽度', () => {
    // '\x1b[31m' = 红色，不占列宽
    const s = '\x1b[31mhello\x1b[0m';
    const result = sliceFromStart(s, 3);
    // 可见内容 'hel'，ANSI 前缀保留
    expect(result).toBe('\x1b[31mhel');
  });

  it('ANSI 序列在中间不计入宽度', () => {
    const s = 'hi\x1b[2m there\x1b[0m';
    const result = sliceFromStart(s, 4);
    // 'hi' = 2，\x1b[2m 跳过，' t' = 2，共 4
    expect(result).toBe('hi\x1b[2m t');
  });

  it('内容未超宽时 ANSI 序列完整保留', () => {
    const s = '\x1b[31mhi\x1b[0m';
    const result = sliceFromStart(s, 10);
    expect(result).toBe('\x1b[31mhi\x1b[0m');
  });

  it('near-black ⏺ 前缀不计入宽度（streaming dotPrefix 场景）', () => {
    // dotPrefix = '\x1b[38;5;232m⏺\x1b[0m '，可见宽度 2（⏺=1, space=1）
    const dotPrefix = '\x1b[38;5;232m⏺\x1b[0m ';
    const s = dotPrefix + 'abcdefgh';  // 2 + 8 = 10 可见
    // maxCols=5：dotPrefix(2) + 'abc'(3) = 5
    const result = sliceFromStart(s, 5);
    expect(result).toBe(dotPrefix + 'abc');
  });

  it('纯文本行为不变（回归）', () => {
    expect(sliceFromStart('hello world', 5)).toBe('hello');
    expect(sliceFromStart('abc', 10)).toBe('abc');
  });

  it('CJK 字符宽度仍正确（回归）', () => {
    // 每个 CJK 字符 2 列宽
    const result = sliceFromStart('你好世界', 5);
    expect(result).toBe('你好');  // 4 列，加第三个会超 5
  });
});

describe('wrapLine — ANSI 字符串折行', () => {
  it('ANSI 前缀行超宽时正确折行', () => {
    // '\x1b[31m' + 10个a + '\x1b[0m'，cols=5
    const s = '\x1b[31m' + 'a'.repeat(10) + '\x1b[0m';
    const lines = wrapLine(s, 5);
    expect(lines.length).toBe(2);
    // 第一行：ANSI前缀 + 5个a
    expect(lines[0]).toBe('\x1b[31maaaaa');
    // 第二行：剩余5个a + reset
    expect(lines[1]).toBe('aaaaa\x1b[0m');
  });

  it('streaming dotPrefix 行超宽时前缀保留在首段', () => {
    const dotPrefix = '\x1b[38;5;232m⏺\x1b[0m ';
    // dotPrefix 可见宽度=2，加 8 个 'x' = 10，cols=6 → 折成两段
    const s = dotPrefix + 'x'.repeat(8);
    const lines = wrapLine(s, 6);
    expect(lines.length).toBe(2);
    // 首段：dotPrefix(2) + 4个x = 6
    expect(lines[0]).toBe(dotPrefix + 'xxxx');
    // 续段：剩余 4 个x
    expect(lines[1]).toBe('xxxx');
  });

  it('未超宽时原样返回（含 ANSI）', () => {
    const s = '\x1b[2m⏺ short\x1b[0m';
    const lines = wrapLine(s, 80);
    expect(lines).toEqual([s]);
  });

  it('纯文本折行行为不变（回归）', () => {
    const lines = wrapLine('hello world', 5);
    expect(lines).toEqual(['hello', ' worl', 'd']);
  });
});
