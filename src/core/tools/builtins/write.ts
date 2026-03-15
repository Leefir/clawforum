/**
 * write tool - Write or append to file
 */

import type { ITool, ToolResult, ExecContext } from '../executor.js';

export const writeTool: ITool = {
  name: 'write',
  description: 'Write content to a file. Use append=true to append instead of overwrite.',
  schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to write',
      },
      content: {
        type: 'string',
        description: 'Content to write',
      },
      append: {
        type: 'boolean',
        description: 'If true, append to file instead of overwriting',
      },
    },
    required: ['path', 'content'],
  },
  requiredPermissions: ['write'],
  readonly: false,

  async execute(args: Record<string, unknown>, ctx: ExecContext): Promise<ToolResult> {
    const path = args.path as string;
    const content = args.content as string;
    const append = args.append === true;

    try {
      if (append) {
        await ctx.fs.append(path, content);
      } else {
        await ctx.fs.writeAtomic(path, content);
      }

      return {
        success: true,
        content: `写入成功: ${path}`,
      };
    } catch (error) {
      return {
        success: false,
        content: `Error writing file: ${(error as Error).message}`,
      };
    }
  },
};
