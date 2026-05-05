import { PROCESS_MANAGER_AUDIT_EVENTS } from './audit-events.js';
import { getPidFile, ensureStatusDir } from './paths.js';
import type { ProcessManagerContext } from './types.js';

export async function readPid(ctx: ProcessManagerContext, clawId: string): Promise<number | null> {
  try {
    const pidFile = getPidFile(ctx, clawId);
    const content = await ctx.fs.read(pidFile);
    const pid = parseInt(content.trim(), 10);
    if (!Number.isFinite(pid)) {
      ctx.audit.write(PROCESS_MANAGER_AUDIT_EVENTS.PID_READ_FAILED, `claw=${clawId}`, `reason=invalid_pid`);
      return null;
    }
    ctx.audit.write(PROCESS_MANAGER_AUDIT_EVENTS.PID_READ_OK, `claw=${clawId}`, `pid=${pid}`);
    return pid;
  } catch (err: any) {
    if (err?.code === 'ENOENT' || err?.code === 'FS_NOT_FOUND') {
      return null;
    }
    ctx.audit.write(
      PROCESS_MANAGER_AUDIT_EVENTS.PID_READ_FAILED,
      `claw=${clawId}`,
      `reason=${err?.message || String(err)}`,
    );
    return null;
  }
}

export async function removePid(ctx: ProcessManagerContext, clawId: string): Promise<void> {
  try {
    const pidFile = getPidFile(ctx, clawId);
    await ctx.fs.delete(pidFile);
    ctx.audit.write(PROCESS_MANAGER_AUDIT_EVENTS.PID_REMOVE_OK, `claw=${clawId}`);
  } catch (err: any) {
    if (err.code === 'ENOENT' || err.code === 'FS_NOT_FOUND') {
      return;
    }
    ctx.audit.write(
      PROCESS_MANAGER_AUDIT_EVENTS.PID_REMOVE_FAILED,
      `claw=${clawId}`,
      `reason=${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function selfWritePid(ctx: ProcessManagerContext, clawId: string): Promise<void> {
  try {
    await ensureStatusDir(ctx, clawId);
    const pidFile = getPidFile(ctx, clawId);
    await ctx.fs.writeAtomic(pidFile, String(process.pid));
    ctx.audit.write(PROCESS_MANAGER_AUDIT_EVENTS.PID_WRITE_OK, `claw=${clawId}`, `pid=${process.pid}`);
  } catch (e: any) {
    ctx.audit.write(PROCESS_MANAGER_AUDIT_EVENTS.PID_WRITE_FAILED, `claw=${clawId}`, `reason=${e?.message ?? String(e)}`);
    throw e;
  }
}

export async function selfRemovePid(ctx: ProcessManagerContext, clawId: string): Promise<void> {
  const storedPid = await readPid(ctx, clawId);
  if (storedPid === process.pid) {
    await removePid(ctx, clawId);
  }
}
