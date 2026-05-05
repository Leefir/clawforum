/**
 * @module L4.ContractSystem.Lifecycle
 * Contract status transitions: pause / resume / cancel / archive / completion check
 */

import * as path from 'path';
import type { FileSystem } from '../../foundation/fs/types.js';
import type { AuditWriter } from '../../foundation/audit/index.js';
import type { Contract } from '../../types/contract.js';
import type { ProgressData } from './types.js';
import { withProgressLock, type LockContext } from './lock.js';
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
  await ctx.fs.move(
    `${ctx.activeDir}/${contractId}`,
    `${ctx.pausedDir}/${contractId}`
  );
  await withProgressLock(ctx, ctx.pausedDir, contractId, async () => {
    const progress = await ctx.getProgress(contractId);
    progress.status = 'paused';
    progress.checkpoint = checkpointNote;
    await ctx.saveProgress(contractId, progress);
  });
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
  await ctx.fs.move(
    `${ctx.pausedDir}/${contractId}`,
    `${ctx.activeDir}/${contractId}`
  );
  await withProgressLock(ctx, ctx.activeDir, contractId, async () => {
    const progress = await ctx.getProgress(contractId);
    progress.status = 'running';
    progress.checkpoint = null;
    await ctx.saveProgress(contractId, progress);
  });
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
  await ctx.fs.move(`${dir}/${contractId}`, `${ctx.archiveDir}/${contractId}`);
  await withProgressLock(ctx, ctx.archiveDir, contractId, async () => {
    const progress = await ctx.getProgress(contractId);
    progress.status = 'cancelled';
    progress.checkpoint = `cancelled: ${reason}`;
    await ctx.saveProgress(contractId, progress);
  });
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
