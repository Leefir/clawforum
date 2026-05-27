/**
 * ProcessExec errors (L1)
 *
 * Error types raised by external process execution.
 */

/**
 * Error thrown when process execution fails.
 * Carries raw output for consumer diagnostics.
 */
export class ProcessExecError extends Error {
  readonly output: string;
  readonly exitCode: number | null;
  readonly code?: string;
  readonly signal?: string;
  readonly killed: boolean;
  readonly maxBufferExceeded: boolean;
  readonly stderr?: string;

  constructor(options: {
    message: string;
    output?: string;
    exitCode?: number | null;
    code?: string;
    signal?: string;
    killed?: boolean;
    maxBufferExceeded?: boolean;
    stderr?: string;
  }) {
    super(options.message);
    this.name = 'ProcessExecError';
    this.output = options.output ?? '';
    this.exitCode = options.exitCode ?? null;
    this.code = options.code;
    this.signal = options.signal;
    this.killed = options.killed ?? false;
    this.maxBufferExceeded = options.maxBufferExceeded ?? false;
    this.stderr = options.stderr;
  }
}

/**
 * Thrown when pgrep / process listing binary is unavailable.
 */
export class ProcessListUnavailable extends Error {
  readonly code = 'PROCESS_LIST_UNAVAILABLE' as const;
  constructor(public readonly pattern: string, public readonly cause: unknown) {
    super(`pgrep unavailable for pattern: ${pattern}`);
    this.name = 'ProcessListUnavailable';
  }
}
