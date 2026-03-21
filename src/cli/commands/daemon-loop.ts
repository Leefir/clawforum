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
      let currentSources: string[] = [];
      let interruptPoller: ReturnType<typeof setInterval> | null = null;

      try {
        // Get streaming callbacks (if streamWriter is provided)
        const callbacks = streamWriter?.createCallbacks();
        
        // Wrap callbacks: intercept onInboxDrained to capture sources, write turn_start in onBeforeLLMCall
        const wrappedCallbacks = callbacks ? {
          ...callbacks,
          onInboxDrained: (sources: string[]) => {
            currentSources = sources;
            callbacks.onInboxDrained?.(sources);
          },
          onBeforeLLMCall: () => {
            if (!turnStarted) {
              streamWriter?.write({
                ts: Date.now(),
                type: 'turn_start',
                source: currentSources.join(' | ') || undefined,
              });
              turnStarted = true;
            }
            callbacks.onBeforeLLMCall?.();
          },
        } : undefined;

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
            
            // Turn finished (not interrupted)
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
        } else {
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
