/**
 * status tool - Get Claw status information
 * 
 * Enhanced with (MVP aligned):
 * - Active contract progress
 * - Task queue status
 * - MEMORY.md size, clawspace file count
 */

import type { ITool, ToolResult, ExecContext } from '../executor.js';
import type { ContractManager } from '../../contract/manager.js';
import type { TaskSystem } from '../../task/system.js';

async function getContractStatus(ctx: ExecContext): Promise<string> {
  const contractManager = (ctx as { contractManager?: ContractManager }).contractManager;
  if (!contractManager) return 'Contract: N/A';
  
  try {
    const contract = await contractManager.loadActive();
    if (!contract) return 'Contract: No active contract';
    
    const total = contract.subtasks.length;
    const done = contract.subtasks.filter(s => s.status === 'completed').length;
    return `Contract: ${contract.title} (${done}/${total} subtasks done)`;
  } catch (err) {
    console.warn('[status] contract error:', err);
    return 'Contract: Error loading';
  }
}

async function getTaskStatus(ctx: ExecContext): Promise<string> {
  const taskSystem = (ctx as { taskSystem?: TaskSystem }).taskSystem;
  if (!taskSystem) return 'Tasks: N/A';
  
  try {
    // Check if task system is functional by accessing its state
    // Design doc: was returning fake 'See task system logs', now shows actual status
    const pendingDir = 'tasks/pending';
    const runningDir = 'tasks/running';
    
    let pendingCount = 0;
    let runningCount = 0;
    
    try {
      const pending = await ctx.fs.list(pendingDir, { includeDirs: false });
      pendingCount = pending.length;
    } catch (err) {
      // Pending dir might not exist
      console.warn('[status] task pending error:', err);
    }
    
    try {
      const running = await ctx.fs.list(runningDir, { includeDirs: false });
      runningCount = running.length;
    } catch (err) {
      // Running dir might not exist
      console.warn('[status] task running error:', err);
    }
    
    if (runningCount > 0) {
      return `Tasks: ${runningCount} running, ${pendingCount} pending`;
    } else if (pendingCount > 0) {
      return `Tasks: ${pendingCount} pending`;
    } else {
      return 'Tasks: idle';
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Tasks: 不可用 (${msg})`;
  }
}

async function getStorageStatus(ctx: ExecContext): Promise<string[]> {
  const lines: string[] = [];
  
  try {
    // MEMORY.md size
    if (await ctx.fs.exists('MEMORY.md')) {
      const content = await ctx.fs.read('MEMORY.md');
      lines.push(`MEMORY.md: ${(content.length / 1024).toFixed(1)}KB`);
    } else {
      lines.push('MEMORY.md: Not found');
    }
  } catch (err: any) {
    lines.push(`MEMORY.md: Error (${err?.message || 'unknown'})`);
  }
  
  try {
    // clawspace file count (ENOENT = 目录不存在，正常返回空)
    const entries = await ctx.fs.list('clawspace', { recursive: true, includeDirs: false }).catch((err: any) => {
      if (err?.code === 'ENOENT') return [];
      throw err;
    });
    lines.push(`Clawspace: ${entries.length} files`);
  } catch (err: any) {
    lines.push(`Clawspace: Error (${err?.message || 'unknown'})`);
  }
  
  return lines;
}

export const statusTool: ITool = {
  name: 'status',
  description: 'Get comprehensive status: Claw ID, profile, step count, active contract, tasks, storage (MEMORY.md, clawspace).',
  schema: {
    type: 'object',
    properties: {},
    required: [],
  },
  requiredPermissions: ['read'],
  readonly: true,

  async execute(_args: Record<string, unknown>, ctx: ExecContext): Promise<ToolResult> {
    const lines = [
      `Claw ID: ${ctx.clawId}`,
      `Profile: ${ctx.profile}`,
      `Step: ${ctx.stepNumber}/${ctx.maxSteps}`,
      `Elapsed: ${ctx.getElapsedMs()}ms`,
    ];
    
    // Add contract status (MVP aligned)
    lines.push(await getContractStatus(ctx));
    
    // Add task status (MVP aligned)
    lines.push(await getTaskStatus(ctx));
    
    // Add storage status (MVP aligned)
    lines.push(...await getStorageStatus(ctx));

    return {
      success: true,
      content: lines.join('\n'),
    };
  },
};
