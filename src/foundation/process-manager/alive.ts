import { isAlive as l1IsAlive } from '../process-exec/index.js';
import { getPidFile } from './paths.js';
import type { ProcessManagerContext } from './types.js';

export function getAliveStatus(
  ctx: ProcessManagerContext,
  clawId: string,
): { alive: boolean; reason: string; pid?: number } {
  try {
    const pidFile = getPidFile(ctx, clawId);
    const content = ctx.fs.readSync(pidFile);
    const trimmed = content.trim();
    if (trimmed === '') {
      return { alive: false, reason: 'empty PID file' };
    }
    const pid = parseInt(trimmed, 10);
    if (isNaN(pid)) {
      return { alive: false, reason: `invalid PID: "${trimmed}"` };
    }

    try {
      if (l1IsAlive(pid)) {
        return { alive: true, reason: `PID ${pid}`, pid };
      }
      try { ctx.fs.deleteSync(pidFile); } catch { /* ignore */ }
      return { alive: false, reason: `PID ${pid} not alive` };
    } catch (err: any) {
      return { alive: false, reason: `isAlive error: ${err.message ?? String(err)}` };
    }
  } catch (err: any) {
    if (err.code === 'ENOENT' || err.code === 'FS_NOT_FOUND') {
      return { alive: false, reason: 'no PID file' };
    }
    return { alive: false, reason: `read error: ${err.code || err.message}` };
  }
}

export function isAliveByPidFile(ctx: ProcessManagerContext, clawId: string): boolean {
  return getAliveStatus(ctx, clawId).alive;
}
