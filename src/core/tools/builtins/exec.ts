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
    // Clamp timeout between 1s and 120s (MVP: 120s hard limit)
    const requestedTimeout = (args.timeout as number) ?? 30000;
    const timeout = Math.min(Math.max(requestedTimeout, 1000), 120000);

    // Sandbox directory: clawDir (AGENTS.md 规范)
    const workDir = ctx.clawDir;

    try {
      // Use shell mode to properly handle quoted arguments (MVP aligned)
      // e.g., `echo "hello world"` works correctly instead of being split
      const { stdout, stderr } = await execFileAsync('sh', ['-c', command], {
        cwd: workDir,
        timeout,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024, // 1MB - 让 JS 层截断逻辑处理
      });

      // Design doc: separate truncation for stdout/stderr
      const MAX_STDOUT = 8000;
      const MAX_STDERR = 500;
      
      let output = stdout || '';
      if (output.length > MAX_STDOUT) {
        output = output.slice(0, MAX_STDOUT) + '\n[stdout truncated]';
      }
      
      let errOutput = stderr || '';
      if (errOutput.length > MAX_STDERR) {
        errOutput = errOutput.slice(0, MAX_STDERR) + '\n[stderr truncated]';
      }
      
      const fullOutput = output + (errOutput ? '\n[stderr]: ' + errOutput : '') || '(no output)';

      return {
        success: true,
        content: fullOutput,
      };
    } catch (error) {
      return {
        success: false,
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
