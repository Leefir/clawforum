/**
 * exec tool - Execute shell commands in sandbox
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import type { ITool, ToolResult, ExecContext } from '../executor.js';
import { 
  EXEC_TIMEOUT_MIN_MS, 
  EXEC_TIMEOUT_MAX_MS,
  EXEC_MAX_STDOUT,
  EXEC_MAX_STDERR,
  EXEC_DEFAULT_TIMEOUT_MS,
} from '../../../constants.js';

const execFileAsync = promisify(execFile);

export const execTool: ITool = {
  name: 'exec',
  description: 'Execute a shell command in the claw root directory. Runs via `sh -c`, so shell features (pipes, redirects, quotes) work normally.',
  schema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Shell command string to execute, e.g. "ls -la" or "grep -r foo ./clawspace | head -20"',
      },
      timeout: {
        type: 'number',
        description: `Timeout in milliseconds (default ${EXEC_DEFAULT_TIMEOUT_MS})`,
      },
      async: {
        type: 'boolean',
        description: 'If true, run command in background. Result delivered to inbox when complete. Use for long-running commands (>30s).',
      },
    },
    required: ['command'],
  },
  requiredPermissions: ['execute'],
  readonly: false,
  idempotent: false,
  supportsAsync: true,

  async execute(args: Record<string, unknown>, ctx: ExecContext): Promise<ToolResult> {
    const command = args.command as string;
    // Clamp timeout between EXEC_TIMEOUT_MIN_MS and EXEC_TIMEOUT_MAX_MS
    const requestedTimeout = (args.timeout as number) ?? EXEC_DEFAULT_TIMEOUT_MS;
    const timeout = Math.min(
      Math.max(requestedTimeout, EXEC_TIMEOUT_MIN_MS),
      EXEC_TIMEOUT_MAX_MS
    );

    // Working directory: clawDir root (all tools use clawDir as base)
    const workDir = ctx.clawDir;

    try {
      // Use shell mode to properly handle quoted arguments (MVP aligned)
      // e.g., `echo "hello world"` works correctly instead of being split
      const { stdout, stderr } = await execFileAsync('sh', ['-c', command], {
        cwd: workDir,
        timeout,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024, // 1MB - 让 JS 层截断逻辑处理
        signal: ctx.signal, // 支持 Ctrl+C 中断
      });

      // Design doc: separate truncation for stdout/stderr
      let output = stdout || '';
      if (output.length > EXEC_MAX_STDOUT) {
        output = output.slice(0, EXEC_MAX_STDOUT) + '\n[stdout truncated]';
      }
      
      let errOutput = stderr || '';
      if (errOutput.length > EXEC_MAX_STDERR) {
        errOutput = errOutput.slice(0, EXEC_MAX_STDERR) + '\n[stderr truncated]';
      }
      
      const fullOutput = output + (errOutput ? '\n[stderr]: ' + errOutput : '') || '(no output)';

      return {
        success: true,
        content: fullOutput,
      };
    } catch (error) {
      const err = error as any;
      const msg = err.message || String(error);
      const stderr = err.stderr ? `\n[stderr]: ${(err.stderr as string).slice(0, EXEC_MAX_STDERR)}` : '';
      const stdout = err.stdout ? `\n[stdout]: ${(err.stdout as string).slice(0, EXEC_MAX_STDOUT)}` : '';
      return {
        success: false,
        content: `Error: ${msg}${stderr}${stdout}`,
      };
    }
  },
};
