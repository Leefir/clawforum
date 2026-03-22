/**
 * Generic daemon event loop
 * Shared by both motion and claw
 */

import * as fsNative from 'fs';
import * as path from 'path';
import type { ClawRuntime } from '../../core/runtime.js';
import type { StreamWriter } from './stream-writer.js';

import type { Heartbeat } from '../../core/heartbeat.js';
import { scanClawOutboxes } from '../../core/outbox-scanner.js';
import { DAEMON_FALLBACK_TIMEOUT_MS, INTERRUPT_RECOVERY_DELAY_MS } from '../../constants.js';

export interface DaemonLoopOptions {
  runtime: ClawRuntime;
  agentDir: string;                      // agent root directory, used to listen for interrupt signals
  inboxPendingDir: string;
  label: string;                         // log prefix, e.g. '[motion daemon]' or '[daemon]'
  onBatchComplete?: () => Promise<void>; // callback invoked after a chain reaction finishes
  fallbackTimeoutMs?: number;            // fs.watch fallback timeout (default 30000ms)
  streamWriter?: StreamWriter;           // streaming event writer
  heartbeat?: Heartbeat;                 // heartbeat instance (motion only)
}

/**
 * Wait for a new file to appear in the inbox directory, or until timeout.
 */
function waitForInbox(inboxPendingDir: string, timeoutMs: number): Promise<void> {
  return new Promise(resolve => {
    let watcher: ReturnType<typeof fsNative.watch> | null = null;
    const timer = setTimeout(() => {
      watcher?.close();
      resolve();
    }, timeoutMs);

    try {
      fsNative.mkdirSync(inboxPendingDir, { recursive: true });
      watcher = fsNative.watch(inboxPendingDir, () => {
        clearTimeout(timer);
        watcher?.close();
        resolve();
      });
      watcher.on('error', () => {
        clearTimeout(timer);
        watcher?.close();
        resolve();
      });
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

/**
 * Run the daemon event loop.
 * Returns a promise and a stop function.
 */
export function startDaemonLoop(options: DaemonLoopOptions): {
  promise: Promise<void>;
  stop: () => void;
} {
  const { runtime, agentDir, inboxPendingDir, label, onBatchComplete, streamWriter } = options;
  const fallbackTimeout = options.fallbackTimeoutMs ?? DAEMON_FALLBACK_TIMEOUT_MS;
  let stopped = false;

  // LLM failure retry state
  const LLM_ERROR_PATTERN = /all providers failed/i;
  const LLM_MAX_RETRIES = 3;
  let llmRetryCount = 0;
  let llmRetryDelayMs = 30_000;

  const stop = () => { stopped = true; };

  const promise = (async () => {
    while (!stopped) {
      // Heartbeat check (moved into daemon loop to avoid setInterval race conditions)
      if (options.heartbeat?.isDue()) {
        options.heartbeat.fire();
      }

      // motion: scan claw outboxes for unread messages
      if (options.heartbeat) {
        scanClawOutboxes(path.join(agentDir, '..'));
      }

      let turnStarted = false;
      let currentSources: Array<{ text: string; type: string }> = [];
      let interruptPoller: ReturnType<typeof setInterval> | null = null;

      // Build wrappedCallbacks outside try so catch block can access it for retryLastTurn
      const callbacks = streamWriter?.createCallbacks();
      const wrappedCallbacks = callbacks ? {
        ...callbacks,
        onInboxDrained: (sources: Array<{ text: string; type: string }>) => {
          currentSources = sources;
          callbacks.onInboxDrained?.(sources);
        },
        onBeforeLLMCall: () => {
          if (!turnStarted) {
            streamWriter?.write({
              ts: Date.now(),
              type: 'turn_start',
              sources: currentSources.length > 0 ? currentSources : undefined,
            });
            turnStarted = true;
          }
          callbacks.onBeforeLLMCall?.();
        },
      } : undefined;

      try {
        // Start polling for the interrupt file
        const interruptFile = path.join(agentDir, 'interrupt');
        let interruptErrCount = 0;
        interruptPoller = setInterval(() => {
          try {
            if (fsNative.existsSync(interruptFile)) {
              fsNative.unlinkSync(interruptFile);
              runtime.abort();
              interruptErrCount = 0;
            }
          } catch (err) {
            interruptErrCount++;
            if (interruptErrCount % 5 === 1) {
              console.warn(`${label} interrupt poll error: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }, 200);

        try {
          const injected = await runtime.processBatch(wrappedCallbacks);
          if (injected > 0) {
            // chain reaction: keep processing until the backlog is clear
            let more = injected;
            while (more > 0 && !stopped) {
              more = await runtime.processBatch(wrappedCallbacks);
            }
            
            // Turn finished (not interrupted) — reset LLM retry state
            llmRetryCount = 0;
            llmRetryDelayMs = 30_000;
            if (turnStarted) {
              streamWriter?.write({ ts: Date.now(), type: 'turn_end' });
            }
            await onBatchComplete?.();
          } else {
            await waitForInbox(inboxPendingDir, fallbackTimeout);
          }
        } finally {
          if (interruptPoller) {
            clearInterval(interruptPoller);
            interruptPoller = null;
          }
        }
      } catch (err) {
        // Clean up the poller
        if (interruptPoller) {
          clearInterval(interruptPoller);
          interruptPoller = null;
        }

        // Distinguish user interrupts from genuine errors
        if (err instanceof Error && err.message === 'Execution aborted') {
          // User interrupt
          if (turnStarted) {
            streamWriter?.write({ ts: Date.now(), type: 'turn_interrupted' });
          }
          // Brief wait after interrupt to avoid immediately processing the next inbox message (e.g. heartbeat)
          await new Promise(resolve => setTimeout(resolve, INTERRUPT_RECOVERY_DELAY_MS));
        } else if (
          err instanceof Error &&
          LLM_ERROR_PATTERN.test(err.message) &&
          llmRetryCount < LLM_MAX_RETRIES
        ) {
          // Transient LLM failure — retry with exponential backoff
          llmRetryCount++;
          const delaySec = Math.round(llmRetryDelayMs / 1000);
          console.warn(`${label} LLM error, retrying in ${delaySec}s (${llmRetryCount}/${LLM_MAX_RETRIES}): ${err.message}`);
          streamWriter?.write({ ts: Date.now(), type: 'turn_error', error: `${err.message} [retrying in ${delaySec}s]` });
          await new Promise(resolve => setTimeout(resolve, llmRetryDelayMs));
          llmRetryDelayMs = Math.min(llmRetryDelayMs * 2, 300_000);
          try {
            await runtime.retryLastTurn(wrappedCallbacks);
            llmRetryCount = 0;
            llmRetryDelayMs = 30_000;
            if (turnStarted) streamWriter?.write({ ts: Date.now(), type: 'turn_end' });
            await onBatchComplete?.();
          } catch (retryErr) {
            console.error(`${label} retry ${llmRetryCount} also failed:`, retryErr);
            if (turnStarted) {
              const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
              streamWriter?.write({ ts: Date.now(), type: 'turn_error', error: msg });
            }
            await waitForInbox(inboxPendingDir, fallbackTimeout);
          }
        } else {
          // Non-LLM error, or max retries exceeded — reset and wait
          llmRetryCount = 0;
          llmRetryDelayMs = 30_000;
          console.error(`${label} processBatch error:`, err);
          if (turnStarted) {
            const msg = err instanceof Error ? err.message : String(err);
            streamWriter?.write({ ts: Date.now(), type: 'turn_error', error: msg });
          }
          await waitForInbox(inboxPendingDir, fallbackTimeout);
        }
      }
    }
  })();

  return { promise, stop };
}
