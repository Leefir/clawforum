/**
 * ProcessExec - External process execution (L1)
 *
 * Two entry points:
 * - exec(command, options): shell command via `sh -c`
 * - execFile(command, args, options): direct invocation, no shell
 *
 * Shared: timeout clamping, PATH augmentation, maxBuffer protection, ProcessExecError.
 */

import { execFile as childProcessExecFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execFileAsync = promisify(childProcessExecFile);

import {
  PROCESS_EXEC_TIMEOUT_MIN_MS,
  PROCESS_EXEC_TIMEOUT_MAX_MS,
  PROCESS_EXEC_DEFAULT_TIMEOUT_MS,
  PROCESS_EXEC_MAX_BUFFER,
} from './types.js';
import type { ExecOptions, ExecResult } from './types.js';
import { ProcessExecError } from './types.js';

/**
 * Internal: run a process with shared cross-cutting concerns.
 */
async function runProcess(
  file: string,
  args: string[],
  options: ExecOptions,
): Promise<ExecResult> {
  // Clamp timeout
  const requestedTimeout = options.timeout ?? PROCESS_EXEC_DEFAULT_TIMEOUT_MS;
  const timeout = Math.min(
    Math.max(requestedTimeout, PROCESS_EXEC_TIMEOUT_MIN_MS),
    PROCESS_EXEC_TIMEOUT_MAX_MS,
  );

  // PATH augmentation: ensure Node bin directory is included
  const nodeBinDir = path.dirname(process.execPath);
  const pathEnv = process.env.PATH ?? '';
  const augmentedPath = pathEnv.includes(nodeBinDir)
    ? pathEnv
    : `${nodeBinDir}:${pathEnv}`;

  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      cwd: options.cwd,
      timeout,
      encoding: 'utf-8',
      maxBuffer: PROCESS_EXEC_MAX_BUFFER,
      signal: options.signal,
      env: {
        ...process.env,
        PATH: augmentedPath,
        ...options.env,
      },
    });

    return {
      stdout: stdout || '',
      stderr: stderr || '',
      exitCode: 0,
    };
  } catch (error: any) {
    // maxBuffer exceeded
    if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      throw new ProcessExecError({
        message: `Command output exceeded ${PROCESS_EXEC_MAX_BUFFER / 1024 / 1024} MB limit`,
        stdout: error.stdout || '',
        stderr: error.stderr || '',
        exitCode: error.status ?? null,
        maxBufferExceeded: true,
      });
    }

    // General error (non-zero exit code, timeout, etc.)
    const isTimeout = error?.killed === true;

    throw new ProcessExecError({
      message: isTimeout
        ? `Command timed out after ${timeout}ms`
        : (error?.message || String(error)),
      stdout: error?.stdout || '',
      stderr: error?.stderr || '',
      exitCode: error?.status ?? null,
      killed: isTimeout,
    });
  }
}

/**
 * Execute a shell command via `sh -c`.
 */
export async function exec(command: string, options: ExecOptions): Promise<ExecResult> {
  return runProcess('sh', ['-c', command], options);
}

/**
 * Execute a command directly, without shell.
 * Args are passed verbatim — no escaping needed.
 */
export async function execFile(
  command: string,
  args: string[],
  options: ExecOptions,
): Promise<ExecResult> {
  return runProcess(command, args, options);
}
