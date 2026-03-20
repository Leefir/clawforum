/**
 * done tool - Mark subtask as complete and trigger acceptance
 * 
 * This tool is used by Claws to signal completion of a subtask,
 * which triggers the acceptance process defined in the contract.
 */

import type { ITool, ToolResult, ExecContext } from '../executor.js';
import type { ContractManager } from '../../contract/manager.js';

/**
 * Done tool implementation
 * 
 * Requires contractManager to be injected before use.
 */
export const doneTool: ITool & { contractManager?: ContractManager } = {
  name: 'done',
  description: 'Mark a subtask as complete and trigger acceptance verification. ' +
    'The acceptance criteria defined in the contract (script or llm) will be evaluated.',
  schema: {
    type: 'object',
    properties: {
      subtask: {
        type: 'string',
        description: 'The subtask ID to mark as complete',
      },
      evidence: {
        type: 'string',
        description: 'Evidence or summary of what was accomplished',
      },
      artifacts: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of output files or artifacts produced (optional)',
      },
    },
    required: ['subtask', 'evidence'],
  },
  requiredPermissions: ['write'],
  readonly: false,
  idempotent: false,

  async execute(args: Record<string, unknown>, ctx: ExecContext): Promise<ToolResult> {
    const contractManager = (ctx as { contractManager?: ContractManager }).contractManager;
    
    if (!contractManager) {
      return {
        success: false,
        content: 'No contract manager configured',
        error: 'ContractManager not configured',
      };
    }

    const active = await contractManager.loadActive();
    if (!active) {
      return {
        success: false,
        content: 'No active contract',
        error: 'No active contract',
      };
    }

    const subtaskId = String(args.subtask);
    const evidence = String(args.evidence);
    const artifacts = (args.artifacts as string[]) || [];

    const result = await contractManager.completeSubtask({
      contractId: active.id,
      subtaskId,
      evidence,
      artifacts,
    });

    if (result.passed) {
      const complete = await contractManager.isComplete(active.id);
      if (complete) {
        return {
          success: true,
          content: `Subtask ${subtaskId} accepted. All subtasks complete!`,
          metadata: { contractId: active.id, subtaskId },
        };
      }
      // Reload contract to get latest state (including just-completed subtask)
      const updated = await contractManager.loadActive();
      if (!updated) {
        return {
          success: true,
          content: `Subtask ${subtaskId} accepted.`,
          metadata: { contractId: active.id, subtaskId },
        };
      }
      const remaining = updated.subtasks.filter(s => s.status !== 'completed');
      if (remaining.length === 0) {
        return {
          success: true,
          content: `Subtask ${subtaskId} accepted. All subtasks complete!`,
          metadata: { contractId: active.id, subtaskId },
        };
      }
      const remainingList = remaining.map(s => `- ${s.id}: ${s.description}`).join('\n');
      return {
        success: true,
        content: `Subtask ${subtaskId} accepted. ${remaining.length} subtask(s) remaining:\n${remainingList}\n\nNote: contract completion is notified to Motion only when all subtasks are accepted.`,
        metadata: { contractId: active.id, subtaskId },
      };
    } else {
      return {
        success: false,
        content: `Subtask ${subtaskId} rejected:\n${result.feedback}`,
        error: result.feedback,
        metadata: { contractId: active.id, subtaskId },
      };
    }
  },
};
