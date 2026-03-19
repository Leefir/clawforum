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
const SUBAGENT_TOOLS = ['read', 'write', 'ls', 'search', 'status', 'exec'];

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
      skills: {
        type: 'array',
        items: { type: 'string' },
        description: 'Skills the subagent can use (default: empty)',
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
        description: 'Maximum ReAct steps (default: 20)',
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

    const taskSystem = (ctx as { taskSystem?: TaskSystem }).taskSystem;
    
    if (!taskSystem) {
      return {
        success: false,
        content: 'TaskSystem not available. Spawn tool requires TaskSystem to be injected.',
        error: 'TaskSystem not configured',
      };
    }

    const prompt = String(args.prompt);
    const skills = (args.skills as string[]) ?? [];
    const tools = (args.tools as string[]) ?? SUBAGENT_TOOLS;
    const timeout = typeof args.timeout === 'number' ? args.timeout : SPAWN_DEFAULT_TIMEOUT_S;
    const maxSteps = typeof args.maxSteps === 'number' 
      ? args.maxSteps 
      : (ctx.subagentMaxSteps ?? 20);

    try {
      const taskId = await taskSystem.scheduleSubAgent({
        prompt,
        skills,
        tools,
        timeout,
        maxSteps,
        parentClawId: ctx.clawId,
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
