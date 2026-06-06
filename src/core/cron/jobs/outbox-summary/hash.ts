/**
 * @module L4.OutboxSummary
 * phase 1476: dedup hash 计算.
 *
 * `SHA256(sortedFileSet.join('\n')).slice(0, 12)`:
 * - 任何文件 add/remove/swap → fileSet 变 → hash 变
 * - 同 count 不同 msg → 不同 fileSet → 不同 hash（防 anti-pattern #2）
 * - 12 字符 16^12 ≈ 2.8e14 碰撞概率现实零
 */

import { createHash } from 'crypto';

export const HASH_LEN = 12;

/** Compute dedup hash from already-sorted file set ("<clawId>:<filename>" pairs). */
export function computeHash(sortedFileSet: string[]): string {
  const h = createHash('sha256');
  h.update(sortedFileSet.join('\n'));
  return h.digest('hex').slice(0, HASH_LEN);
}
