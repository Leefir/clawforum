/**
 * ls tool - List directory contents
 */

import type { ITool, ToolResult, ExecContext } from '../executor.js';
import { LS_MAX_ENTRIES } from '../../../constants.js';

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
    // From constants.ts: pagination limit

    try {
      const entries = await ctx.fs.list(path, { includeDirs: true });

      if (entries.length === 0) {
        return {
          success: true,
          content: '目录为空',
        };
      }

      const total = entries.length;
      const limited = entries.slice(0, LS_MAX_ENTRIES);
      
      const lines = limited.map(e => {
        const type = e.isDirectory ? '[DIR]' : '[FILE]';
        const size = e.isFile ? ` ${e.size} bytes` : '';
        return `${type} ${e.path}${size}`;
      });

      const suffix = total > LS_MAX_ENTRIES ? `\n...共 ${total} 项` : '';

      return {
        success: true,
        content: lines.join('\n') + suffix,
      };
    } catch (error) {
      return {
        success: false,
        content: `Error listing directory: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
