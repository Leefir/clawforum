/**
 * status tool - Get Claw status information
 */

import type { ITool, ToolResult, ExecContext } from '../executor.js';

export const statusTool: ITool = {
  name: 'status',
  description: 'Get current status of the Claw session including ID, profile, step count, and elapsed time.',
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

    return {
      success: true,
      content: lines.join('\n'),
    };
  },
};
