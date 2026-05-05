import { kill, isAlive as l1IsAlive } from '../process-exec/index.js';
import { SIGTERM_GRACE_MS } from './constants.js';
import { PROCESS_MANAGER_AUDIT_EVENTS } from './audit-events.js';
import { isAliveByPidFile as checkAlive } from './alive.js';
import { readPid, removePid } from './pid.js';
import type { ProcessManagerContext } from './types.js';

export async function stopProcess(ctx: ProcessManagerContext, clawId: string): Promise<boolean> {
  const isAliveByPidFile = ctx.isAlive ?? ((id: string) => checkAlive(ctx, id));
  const pid = await readPid(ctx, clawId);
  if (!pid) {
    return false;
  }

  if (!isAliveByPidFile(clawId)) {
    await removePid(ctx, clawId);
    ctx.audit.write(
      PROCESS_MANAGER_AUDIT_EVENTS.PROCESS_STOP_STALE,
      `claw=${clawId}`,
      `pid=${pid}`,
    );
    return true;
  }

  if (!l1IsAlive(pid)) {
    await removePid(ctx, clawId);
    ctx.audit.write(
      PROCESS_MANAGER_AUDIT_EVENTS.PROCESS_STOP_STALE,
      `claw=${clawId}`,
      `pid=${pid}`,
      `via=esrch`,
    );
    return true;
  }

  let via = 'sigterm';
  try {
    kill(pid, 'TERM');
    await new Promise(resolve => setTimeout(resolve, SIGTERM_GRACE_MS));

    if (isAliveByPidFile(clawId)) {
      kill(pid, 'KILL');
      via = 'sigkill';
      ctx.audit.write(
        PROCESS_MANAGER_AUDIT_EVENTS.PROCESS_KILL_ESCALATED,
        `claw=${clawId}`,
        `pid=${pid}`,
      );
    }

    await removePid(ctx, clawId);
    ctx.audit.write(
      PROCESS_MANAGER_AUDIT_EVENTS.PROCESS_STOPPED,
      `claw=${clawId}`,
      `pid=${pid}`,
      `via=${via}`,
    );
    return true;
  } catch (err: any) {
    ctx.audit.write(
      PROCESS_MANAGER_AUDIT_EVENTS.PROCESS_STOP_FAILED,
      `claw=${clawId}`,
      `pid=${pid}`,
      `via=${via}`,
      `reason=${err.code || err.message}`,
    );
    return false;
  }
}
