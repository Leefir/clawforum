/**
 * ls tool - List directory contents
 */

import type { ITool, ToolResult, ExecContext } from '../executor.js';

export const lsTool: ITool = {
  name: 'ls',
  description: 'List files and directories in the specified path.',
  schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to list (defaults to current directory)',
      },
    },
    required: [],
  },
  requiredPermissions: ['read'],
  readonly: true,

  async execute(args: Record<string, unknown>, ctx: ExecContext): Promise<ToolResult> {
    const path = (args.path as string) ?? '.';

    try {
      const entries = await ctx.fs.list(path, { includeDirs: true });

      if (entries.length === 0) {
        return {
          success: true,
          content: '目录为空',
        };
      }

      const lines = entries.map(e => {
        const type = e.isDirectory ? '[DIR]' : '[FILE]';
        const size = e.isFile ? ` ${e.size} bytes` : '';
        return `${type} ${e.path}${size}`;
      });

      return {
        success: true,
        content: lines.join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        content: `Error listing directory: ${(error as Error).message}`,
      };
    }
  },
};
