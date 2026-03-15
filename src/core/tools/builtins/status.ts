/**
 * status tool - Get Claw status information
 * 
 * Enhanced with (MVP aligned):
 * - Active contract progress
 * - Task queue status
 * - Inbox/outbox pending counts
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
  } catch {
    return 'Contract: Error loading';
  }
}

async function getTaskStatus(ctx: ExecContext): Promise<string> {
  const taskSystem = (ctx as { taskSystem?: TaskSystem }).taskSystem;
  if (!taskSystem) return 'Tasks: N/A';
  
  try {
    // Note: TaskSystem doesn't expose queue status directly, return placeholder
    return 'Tasks: See task system logs';
  } catch {
    return 'Tasks: Error';
  }
}

async function getInboxOutboxStatus(ctx: ExecContext): Promise<string[]> {
  const lines: string[] = [];
  
  try {
    // Check inbox pending
    const inboxEntries = await ctx.fs.list('inbox/pending', { includeDirs: false }).catch(() => []);
    lines.push(`Inbox: ${inboxEntries.length} pending`);
  } catch {
    lines.push('Inbox: N/A');
  }
  
  try {
    // Check outbox pending
    const outboxEntries = await ctx.fs.list('outbox/pending', { includeDirs: false }).catch(() => []);
    lines.push(`Outbox: ${outboxEntries.length} pending`);
  } catch {
    lines.push('Outbox: N/A');
  }
  
  return lines;
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
  } catch {
    lines.push('MEMORY.md: Error');
  }
  
  try {
    // clawspace file count
    const entries = await ctx.fs.list('clawspace', { recursive: true, includeDirs: false }).catch(() => []);
    lines.push(`Clawspace: ${entries.length} files`);
  } catch {
    lines.push('Clawspace: Error');
  }
  
  return lines;
}

export const statusTool: ITool = {
  name: 'status',
  description: 'Get comprehensive status: Claw ID, profile, step count, active contract, tasks, inbox/outbox, storage (MEMORY.md, clawspace).',
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
    
    // Add inbox/outbox status (MVP aligned)
    lines.push(...await getInboxOutboxStatus(ctx));
    
    // Add storage status (MVP aligned)
    lines.push(...await getStorageStatus(ctx));

    return {
      success: true,
      content: lines.join('\n'),
    };
  },
};
