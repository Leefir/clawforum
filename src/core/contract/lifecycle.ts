/**
 * @module L4.ContractSystem.Lifecycle
 * Contract status transitions: pause / resume / cancel / archive / completion check
 */

import * as path from 'path';
import type { FileSystem } from '../../foundation/fs/types.js';
import type { AuditWriter } from '../../foundation/audit/index.js';
import type { Contract } from '../../types/contract.js';
import type { ProgressData } from './types.js';
import { acquireLock, releaseLock, withProgressLock, type LockContext } from './lock.js';
import { ToolError } from '../../types/errors.js';
import { CONTRACT_AUDIT_EVENTS } from './audit-events.js';

export interface LifecycleContext extends LockContext {
  activeDir: string;
  pausedDir: string;
  archiveDir: string;
  contractDir: (contractId: string) => Promise<string>;
  loadContract: (contractId: string) => Promise<Contract>;
  getProgress: (contractId: string) => Promise<ProgressData>;
  saveProgress: (contractId: string, progress: ProgressData) => Promise<void>;
  checkAllSubtasksCompleted: (contractId: string, progress: ProgressData) => Promise<boolean>;
}

export async function pauseContract(
  ctx: LifecycleContext,
  contractId: string,
  checkpointNote: string,
): Promise<void> {
  const dir = await ctx.contractDir(contractId);
  if (dir !== ctx.activeDir) {
    throw new ToolError(`Cannot pause contract "${contractId}": not in active/`);
  }
  await ctx.fs.ensureDir(ctx.pausedDir);

  // phase 791 (P0.16): acquire lock at SOURCE, do status update, move, release at TARGET.
  // 防 fs.move 跨边界 lock 失效 race（lock + 数据同 dir / dir move 时 lock 跟着移动）。
  const sourceLockPath = `${ctx.activeDir}/${contractId}/progress.lock`;
  await acquireLock(ctx, sourceLockPath);
  try {
    // status update in SOURCE dir before move
    const progress = await ctx.getProgress(contractId);
    progress.status = 'paused';
    progress.checkpoint = checkpointNote;
    await ctx.saveProgress(contractId, progress);

    // move whole dir (lock + progress.json) → target
    await ctx.fs.move(`${ctx.activeDir}/${contractId}`, `${ctx.pausedDir}/${contractId}`);
  } finally {
    // release at TARGET (lock file moved with dir)
    const targetLockPath = `${ctx.pausedDir}/${contractId}/progress.lock`;
    await releaseLock(ctx, targetLockPath);
  }

  ctx.audit.write(CONTRACT_AUDIT_EVENTS.PAUSED, contractId, `checkpoint=${checkpointNote}`);
}

export async function resumeContract(
  ctx: LifecycleContext,
  contractId: string,
): Promise<Contract> {
  const dir = await ctx.contractDir(contractId);
  if (dir !== ctx.pausedDir) {
    throw new ToolError(`Cannot resume contract "${contractId}": not in paused/`);
  }

  // phase 791 (P0.16): acquire lock at SOURCE, do status update, move, release at TARGET.
  const sourceLockPath = `${ctx.pausedDir}/${contractId}/progress.lock`;
  await acquireLock(ctx, sourceLockPath);
  try {
    const progress = await ctx.getProgress(contractId);
    progress.status = 'running';
    progress.checkpoint = null;
    await ctx.saveProgress(contractId, progress);

    await ctx.fs.move(`${ctx.pausedDir}/${contractId}`, `${ctx.activeDir}/${contractId}`);
  } finally {
    const targetLockPath = `${ctx.activeDir}/${contractId}/progress.lock`;
    await releaseLock(ctx, targetLockPath);
  }

  ctx.audit.write(CONTRACT_AUDIT_EVENTS.RESUMED, contractId);
  return ctx.loadContract(contractId);
}

export async function cancelContract(
  ctx: LifecycleContext,
  contractId: string,
  reason: string,
): Promise<void> {
  const dir = await ctx.contractDir(contractId);
  if (dir === ctx.archiveDir) {
    throw new ToolError(`Cannot cancel contract "${contractId}": already archived`);
  }
  await ctx.fs.ensureDir(ctx.archiveDir);

  // phase 791 (P0.16): acquire lock at SOURCE, do status update, move, release at TARGET.
  const sourceLockPath = `${dir}/${contractId}/progress.lock`;
  await acquireLock(ctx, sourceLockPath);
  try {
    const progress = await ctx.getProgress(contractId);
    progress.status = 'cancelled';
    progress.checkpoint = `cancelled: ${reason}`;
    await ctx.saveProgress(contractId, progress);

    await ctx.fs.move(`${dir}/${contractId}`, `${ctx.archiveDir}/${contractId}`);
  } finally {
    const targetLockPath = `${ctx.archiveDir}/${contractId}/progress.lock`;
    await releaseLock(ctx, targetLockPath);
  }

  ctx.audit.write(CONTRACT_AUDIT_EVENTS.CANCELLED, contractId, `reason=${reason}`);
}

export async function isContractComplete(
  ctx: LifecycleContext,
  contractId: string,
): Promise<boolean> {
  const progress = await ctx.getProgress(contractId);
  return ctx.checkAllSubtasksCompleted(contractId, progress);
}

export async function moveContractToArchive(
  ctx: LifecycleContext,
  contractId: string,
): Promise<void> {
  const dir = await ctx.contractDir(contractId);
  if (dir === ctx.archiveDir) return;
  const dst = `${ctx.archiveDir}/${contractId}`;
  await ctx.fs.ensureDir(ctx.archiveDir);
  await ctx.fs.move(`${dir}/${contractId}`, dst);
}
