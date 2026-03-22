/**
 * spawn tool - Create and delegate tasks to subagents
 * 
 * This tool schedules a subagent task and returns immediately.
 * Results are delivered via inbox message when the subagent completes.
 */

import type { ITool, ToolResult, ExecContext } from '../executor.js';
import type { TaskSystem } from '../../task/system.js';
import { SPAWN_DEFAULT_TIMEOUT_S } from '../../../constants.js';

// Default tools available to subagents
const SUBAGENT_TOOLS = ['read', 'write', 'ls', 'search', 'status', 'exec', 'skill', 'memory_search'];

/**
 * Spawn tool implementation
 * 
 * Requires taskSystem to be injected before use.
 */
export const spawnTool: ITool & { taskSystem?: TaskSystem } = {
  name: 'spawn',
  description: 'Create a subagent to handle a delegated task. The subagent will execute independently and return results via inbox when complete.',
  schema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The task description for the subagent',
      },

      tools: {
        type: 'array',
        items: { type: 'string' },
        description: `Tools available to the subagent (default: ${SUBAGENT_TOOLS.join(', ')})`,
      },
      timeout: {
        type: 'number',
        description: 'Timeout in seconds (default: 300)',
      },
      maxSteps: {
        type: 'number',
        description: 'Maximum number of ReAct steps the subagent can take (default: 20). Increase for complex multi-file tasks; decrease for simple lookups.',
      },
    },
    required: ['prompt'],
  },
  requiredPermissions: ['spawn'],
  readonly: false,
  idempotent: false,

  async execute(args: Record<string, unknown>, ctx: ExecContext): Promise<ToolResult> {
    // Prevent recursive spawning from subagents
    if (ctx.callerType === 'subagent') {
      return {
        success: false,
        content: 'Subagents cannot spawn other subagents (recursion not allowed).',
        error: 'Spawn recursion prevented',
      };
    }

    const taskSystem = ctx.taskSystem;
    
    if (!taskSystem) {
      return {
        success: false,
        content: 'TaskSystem not available. Spawn tool requires TaskSystem to be injected.',
        error: 'TaskSystem not configured',
      };
    }

    const prompt = String(args.prompt);

    const tools = Array.isArray(args.tools) ? (args.tools as string[]) : SUBAGENT_TOOLS;
    const timeout = typeof args.timeout === 'number' ? args.timeout : SPAWN_DEFAULT_TIMEOUT_S;
    const maxSteps = typeof args.maxSteps === 'number' 
      ? args.maxSteps 
      : (ctx.subagentMaxSteps ?? ctx.maxSteps ?? 100);

    try {
      const taskId = await taskSystem.scheduleSubAgent({
        kind: 'subagent',
        prompt,
        tools,
        timeout,
        maxSteps,
        parentClawId: ctx.clawId,
        originClawId: ctx.originClawId ?? ctx.clawId,
      });

      return {
        success: true,
        content: `Subagent created. Task ID: ${taskId}. Results will be delivered to inbox when complete.`,
        metadata: { taskId },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        content: `Failed to create subagent: ${errorMsg}`,
        error: errorMsg,
      };
    }
  },
};
