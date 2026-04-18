/**
 * ProcessExec types (L1)
 *
 * External process execution interface.
 */

export const PROCESS_EXEC_TIMEOUT_MIN_MS = 1000;
export const PROCESS_EXEC_TIMEOUT_MAX_MS = 120_000;
export const PROCESS_EXEC_DEFAULT_TIMEOUT_MS = 30_000;
export interface ExecOptions {
  /** Working directory (required) */
  cwd: string;
  /** Timeout in ms, clamped to [MIN, MAX] */
  timeout?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

export interface ExecResult {
  /** Raw stdout */
  stdout: string;
  /** Raw stderr */
  stderr: string;
  /** Process exit code */
  exitCode: number;
}

/**
 * Error thrown when process execution fails.
 * Carries raw output for consumer diagnostics.
 */
export class ProcessExecError extends Error {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly killed: boolean;
  readonly maxBufferExceeded: boolean;

  constructor(options: {
    message: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
    killed?: boolean;
    maxBufferExceeded?: boolean;
  }) {
    super(options.message);
    this.name = 'ProcessExecError';
    this.stdout = options.stdout ?? '';
    this.stderr = options.stderr ?? '';
    this.exitCode = options.exitCode ?? null;
    this.killed = options.killed ?? false;
    this.maxBufferExceeded = options.maxBufferExceeded ?? false;
  }
}
