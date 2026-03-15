/**
 * read tool - Read file contents
 * 
 * Path restrictions (MVP aligned):
 * - Whitelist: AGENTS.md, MEMORY.md, memory/, clawspace/, prompts/, skills/, contract/
 * - Blacklist: dialog/ (system files)
 */

import * as nodePath from 'path';
import type { ITool, ToolResult, ExecContext } from '../executor.js';

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
  description: 'Read the contents of a file. Allowed paths: AGENTS.md, MEMORY.md, memory/, clawspace/, prompts/, skills/, contract/. Blocked: dialog/.',
  schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to read (allowed: AGENTS.md, MEMORY.md, memory/, clawspace/, prompts/, skills/, contract/)',
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
    const filePath = args.path as string;
    const offset = args.offset as number | undefined;
    const limit = args.limit as number | undefined;

    // Path normalization for security (defense-in-depth)
    const normalized = nodePath.normalize(filePath);
    if (normalized.startsWith('..')) {
      return {
        success: false,
        content: `Error: Path traversal not allowed: "${filePath}"`,
      };
    }

    // Path restriction check (MVP aligned)
    if (!isPathAllowed(normalized)) {
      return {
        success: false,
        content: `Error: Path "${filePath}" is not allowed for read. Allowed: AGENTS.md, MEMORY.md, memory/, clawspace/, prompts/, skills/, contract/. Blocked: dialog/.`,
      };
    }

    // Safety limits
    const MAX_LINES = 200;
    const MAX_CHARS = 8000;

    try {
      let content = await ctx.fs.read(normalized);

      // Apply line range if specified
      if (offset !== undefined || limit !== undefined) {
        const lines = content.split('\n');
        const start = (offset ?? 1) - 1; // Convert to 0-indexed
        const end = limit !== undefined ? start + limit : lines.length;
        content = lines.slice(start, end).join('\n');
      }

      // Apply safety limits with meta info
      const totalLines = content.split('\n').length;
      const totalChars = content.length;
      const lines = content.split('\n');
      
      if (lines.length > MAX_LINES) {
        content = lines.slice(0, MAX_LINES).join('\n') + 
          `\n[显示第1-${MAX_LINES}行，共${totalLines}行。用 offset=${MAX_LINES+1} 读取更多]`;
      }
      if (content.length > MAX_CHARS) {
        const shownChars = content.slice(0, MAX_CHARS).length;
        content = content.slice(0, MAX_CHARS) + 
          `\n[显示前${shownChars}字符，共${totalChars}字符]`;
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
