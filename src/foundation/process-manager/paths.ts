import * as path from 'path';
import { STATUS_SUBDIR } from '../../types/paths.js';
import type { ProcessManagerContext } from './types.js';

export function getStatusDir(ctx: ProcessManagerContext, clawId: string): string {
  return path.join(ctx.resolveDir(clawId), STATUS_SUBDIR);
}

export function getPidFile(ctx: ProcessManagerContext, clawId: string): string {
  return path.join(getStatusDir(ctx, clawId), 'pid');
}

export function getLockFile(ctx: ProcessManagerContext, clawId: string): string {
  return path.join(getStatusDir(ctx, clawId), 'daemon.lock');
}

export async function ensureStatusDir(ctx: ProcessManagerContext, clawId: string): Promise<void> {
  await ctx.fs.ensureDir(getStatusDir(ctx, clawId));
}
