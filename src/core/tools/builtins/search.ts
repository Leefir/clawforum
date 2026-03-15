/**
 * search tool - Search for text in files
 * 
 * Path restrictions (MVP aligned):
 * - Whitelist: AGENTS.md, MEMORY.md, clawspace/, prompts/, skills/
 */

import type { ITool, ToolResult, ExecContext } from '../executor.js';

// Allowed paths/prefixes for search tool (MVP aligned)
const SEARCH_ALLOWLIST = [
  'AGENTS.md',
  'MEMORY.md',
  'memory/',
  'clawspace/',
  'prompts/',
  'skills/',
];

function isSearchPathAllowed(searchPath: string): boolean {
  // Normalize path: add trailing slash for directory checks
  const normalizedPath = searchPath.endsWith('/') ? searchPath : searchPath + '/';
  return SEARCH_ALLOWLIST.some(allowed => 
    searchPath === allowed || normalizedPath.startsWith(allowed)
  );
}

export const searchTool: ITool = {
  name: 'search',
  description: 'Search for text in files. Allowed paths: AGENTS.md, MEMORY.md, clawspace/, prompts/, skills/. Returns matching lines with file names and line numbers.',
  schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Text to search for (case-insensitive)',
      },
      path: {
        type: 'string',
        description: 'Directory to search in (defaults to clawspace/, allowed: AGENTS.md, MEMORY.md, clawspace/, prompts/, skills/)',
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
    const searchPath = (args.path as string) ?? 'clawspace/';
    const maxResults = (args.max_results as number) ?? 5;

    // Path restriction check (MVP aligned)
    if (!isSearchPathAllowed(searchPath)) {
      return {
        success: false,
        content: `Error: Path "${searchPath}" is not allowed for search. Allowed: AGENTS.md, MEMORY.md, memory/, clawspace/, prompts/, skills/.`,
      };
    }

    const results: string[] = [];
    let skippedCount = 0; // Design doc: track skipped files

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
          skippedCount++;
          continue;
        }
      }

      const skippedMsg = skippedCount > 0 ? `（${skippedCount} 个文件被跳过）` : '';
      
      if (results.length === 0) {
        return {
          success: true,
          content: `未找到包含 "${args.query}" 的内容${skippedMsg}`,
        };
      }

      return {
        success: true,
        content: results.join('\n') + skippedMsg,
      };
    } catch (error) {
      return {
        success: false,
        content: `Error searching: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
