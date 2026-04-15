/**
 * Outbox Scanner - scan all Claw outbox/pending,
 * return structured list for caller decisions, no direct inbox writes.
 */

import * as path from 'path';
import type { IFileSystem } from '../fs/types.js';

export interface ClawOutboxInfo {
  clawId: string;
  count: number;
}

/**
 * Scan all claw outbox/pending, return structured list if any pending, null otherwise.
 * Caller decides when to write inbox notifications.
 */
export async function scanClawOutboxes(fs: IFileSystem, baseDir: string): Promise<ClawOutboxInfo[] | null> {
  try {
    const clawsDir = path.join(baseDir, 'claws');
    if (!fs.existsSync(clawsDir)) {
      return null;
    }

    const entries = await fs.list(clawsDir, { includeDirs: true });
    const clawIds = entries.filter(e => e.isDirectory).map(e => e.name);

    const counts: Record<string, number> = {};
    for (const id of clawIds) {
      const outboxPending = path.join(clawsDir, id, 'outbox', 'pending');
      try {
        const files = (await fs.list(outboxPending, { includeDirs: false })).filter(f => f.name.endsWith('.md'));
        if (files.length > 0) {
          counts[id] = files.length;
        }
      } catch (err: any) {
        const code = err?.code;
        if (code !== 'FS_NOT_FOUND' && code !== 'ENOENT') throw err;
        // 目录未创建，静默跳过
      }
    }

    if (Object.keys(counts).length === 0) return null;

    return Object.entries(counts).map(([id, n]) => ({ clawId: id, count: n }));
  } catch (error) {
    console.warn('[OutboxScanner] scan failed:', error instanceof Error ? error.message : String(error));
    return null;
  }
}
