/**
 * search tool - Search for text in files
 * 
 * Path restrictions (MVP aligned):
 * - Whitelist: AGENTS.md, MEMORY.md, clawspace/, prompts/, skills/
 * 
 * Motion-only: can search other claws' files via `claw` parameter
 */

import * as nodePath from 'path';
import * as fsNative from 'fs';
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
  description: 'Search for text in files. Allowed paths: AGENTS.md, MEMORY.md, clawspace/, prompts/, skills/. Motion can search other claws via `claw` parameter.',
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
      claw: {
        type: 'string',
        description: 'Target claw ID (Motion only) - search files in another claw',
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
    const clawParam = args.claw as string | undefined;

    // Motion-only: search files in another claw
    let baseDir: string;
    let useNativeFs = false;

    if (clawParam !== undefined) {
      // Only Motion can use this feature
      if (ctx.clawId !== 'motion') {
        return {
          success: false,
          content: 'Error: Only Motion can search files from other claws',
        };
      }
      // Validate clawParam (no path traversal)
      if (clawParam.includes('/') || clawParam.includes('..') || clawParam === '' || clawParam === '.' || clawParam.startsWith('.')) {
        return {
          success: false,
          content: `Error: Invalid claw ID: "${clawParam}"`,
        };
      }
      // Resolve path to target claw's directory
      baseDir = nodePath.resolve(ctx.clawDir, '..', 'claws', clawParam, searchPath);
      // Escape check: must be within the target claw's directory
      const clawsDir = nodePath.resolve(ctx.clawDir, '..', 'claws');
      if (!baseDir.startsWith(nodePath.join(clawsDir, clawParam))) {
        return {
          success: false,
          content: `Error: Path escapes target claw directory: "${searchPath}"`,
        };
      }
      // Skip whitelist check for cross-claw search (Motion has full access)
      useNativeFs = true;
    } else {
      // Normal search (with whitelist)
      // Path restriction check (MVP aligned)
      if (!isSearchPathAllowed(searchPath)) {
        return {
          success: false,
          content: `Error: Path "${searchPath}" is not allowed for search. Allowed: AGENTS.md, MEMORY.md, memory/, clawspace/, prompts/, skills/.`,
        };
      }
      baseDir = searchPath;
    }

    const results: string[] = [];
    let skippedCount = 0; // Design doc: track skipped files

    try {
      // Get all files in the search path
      let entries: { path: string; isDirectory: boolean; isFile: boolean }[];
      
      if (useNativeFs) {
        // Native fs recursive walk
        entries = [];
        function walkDir(dir: string, prefix: string = '') {
          const dirents = fsNative.readdirSync(dir, { withFileTypes: true });
          for (const d of dirents) {
            const relPath = prefix ? `${prefix}/${d.name}` : d.name;
            if (d.isDirectory()) {
              walkDir(nodePath.join(dir, d.name), relPath);
            } else {
              entries.push({ path: relPath, isDirectory: false, isFile: true });
            }
          }
        }
        walkDir(baseDir);
      } else {
        entries = await ctx.fs.list(baseDir, { recursive: true, includeDirs: false });
      }

      for (const entry of entries) {
        if (results.length >= maxResults) break;

        try {
          let content: string;
          if (useNativeFs) {
            content = fsNative.readFileSync(nodePath.join(baseDir, entry.path), 'utf-8');
          } else {
            content = await ctx.fs.read(entry.path);
          }
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
    } catch (error) {
      return {
        success: false,
        content: `Error searching: ${error instanceof Error ? error.message : String(error)}`,
      };
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
  },
};
