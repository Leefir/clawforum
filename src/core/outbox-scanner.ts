/**
 * Outbox Scanner - 扫描所有 Claw 的 outbox/pending，
 * 返回摘要字符串供调用方决策，不直接写 inbox。
 */

import * as path from 'path';
import * as fsNative from 'fs';

/**
 * 扫描所有 claw outbox/pending，有未读则返回摘要字符串，否则返回 null。
 * 调用方负责决定何时写 inbox 通知。
 */
export function scanClawOutboxes(baseDir: string): string | null {
  try {
    const clawsDir = path.join(baseDir, 'claws');
    if (!fsNative.existsSync(clawsDir)) return null;

    const clawIds = fsNative.readdirSync(clawsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    const counts: Record<string, number> = {};
    for (const id of clawIds) {
      const outboxPending = path.join(clawsDir, id, 'outbox', 'pending');
      try {
        const files = fsNative.readdirSync(outboxPending).filter(f => f.endsWith('.md'));
        if (files.length > 0) {
          counts[id] = files.length;
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        // ENOENT：outbox/pending 目录未创建，正常跳过
      }
    }

    if (Object.keys(counts).length === 0) return null;

    return Object.entries(counts)
      .map(([id, n]) => `${id}(${n})`)
      .join(', ');
  } catch (error) {
    process.stderr.write(`[OutboxScanner] scan failed: ${error}\n`);
    return null;
  }
}
