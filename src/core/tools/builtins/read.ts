/**
 * read tool - Read file contents
 * 
 * Path restrictions (MVP aligned):
 * - Whitelist: AGENTS.md, MEMORY.md, memory/, clawspace/, prompts/, skills/, contract/
 * - Blacklist: dialog/ (system files)
 * 
 * Motion-only: can read other claws' files via `claw` parameter
 */

import * as nodePath from 'path';
import * as fsNative from 'fs';
import type { ITool, ToolResult, ExecContext } from '../executor.js';
import { READ_MAX_LINES, READ_MAX_CHARS } from '../../../constants.js';

// Allowed paths/prefixes for read tool (MVP aligned)
const READ_ALLOWLIST = [
  'AGENTS.md',
  'MEMORY.md',
  'memory/',
  'clawspace/',
  'prompts/',
  'skills/',
  'contract/',
];

// Blocked paths (MVP aligned)
const READ_BLOCKLIST = [
  'dialog/',
];

function isPathAllowed(filePath: string): boolean {
  // Check blocklist first
  if (READ_BLOCKLIST.some(blocked => filePath.startsWith(blocked) || filePath.includes(`/${blocked}`))) {
    return false;
  }
  // Check allowlist (exact match or starts with prefix)
  return READ_ALLOWLIST.some(allowed => {
    if (filePath === allowed) return true;
    // For directory prefixes, check if path starts with prefix
    if (allowed.endsWith('/')) {
      return filePath.startsWith(allowed);
    }
    return false;
  });
}

export const readTool: ITool = {
  name: 'read',
  description: 'Read the contents of a file. Allowed paths: AGENTS.md, MEMORY.md, memory/, clawspace/, prompts/, skills/, contract/. Blocked: dialog/. Motion can read other claws via `claw` parameter.',
  schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to read, relative to YOUR OWN claw directory (allowed: AGENTS.md, MEMORY.md, memory/, clawspace/, prompts/, skills/, contract/). To read another claw\'s files, use the "claw" parameter.',
      },
      offset: {
        type: 'number',
        description: 'Starting line number (1-indexed). Negative values count from end: -10 = last 10 lines',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of lines to read (optional)',
      },
      claw: {
        type: 'string',
        description: 'Target claw ID (Motion only). e.g. { "path": "contract/xxx/progress.json", "claw": "claw1" }',
      },
      async: {
        type: 'boolean',
        description: 'If true, run in background. Result delivered to inbox when complete. Use for large files or non-blocking reads.',
      },
    },
    required: ['path'],
  },
  requiredPermissions: ['read'],
  readonly: true,
  idempotent: true,
  supportsAsync: true,

  async execute(args: Record<string, unknown>, ctx: ExecContext): Promise<ToolResult> {
    const filePath = args.path as string;
    const offset = args.offset as number | undefined;
    const limit = args.limit as number | undefined;
    const clawParam = args.claw as string | undefined;

    // Path normalization for security (defense-in-depth)
    const normalized = nodePath.normalize(filePath);
    if (normalized.startsWith('..')) {
      return {
        success: false,
        content: `Error: Path traversal not allowed: "${filePath}"`,
      };
    }

    // Motion-only: read from another claw's directory
    let content: string;
    if (clawParam !== undefined) {
      // Only Motion can use this feature
      if (ctx.clawId !== 'motion') {
        return {
          success: false,
          content: 'Error: Only Motion can read files from other claws',
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
      const targetPath = nodePath.resolve(ctx.clawDir, '..', 'claws', clawParam, normalized);
      // Escape check: must be within the target claw's directory
      const clawsDir = nodePath.resolve(ctx.clawDir, '..', 'claws');
      if (!targetPath.startsWith(nodePath.join(clawsDir, clawParam))) {
        return {
          success: false,
          content: `Error: Path escapes target claw directory: "${filePath}"`,
        };
      }
      // Read directly using native fs (skip ctx.fs permissions)
      try {
        content = await fsNative.promises.readFile(targetPath, 'utf-8');
      } catch (error) {
        return {
          success: false,
          content: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    } else {
      // Normal read (with whitelist/blacklist)
      // Path restriction check (MVP aligned)
      if (!isPathAllowed(normalized)) {
        return {
          success: false,
          content: `Error: Path "${filePath}" is not allowed for read. Allowed: AGENTS.md, MEMORY.md, memory/, clawspace/, prompts/, skills/, contract/. Blocked: dialog/.`,
        };
      }
      // Safety limits (from constants.ts)
      try {
        content = await ctx.fs.read(normalized);
      } catch (error) {
        return {
          success: false,
          content: `Error reading file: ${error instanceof Error ? error.message : String(error)}\nTip: To read another claw's file, use the "claw" parameter: { "path": "contract/xxx.json", "claw": "<claw-id>" }`,
        };
      }
    }

    // Post-processing (offset/limit/truncation) - shared for both paths
    try {
      // Apply line range if specified
      if (offset !== undefined || limit !== undefined) {
        const lines = content.split('\n');
        let start = (offset ?? 1) - 1;
        if (start < 0) start = Math.max(0, lines.length + start + 1);
        const end = limit !== undefined ? start + limit : lines.length;
        content = lines.slice(start, end).join('\n');
      }

      // Apply safety limits with meta info
      const totalLines = content.split('\n').length;
      const totalChars = content.length;
      const lines = content.split('\n');
      
      if (lines.length > READ_MAX_LINES) {
        content = lines.slice(0, READ_MAX_LINES).join('\n') +
          `\n[Showing lines 1-${READ_MAX_LINES} of ${totalLines}. Use offset=${READ_MAX_LINES+1} to read more]`;
      }
      if (content.length > READ_MAX_CHARS) {
        const shownChars = content.slice(0, READ_MAX_CHARS).length;
        content = content.slice(0, READ_MAX_CHARS) +
          `\n[Showing first ${shownChars} of ${totalChars} chars. Use offset/limit to read more]`;
      }

      return {
        success: true,
        content,
      };
    } catch (error) {
      return {
        success: false,
        content: `Error reading file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
