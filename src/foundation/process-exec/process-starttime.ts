import { execFileSync } from 'child_process';

/**
 * Opaque branded type representing an OS-reported process start time.
 *
 * Concrete format: `Sat May 18 10:30:00 2026` (POSIX `ps -o lstart=`).
 * The brand exists to prevent accidental cross-type confusion at compile time
 * (e.g. passing an arbitrary user string where a real lstart value is expected).
 *
 * Construction is intentionally narrow:
 *   - `getProcessStartTime(pid)` — canonical OS lookup
 *   - `makeProcessStartTime(raw)` — for deserializing trusted persisted values
 *     (PID file / lock file content read back from disk)
 *
 * (phase 1385 G6a / claim 5)
 */
declare const ProcessStartTimeBrand: unique symbol;
export type ProcessStartTime = string & { readonly [ProcessStartTimeBrand]: true };

/**
 * Construct a ProcessStartTime from a previously-serialized raw string.
 * Caller is responsible for ensuring the string originated from
 * `getProcessStartTime` (i.e. was produced by `ps -o lstart=`).
 */
export function makeProcessStartTime(raw: string): ProcessStartTime {
  return raw as ProcessStartTime;
}

/**
 * Get process start time (cross-POSIX via `ps -o lstart=`).
 * Returns `undefined` on Windows / process gone / ps failure (skip-verify path).
 */
export function getProcessStartTime(pid: number): ProcessStartTime | undefined {
  if (process.platform === 'win32') return undefined;
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const trimmed = out.trim();
    return trimmed === '' ? undefined : makeProcessStartTime(trimmed);
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { status?: number | null; signal?: NodeJS.Signals | null };
    // Known design-internal silent paths:
    //   (a) status === 1 + empty stdout = ps process-level 'target PID does not exist' (POSIX standard exit code)
    //   (b) code === 'ENOENT' = ps binary itself missing (rare; Windows is platform-guarded to early-return)
    const isProcessGone = err.status === 1;
    const isBinaryMissing = err.code === 'ENOENT';
    if (!isProcessGone && !isBinaryMissing) {
      // silent: non-ENOENT ps failure — caller decides skip-verify
    }
    return undefined; // caller decides skip-verify
  }
}
