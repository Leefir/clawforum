/**
 * Abort signal helper: combines external signal with internal timeout
 */

import { LLMTimeoutError } from '../../types/errors.js';

export interface CombinedAbortHandle {
  /** Combined signal to pass to fetch / SDK */
  signal: AbortSignal;
  /** Explicit abort (used by stream maxTimer, etc.) */
  abort(): void;
  /** Clear the internal timeout without removing the external listener.
   *  Needed when the fetch succeeds and the stream takes over timeout management. */
  clearInternalTimeout(): void;
}

/**
 * Merge an external AbortSignal with an internal timeout into a single
 * AbortController.  Caller receives a handle plus a cleanup function that
 * **must** be called in a `finally` block.
 *
 * @param externalSignal  Optional signal provided by the caller
 * @param timeoutMs       Internal timeout in milliseconds
 * @returns [handle, cleanup]
 */
export function withCombinedAbortSignal(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
): [CombinedAbortHandle, () => void] {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let onAbort: (() => void) | undefined;
  if (externalSignal) {
    onAbort = () => controller.abort();
    externalSignal.addEventListener('abort', onAbort);
  }

  const cleanup = () => {
    clearTimeout(timeoutId);
    if (externalSignal && onAbort) {
      externalSignal.removeEventListener('abort', onAbort);
    }
  };

  const clearInternalTimeout = () => {
    clearTimeout(timeoutId);
  };

  return [
    { signal: controller.signal, abort: () => controller.abort(), clearInternalTimeout },
    cleanup,
  ];
}

/**
 * For fetch-based providers: classify a fetch-thrown DOMException AbortError
 * into "external abort" or "internal timeout", returning the domain error.
 *
 * Returns null for non-AbortError — caller should fall through to other handling.
 */
export function classifyFetchAbortError(
  error: unknown,
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
  providerName: string,
): Error | null {
  if (!(error instanceof DOMException) || error.name !== 'AbortError') {
    return null;
  }
  if (externalSignal?.aborted) {
    return makeExternalAbortError();
  }
  return new LLMTimeoutError(providerName, timeoutMs);
}

/**
 * Construct the standard "Execution aborted" error used for both
 * fetch-based external signal aborts and SDK-based APIUserAbortError.
 */
export function makeExternalAbortError(): Error {
  const err = new Error('Execution aborted');
  err.name = 'AbortError';
  return err;
}
