/**
 * search tool - Search for text in files
 */

import type { ITool, ToolResult, ExecContext } from '../executor.js';

export const searchTool: ITool = {
  name: 'search',
  description: 'Search for text in files. Returns matching lines with file names and line numbers.',
  schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Text to search for (case-insensitive)',
      },
      path: {
        type: 'string',
        description: 'Directory to search in (defaults to memory/)',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of results to return (default 5)',
      },
    },
    required: ['query'],
  },
  requiredPermissions: ['read'],
  readonly: true,

  async execute(args: Record<string, unknown>, ctx: ExecContext): Promise<ToolResult> {
    const query = (args.query as string).toLowerCase();
    const searchPath = (args.path as string) ?? 'memory/';
    const maxResults = (args.max_results as number) ?? 5;

    const results: string[] = [];

    try {
      // Get all files in the search path
      const entries = await ctx.fs.list(searchPath, { recursive: true, includeDirs: false });

      for (const entry of entries) {
        if (results.length >= maxResults) break;

        try {
          const content = await ctx.fs.read(entry.path);
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (results.length >= maxResults) break;

            if (lines[i].toLowerCase().includes(query)) {
              results.push(`${entry.path}:${i + 1}: ${lines[i].trim()}`);
            }
          }
        } catch {
          // Skip files that can't be read
          continue;
        }
      }

      if (results.length === 0) {
        return {
          success: true,
          content: `未找到包含 "${args.query}" 的内容`,
        };
      }

      return {
        success: true,
        content: results.join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        content: `Error searching: ${(error as Error).message}`,
      };
    }
  },
};
