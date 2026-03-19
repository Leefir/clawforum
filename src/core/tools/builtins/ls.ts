/**
 * ls tool - List directory contents
 * 
 * Motion-only: can list other claws' directories via `claw` parameter
 */

import * as nodePath from 'path';
import * as fsNative from 'fs';
import type { ITool, ToolResult, ExecContext } from '../executor.js';
import { LS_MAX_ENTRIES } from '../../../constants.js';

export const lsTool: ITool = {
  name: 'ls',
  description: 'List files and directories in the specified path. Motion can list other claws via `claw` parameter.',
  schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to list (defaults to current directory)',
      },
      claw: {
        type: 'string',
        description: 'Target claw ID (Motion only) - list directory in another claw',
      },
    },
    required: [],
  },
  requiredPermissions: ['read'],
  readonly: true,

  async execute(args: Record<string, unknown>, ctx: ExecContext): Promise<ToolResult> {
    const path = (args.path as string) ?? '.';
    const clawParam = args.claw as string | undefined;
    // From constants.ts: pagination limit

    // Motion-only: list directory in another claw
    let targetPath: string;
    let entries: { path: string; isDirectory: boolean; isFile: boolean; size?: number }[];

    if (clawParam !== undefined) {
      // Only Motion can use this feature
      if (ctx.clawId !== 'motion') {
        return {
          success: false,
          content: 'Error: Only Motion can list directories from other claws',
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
      targetPath = nodePath.resolve(ctx.clawDir, '..', 'claws', clawParam, path);
      // Escape check: must be within the target claw's directory
      const clawsDir = nodePath.resolve(ctx.clawDir, '..', 'claws');
      if (!targetPath.startsWith(nodePath.join(clawsDir, clawParam))) {
        return {
          success: false,
          content: `Error: Path escapes target claw directory: "${path}"`,
        };
      }
      // Read directly using native fs (skip ctx.fs permissions)
      try {
        const dirents = fsNative.readdirSync(targetPath, { withFileTypes: true });
        entries = dirents.map(d => ({
          path: d.name,
          isDirectory: d.isDirectory(),
          isFile: d.isFile(),
          size: d.isFile() ? fsNative.statSync(nodePath.join(targetPath, d.name)).size : undefined,
        }));
      } catch (error) {
        return {
          success: false,
          content: `Error listing directory: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    } else {
      // Normal list (within current claw)
      try {
        entries = await ctx.fs.list(path, { includeDirs: true });
      } catch (error) {
        return {
          success: false,
          content: `Error listing directory: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

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
  },
};
