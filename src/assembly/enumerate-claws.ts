/**
 * @module L6.Assembly.EnumerateClaws
 * Phase 234: claws/ enumeration helper、ML#3 真治 (与 CLAWS_DIR 同 owner)
 *
 * findings-2026-06-05-night.md §13.2 + phase 42 §7.B B.4 升档触发条件
 * 「第 5 caller」已超阈值 (实然 5 caller)。
 *
 * Owner: L6 Assembly (与 CLAWS_DIR 同 module、ML#3 strict)
 * Filter: 默 `.filter(e => e.isDirectory)` (DP「不得丢弃静默」+ safer corrupt FS case、
 *         git-gc-weekly + disk-monitor 现 no filter 行为微 safer)
 */

import type { FileSystem } from '../foundation/fs/types.js';

export function enumerateClaws(fs: FileSystem, clawsDir: string): string[] {
  return fs
    .listSync(clawsDir, { includeDirs: true })
    .filter(e => e.isDirectory)
    .map(e => e.name);
}
