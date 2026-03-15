/**
 * write tool - Write or append to file
 * 
 * Features (MVP aligned):
 * - Automatic version backup to .versions/ (keep last 10)
 * - Size limits: MEMORY.md 50/200KB, memory/ 100/500KB, clawspace/ 5MB/20MB
 * - Soft limit warns, hard limit rejects
 */

import * as path from 'path';
import type { ITool, ToolResult, ExecContext } from '../executor.js';

// Size limits by location (MVP aligned): [soft_limit, hard_limit] in bytes
const SIZE_LIMITS: Record<string, [number, number]> = {
  'MEMORY.md': [50 * 1024, 200 * 1024],
  'memory/': [100 * 1024, 500 * 1024],
  'clawspace/': [5 * 1024 * 1024, 20 * 1024 * 1024],
  'default': [1 * 1024 * 1024, 5 * 1024 * 1024], // 1MB/5MB default
};

function getSizeLimits(filePath: string): [number, number] {
  for (const [prefix, limits] of Object.entries(SIZE_LIMITS)) {
    if (prefix === 'default') continue;
    if (filePath === prefix || filePath.startsWith(prefix)) {
      return limits;
    }
  }
  return SIZE_LIMITS['default'];
}

async function backupVersion(fs: ExecContext['fs'], filePath: string): Promise<void> {
  try {
    // Check if file exists
    const exists = await fs.exists(filePath);
    if (!exists) return;

    // Read existing content
    const content = await fs.read(filePath);
    
    // Create .versions directory
    const dir = path.dirname(filePath);
    const versionsDir = dir === '.' ? '.versions' : path.join(dir, '.versions');
    await fs.ensureDir(versionsDir);
    
    // Generate version filename: {original}.{timestamp}.bak
    const basename = path.basename(filePath);
    const timestamp = Date.now();
    const versionPath = path.join(versionsDir, `${basename}.${timestamp}.bak`);
    
    await fs.writeAtomic(versionPath, content);
    
    // Cleanup old versions (keep last 10)
    try {
      const entries = await fs.list(versionsDir, { includeDirs: false });
      const versionFiles = entries
        .filter(e => e.name.startsWith(`${basename}.`) && e.name.endsWith('.bak'))
        .sort((a, b) => {
          // Extract timestamps and sort numerically (not lexically)
          const getTs = (name: string) => {
            const match = name.match(/\.(\d+)\.bak$/);
            return match ? parseInt(match[1], 10) : 0;
          };
          return getTs(b.name) - getTs(a.name); // Newest first
        });
      
      for (let i = 10; i < versionFiles.length; i++) {
        await fs.delete(versionFiles[i].path);
      }
    } catch {
      // Ignore cleanup errors
    }
  } catch {
    // Ignore backup errors (write should still proceed)
  }
}

export const writeTool: ITool = {
  name: 'write',
  description: 'Write content to a file. Use append=true to append instead of overwrite. Auto-backups to .versions/ (keep 10). Size limits: MEMORY.md 50/200KB, memory/ 100/500KB, clawspace/ 5MB/20MB.',
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
    const filePath = args.path as string;
    const content = args.content as string;
    const append = args.append === true;

    // Size limits (MVP aligned)
    const [softLimit, hardLimit] = getSizeLimits(filePath);
    
    if (content.length > hardLimit) {
      return {
        success: false,
        content: `Error: Content exceeds hard limit (${hardLimit / 1024}KB) for ${filePath}`,
      };
    }

    const warnings: string[] = [];
    if (content.length > softLimit) {
      warnings.push(`Warning: Content exceeds soft limit (${softLimit / 1024}KB)`);
    }

    try {
      // Create backup before overwrite (MVP aligned)
      if (!append) {
        await backupVersion(ctx.fs, filePath);
      }

      if (append) {
        await ctx.fs.append(filePath, content);
      } else {
        await ctx.fs.writeAtomic(filePath, content);
      }

      const warningMsg = warnings.length > 0 ? `\n${warnings.join('\n')}` : '';
      return {
        success: true,
        content: `成功写入 ${filePath}（${content.length} 字符）${warningMsg}`,
      };
    } catch (error) {
      return {
        success: false,
        content: `Error writing file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
