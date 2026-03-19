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

  async execute(args: Record<string, unknown>, ctx: ExecContext): Promise<ToolResult> {
    const contractManager = (ctx as { contractManager?: ContractManager }).contractManager;
    
    if (!contractManager) {
      return {
        success: false,
        content: '无活跃契约',
        error: 'ContractManager not configured',
      };
    }

    const active = await contractManager.loadActive();
    if (!active) {
      return {
        success: false,
        content: '当前没有活跃的契约',
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
          content: `子任务 ${subtaskId} 验收通过。所有子任务已完成！`,
          metadata: { contractId: active.id, subtaskId },
        };
      }
      // 重新加载契约获取最新状态（包含刚完成的子任务）
      const updated = await contractManager.loadActive();
      if (!updated) {
        return {
          success: true,
          content: `子任务 ${subtaskId} 验收通过。`,
          metadata: { contractId: active.id, subtaskId },
        };
      }
      // 统计剩余未完成
      const remaining = updated.subtasks.filter(s => s.status !== 'completed');
      if (remaining.length === 0) {
        return {
          success: true,
          content: `子任务 ${subtaskId} 验收通过。所有子任务已完成！`,
          metadata: { contractId: active.id, subtaskId },
        };
      }
      const remainingList = remaining.map(s => `- ${s.id}: ${s.description}`).join('\n');
      return {
        success: true,
        content: `子任务 ${subtaskId} 验收通过。剩余 ${remaining.length} 个子任务：\n${remainingList}\n\n注意：只有所有子任务全部验收通过，系统才会向 Motion 发送契约完成通知。`,
        metadata: { contractId: active.id, subtaskId },
      };
    } else {
      return {
        success: false,
        content: `子任务 ${subtaskId} 验收未通过：\n${result.feedback}`,
        error: result.feedback,
        metadata: { contractId: active.id, subtaskId },
      };
    }
  },
};
