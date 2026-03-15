/**
 * exec tool - Execute shell commands in sandbox
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import type { ITool, ToolResult, ExecContext } from '../executor.js';

const execFileAsync = promisify(execFile);

export const execTool: ITool = {
  name: 'exec',
  description: 'Execute a shell command in the clawspace directory. Use with caution.',
  schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Command to execute (arguments are space-separated)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default 30000)',
      },
    },
    required: ['command'],
  },
  requiredPermissions: ['execute'],
  readonly: false,

  async execute(args: Record<string, unknown>, ctx: ExecContext): Promise<ToolResult> {
    const command = args.command as string;
    const timeout = (args.timeout as number) ?? 30000;

    // Parse command and arguments
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0];
    const cmdArgs = parts.slice(1);

    // Sandbox directory: clawDir/clawspace/
    const workDir = path.join(ctx.clawDir, 'clawspace');

    try {
      const { stdout, stderr } = await execFileAsync(cmd, cmdArgs, {
        cwd: workDir,
        timeout,
        encoding: 'utf-8',
        maxBuffer: 8 * 1024, // 8KB limit
      });

      const output = stdout || stderr || '(no output)';
      const truncated = output.length > 8192 ? output.slice(0, 8192) + '\n[truncated]' : output;

      return {
        success: true,
        content: truncated,
      };
    } catch (error) {
      return {
        success: false,
        content: `Error: ${(error as Error).message}`,
      };
    }
  },
};
