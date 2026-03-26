import stringWidth from 'string-width';

/**
 * 按视觉列宽从头截取字符串（正确处理 emoji / CJK 等宽字符）
 */
export function sliceFromStart(s: string, maxCols: number): string {
  let w = 0;
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i) ?? 0;
    const charLen = cp > 0xFFFF ? 2 : 1;
    const cw = stringWidth(s.slice(i, i + charLen));
    if (w + cw > maxCols) break;
    w += cw;
    i += charLen;
  }
  return s.slice(0, i);
}

/**
 * 将字符串处理为单行显示：
 * - 取第一行（丢弃换行后的内容）
 * - trimStart 清除前导空格
 * - 按终端宽度减去 reserve 截断，超出追加 '…'
 */
export function oneLine(s: string, reserve = 0): string {
  const max = Math.max(20, (process.stdout.columns ?? 80) - reserve);
  const first = (s ?? '').split('\n')[0].trimStart();
  const sliced = sliceFromStart(first, max);
  return sliced.length < first.length ? sliced + '…' : sliced;
}
