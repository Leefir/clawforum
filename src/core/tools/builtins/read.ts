/**
 * read tool - Read file contents
 */

import type { ITool, ToolResult, ExecContext } from '../executor.js';

export const readTool: ITool = {
  name: 'read',
  description: 'Read the contents of a file. Optionally specify line range with offset and limit.',
  schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to read',
      },
      offset: {
        type: 'number',
        description: 'Starting line number (1-indexed, optional)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of lines to read (optional)',
      },
    },
    required: ['path'],
  },
  requiredPermissions: ['read'],
  readonly: true,

  async execute(args: Record<string, unknown>, ctx: ExecContext): Promise<ToolResult> {
    const path = args.path as string;
    const offset = args.offset as number | undefined;
    const limit = args.limit as number | undefined;

    try {
      let content = await ctx.fs.read(path);

      // Apply line range if specified
      if (offset !== undefined || limit !== undefined) {
        const lines = content.split('\n');
        const start = (offset ?? 1) - 1; // Convert to 0-indexed
        const end = limit !== undefined ? start + limit : lines.length;
        content = lines.slice(start, end).join('\n');
      }

      return {
        success: true,
        content,
      };
    } catch (error) {
      return {
        success: false,
        content: `Error reading file: ${(error as Error).message}`,
      };
    }
  },
};
