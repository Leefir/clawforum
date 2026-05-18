/**
 * @module L6.Assembly
 * 启动期临时残片清理（A.p320-2 / phase397）
 *
 * 启动期一次性清理 .tmp_* 残片 / 装配方副作用 / 不在 L1 fs OS 原语层。
 * 历史：phase397 物理迁 src/foundation/fs/atomic.ts → src/assembly/cleanup.ts。
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { IGNORE_PATTERN } from '../foundation/fs/atomic.js';

export async function cleanupOrphanedTemp(dirPath: string): Promise<string[]> {
  const cleaned: string[] = [];
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.name.startsWith(IGNORE_PATTERN)) continue;
      if (!entry.isFile()) continue;
      const fullPath = path.join(dirPath, entry.name);
      try {
        await fs.unlink(fullPath);
        cleaned.push(fullPath);
      } catch (err) {
        // ENOENT: concurrent unlink race / file already deleted / acceptable
        // non-ENOENT (EACCES/EIO/ENOSPC): throw → caller .catch + audit (assemble.ts:478-480 CLEANUP_TEMP_FILES_FAILED)
        if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      }
    }
  } catch (err) {
    // ENOENT: first-run dir does not exist / acceptable
    // non-ENOENT (EACCES/EIO/EBADF): throw → caller .catch + audit (assemble.ts:478-480)
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }
  return cleaned;
}
