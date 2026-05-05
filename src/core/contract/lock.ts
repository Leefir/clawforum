/**
 * @module L4.ContractSystem.Lock
 * Contract progress lock primitives — 函数化 / 0 class state
 */

import * as path from 'path';
import type { FileSystem } from '../../foundation/fs/types.js';
import type { AuditWriter } from '../../foundation/audit/index.js';
import { FileNotFoundError, ToolError } from '../../types/errors.js';
import { LOCK_MAX_RETRIES, LOCK_RETRY_DELAY_MS, LOCK_STALE_TIMEOUT_MS } from '../../constants.js';
import { CONTRACT_AUDIT_EVENTS } from './audit-events.js';

export interface LockContext {
  fs: FileSystem;
  audit: AuditWriter;
}

export async function acquireLock(ctx: LockContext, lockPath: string): Promise<void> {
  await ctx.fs.ensureDir(path.dirname(lockPath));

  let lastReason = 'unknown';

  for (let i = 0; i < LOCK_MAX_RETRIES; i++) {
    try {
      ctx.fs.writeExclusiveSync(
        lockPath,
        JSON.stringify({ pid: process.pid, time: Date.now() }),
      );
      return;
    } catch (err: any) {
      if (err?.code !== 'EEXIST') throw err;

      try {
        const raw = await ctx.fs.read(lockPath);
        const { pid, time } = JSON.parse(raw) as { pid: number; time: number };
        let isAlive = true;
        try { process.kill(pid, 0); } catch { isAlive = false; }
        if (!isAlive) {
          lastReason = `holder PID ${pid} is dead (stale lock)`;
          if (await unlinkStaleLock(ctx, lockPath, `stale_pid_${pid}`)) continue;
          lastReason = `unlink failed on stale lock (PID ${pid})`;
        } else if (Date.now() - time > LOCK_STALE_TIMEOUT_MS) {
          lastReason = `holder PID ${pid} exceeded timeout (${LOCK_STALE_TIMEOUT_MS}ms)`;
          ctx.audit.write(
            CONTRACT_AUDIT_EVENTS.LOCK_CLEARED,
            `pid=${pid}`,
            `timeout=${LOCK_STALE_TIMEOUT_MS}`,
            'reason=stale',
          );
          if (await unlinkStaleLock(ctx, lockPath, `timeout_pid_${pid}`)) continue;
          lastReason = `unlink failed on timeout lock (PID ${pid})`;
        } else {
          lastReason = `held by PID ${pid} (${Math.round((Date.now() - time) / 1000)}s)`;
        }
      } catch {
        lastReason = 'lock file corrupt or unreadable';
        if (await unlinkStaleLock(ctx, lockPath, 'corrupt_lock_file')) continue;
        lastReason = 'unlink failed on corrupt lock file';
      }

      if (i < LOCK_MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, LOCK_RETRY_DELAY_MS));
      }
    }
  }
  throw new ToolError(`Failed to acquire lock after ${LOCK_MAX_RETRIES} retries: ${lockPath} (${lastReason})`);
}

export async function unlinkStaleLock(ctx: LockContext, lockPath: string, reason: string): Promise<boolean> {
  try {
    await ctx.fs.delete(lockPath);
    return true;
  } catch (err: any) {
    if (err instanceof FileNotFoundError) return true;
    ctx.audit.write(
      'contract_lock_cleanup_failed',
      reason,
      err?.code ?? 'unknown',
      err?.message ?? String(err),
    );
    ctx.audit.write(
      CONTRACT_AUDIT_EVENTS.LOCK_UNLINK_FAILED,
      `reason=${reason}`,
      `err=${err?.message ?? String(err)}`,
    );
    return false;
  }
}

export async function releaseLock(ctx: LockContext, lockPath: string): Promise<void> {
  try {
    await ctx.fs.delete(lockPath);
  } catch (e) {
    ctx.audit.write(CONTRACT_AUDIT_EVENTS.LOCK_UNLINK_FAILED, `context=ContractSystem.releaseLock`, `lockPath=${lockPath}`, `error=${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function withProgressLock<T>(
  ctx: LockContext,
  contractDir: string,
  contractId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = `${contractDir}/${contractId}/progress.lock`;
  await acquireLock(ctx, lockPath);
  try {
    return await fn();
  } finally {
    await releaseLock(ctx, lockPath);
  }
}
