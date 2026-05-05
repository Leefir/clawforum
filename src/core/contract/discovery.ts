/**
 * @module L4.ContractSystem.Discovery
 * Contract loading from active / paused dir
 */

import type { FileSystem } from '../../foundation/fs/types.js';
import type { AuditWriter } from '../../foundation/audit/index.js';
import type { Contract } from '../../types/contract.js';
import type { ProgressData } from './types.js';
import { CONTRACT_AUDIT_EVENTS } from './audit-events.js';

export interface DiscoveryContext {
  fs: FileSystem;
  audit: AuditWriter;
  loadContract: (contractId: string) => Promise<Contract>;
}

interface LatestEntry { name: string; startedAt: string; }

async function findLatestContract(
  ctx: DiscoveryContext,
  dir: string,
  auditContext: string,
): Promise<LatestEntry | null> {
  const exists = await ctx.fs.exists(dir);
  if (!exists) return null;

  const entries = await ctx.fs.list(dir, { includeDirs: true });
  let latest: LatestEntry | null = null;

  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const progressPath = `${dir}/${entry.name}/progress.json`;
    const hasProgress = await ctx.fs.exists(progressPath);
    if (!hasProgress) continue;

    try {
      const data = JSON.parse(await ctx.fs.read(progressPath)) as ProgressData;
      const startedAt = data.started_at ?? '';
      if (!latest || startedAt > latest.startedAt) {
        latest = { name: entry.name, startedAt };
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        ctx.audit.write(
          CONTRACT_AUDIT_EVENTS.PROGRESS_CORRUPTED,
          `file=${entry.name}`,
          `err=${error instanceof Error ? error.message : String(error)}`,
        );
        ctx.audit.write(
          CONTRACT_AUDIT_EVENTS.PROGRESS_CORRUPTED,
          `context=${auditContext}`,
          `contract=${entry.name}`,
          `error=${error instanceof Error ? error.message : String(error)}`,
        );
      }
      continue;
    }
  }

  return latest;
}

export async function loadActiveContract(
  ctx: DiscoveryContext,
  activeDir: string,
): Promise<Contract | null> {
  const latest = await findLatestContract(ctx, activeDir, 'ContractSystem.loadActive');
  if (!latest) return null;
  const contract = await ctx.loadContract(latest.name);
  contract.status = 'running';
  return contract;
}

export async function loadPausedContract(
  ctx: DiscoveryContext,
  pausedDir: string,
): Promise<Contract | null> {
  const latest = await findLatestContract(ctx, pausedDir, 'ContractSystem.loadPaused');
  if (!latest) return null;
  const contract = await ctx.loadContract(latest.name);
  contract.status = 'paused';
  return contract;
}
