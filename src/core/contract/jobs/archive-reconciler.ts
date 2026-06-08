/**
 * @module L4.ContractSystem.Jobs.ArchiveReconciler
 * Phase 188 Step C: boot reconcile sweep for stale active-status entries in archive
 */

import * as path from 'path';
import { isFileNotFound, type FileSystem } from '../../../foundation/fs/types.js';
import type { AuditLog } from '../../../foundation/audit/index.js';
import type { ContractStatus, ProgressData } from '../types.js';
import { CONTRACT_ARCHIVE_DIR } from '../dirs.js';
import type { ClawId } from '../../../constants.js';
import {
  emitContractArchiveReconcileStale,
  emitContractArchiveReconcileFailed,
  emitContractArchiveReconcileSummary,
} from '../audit-emit.js';

const ACTIVE_STATUSES = new Set<ContractStatus>(['pending', 'running', 'paused']);

export interface ArchiveReconcilerContext {
  fs: FileSystem;
  audit: AuditLog;
}

export async function reconcileArchiveStaleEntries(
  ctx: ArchiveReconcilerContext,
  clawId: ClawId,
  clawDir: string,
): Promise<{ swept: number; failed: number; scanned: number }> {
  const archiveDir = path.join(clawDir, CONTRACT_ARCHIVE_DIR);
  let swept = 0;
  let failed = 0;
  let scanned = 0;

  let dirs;
  try {
    dirs = await ctx.fs.list(archiveDir, { includeDirs: true });
  } catch (err) {
    if (isFileNotFound(err)) return { swept: 0, failed: 0, scanned: 0 };
    emitContractArchiveReconcileFailed(ctx.audit, {
      clawId, contractId: '<archive_dir>', context: 'list_archive_dir',
      error: String(err),
    });
    return { swept: 0, failed: 1, scanned: 0 };
  }

  for (const d of dirs.filter(e => e.isDirectory)) {
    scanned++;
    const progressPath = path.join(archiveDir, d.name, 'progress.json');
    try {
      const raw = await ctx.fs.read(progressPath);
      const progress = JSON.parse(raw) as ProgressData;
      if (!ACTIVE_STATUSES.has(progress.status)) continue; // 终态跳过

      // 翻 archive_pending_recovery
      const oldStatus = progress.status;
      progress.status = 'archive_pending_recovery';
      await ctx.fs.writeAtomic(progressPath, JSON.stringify(progress, null, 2));

      emitContractArchiveReconcileStale(ctx.audit, {
        clawId, contractId: d.name, oldStatus, newStatus: 'archive_pending_recovery',
      });
      swept++;
    } catch (err) {
      if (isFileNotFound(err)) continue; // progress.json 缺失、archive partial state、跳过
      failed++;
      emitContractArchiveReconcileFailed(ctx.audit, {
        clawId, contractId: d.name, context: 'read_or_flip',
        error: String(err),
      });
    }
  }

  emitContractArchiveReconcileSummary(ctx.audit, { clawId, scanned, swept, failed });
  return { swept, failed, scanned };
}
