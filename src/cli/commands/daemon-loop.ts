/**
 * Generic daemon event loop
 * Shared by both motion and claw
 */

import * as fsNative from 'fs';
import * as path from 'path';
import type { ClawRuntime, InboxMessageInfo } from '../../core/runtime.js';
import type { StreamWriter } from './stream-writer.js';

import type { Heartbeat } from '../../core/heartbeat.js';
import { scanClawOutboxes } from '../../core/outbox-scanner.js';
import { DAEMON_FALLBACK_TIMEOUT_MS, INTERRUPT_RECOVERY_DELAY_MS, OUTBOX_NOTIFY_COOLDOWN_MS, STARTUP_CHECK_COOLDOWN_MS } from '../../constants.js';
import { writeInboxMessage } from '../../utils/inbox-writer.js';
import { SystemAbortError } from '../../core/react/loop.js';

export interface DaemonLoopOptions {
  runtime: ClawRuntime;
  agentDir: string;                      // agent root directory, used to listen for interrupt signals
  clawId: string;                        // agent identifier (kebab-case)
  inboxPendingDir: string;
  label: string;                         // log prefix, e.g. '[motion daemon]' or '[daemon]'
  onBatchComplete?: () => Promise<void>; // callback invoked after a chain reaction finishes
  fallbackTimeoutMs?: number;            // fs.watch fallback timeout (default 30000ms)
  streamWriter?: StreamWriter;           // streaming event writer
  heartbeat?: Heartbeat;                 // heartbeat instance (motion only)
  notifyMotionDir?: string;             // if set (claw only), notify motion on LLM max-retry failure
  onInboxMessages?: (infos: InboxMessageInfo[]) => Promise<void>;  // for review_request handling (motion only)
}

/**
 * Wait for a new file to appear in the inbox directory, or until timeout.
 */
export function waitForInbox(inboxPendingDir: string, timeoutMs: number): Promise<void> {
  return new Promise(resolve => {
    let watcher: ReturnType<typeof fsNative.watch> | null = null;
    let settled = false;

    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      watcher?.close();
      watcher = null;
      resolve();
    };

    const timer = setTimeout(done, timeoutMs);

    try {
      fsNative.mkdirSync(inboxPendingDir, { recursive: true });
      watcher = fsNative.watch(inboxPendingDir, done);
      watcher.on('error', done);
    } catch {
      done();
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
  const { runtime, agentDir, clawId, inboxPendingDir, label, onBatchComplete, streamWriter, notifyMotionDir } = options;
  const fallbackTimeout = options.fallbackTimeoutMs ?? DAEMON_FALLBACK_TIMEOUT_MS;
  let stopped = false;
  let startupFired = false;
  let lastOutboxNotifyTs = 0;

  // LLM failure retry state
  const LLM_ERROR_PATTERN = /all providers failed/i;
  const LLM_MAX_RETRIES = 3;
  let llmRetryCount = 0;
  let llmRetryDelayMs = 30_000;
  let llmRetryPending = false; // set by catch, consumed by next iteration's try

  // 状态文件路径
  const llmRetryStateFile = path.join(agentDir, 'status', 'llm-retry-state.json');

  // 内联辅助：保存当前 retry 状态
  const saveLlmRetryState = () => {
    try {
      fsNative.mkdirSync(path.join(agentDir, 'status'), { recursive: true });
      fsNative.writeFileSync(llmRetryStateFile, JSON.stringify({
        llmRetryCount,
        llmRetryDelayMs,
        llmRetryPending,
      }));
    } catch { /* 状态持久化失败不影响主循环 */ }
  };

  // 检查 clean-stop 标记（仅 motion daemon）：intentional stop → 清零退避状态
  // options.heartbeat 只有 motion 传入，用于区分 motion 和 claw daemon
  const isCleanStop = (() => {
    if (!options.heartbeat) return false;   // claw daemon，不检查
    const cleanStopFile = path.join(path.dirname(agentDir), 'clean-stop');
    try {
      fsNative.accessSync(cleanStopFile);
      fsNative.unlinkSync(cleanStopFile);   // 消费标记，只生效一次
      return true;
    } catch {
      return false;
    }
  })();

  // 启动时恢复（崩溃重启继续退避；clean stop 后跳过，保持默认值）
  if (!isCleanStop) {
    try {
      const saved = JSON.parse(fsNative.readFileSync(llmRetryStateFile, 'utf-8'));
      if (typeof saved.llmRetryCount === 'number') llmRetryCount = saved.llmRetryCount;
      if (typeof saved.llmRetryDelayMs === 'number') llmRetryDelayMs = saved.llmRetryDelayMs;
      if (typeof saved.llmRetryPending === 'boolean') llmRetryPending = saved.llmRetryPending;
    } catch { /* 首次启动或文件损坏，使用默认值 */ }
  }

  const stop = () => { stopped = true; };

  const promise = (async () => {
    while (!stopped) {
      // Startup single-fire: has active contract + inbox is empty → trigger once in-process (no disk write)
      if (!startupFired) {
        startupFired = true;
        const inboxEmpty = (() => {
          try {
            return fsNative.readdirSync(inboxPendingDir).filter(f => f.endsWith('.md')).length === 0;
          } catch { return true; }
        })();
        const hasActive = (() => {
          try {
            return fsNative.readdirSync(path.join(agentDir, 'contract', 'active'), { withFileTypes: true }).some(e => e.isDirectory());
          } catch { return false; }
        })();
        if (inboxEmpty && hasActive) {
          // Dedup: only write if no startup_check already pending (heartbeat pattern)
          const alreadyPending = (() => {
            try {
              return fsNative.readdirSync(inboxPendingDir).some(f => f.includes('_startup_check_'));
            } catch { return false; }
          })();
          // Cooldown: prevent spam from rapid daemon restarts
          const startupCheckTsFile = path.join(agentDir, 'status', 'startup_check_ts');
          const lastStartupCheckTs = (() => {
            try { return parseInt(fsNative.readFileSync(startupCheckTsFile, 'utf-8').trim(), 10); } catch { return 0; }
          })();
          const startupCheckCooledDown = Date.now() - lastStartupCheckTs >= STARTUP_CHECK_COOLDOWN_MS;

          if (!alreadyPending && startupCheckCooledDown) {
            fsNative.mkdirSync(path.join(agentDir, 'status'), { recursive: true });
            fsNative.writeFileSync(startupCheckTsFile, String(Date.now()));
            writeInboxMessage({
              inboxDir: inboxPendingDir,
              type: 'startup_check',
              source: 'daemon',
              priority: 'high',
              body: '系统启动。请检查活跃契约并继续执行。',
              filenameTag: 'startup_check',
            });
          }
          // No continue — processBatch() naturally picks up the inbox file
        }
      }

      // Heartbeat check (moved into daemon loop to avoid setInterval race conditions)
      if (options.heartbeat?.isDue()) {
        options.heartbeat.fire();
      }

      // motion: scan claw outboxes for unread messages
      if (options.heartbeat) {
        const outboxInfos = scanClawOutboxes(path.join(agentDir, '..'));
        if (outboxInfos !== null) {
          if (Date.now() - lastOutboxNotifyTs >= OUTBOX_NOTIFY_COOLDOWN_MS) {
            lastOutboxNotifyTs = Date.now();
            const lines = outboxInfos.map(
              ({ clawId: id, count }) =>
                `- "${id}" 有 ${count} 条未读消息，可执行 \`clawforum claw outbox ${id}\` 查看`
            );
            const body = `有 ${outboxInfos.length} 个 claw 有未读消息：\n${lines.join('\n')}`;
            try {
              writeInboxMessage({
                inboxDir: inboxPendingDir,
                type: 'claw_outbox',
                source: 'system',
                priority: 'normal',
                body,
                filenameTag: 'claw_outbox',
              });
            } catch (e) {
              console.warn(`${label} Failed to write claw_outbox inbox message:`, e instanceof Error ? e.message : String(e));
            }
          }
        } else {
          lastOutboxNotifyTs = 0;  // outbox 已清空，重置静默期
        }
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
        onInboxMessages: options.onInboxMessages,  // forward for review_request handling
      } : (options.onInboxMessages ? { onInboxMessages: options.onInboxMessages } : undefined);

      try {
        // Start polling for the interrupt file
        const interruptFile = path.join(agentDir, 'interrupt');
        let interruptErrCount = 0;
        interruptPoller = setInterval(() => {
          try {
            fsNative.unlinkSync(interruptFile);
            // Reached here: file existed and was deleted — trigger abort
            runtime.abort();
            interruptErrCount = 0;
          } catch (err) {
            if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
              // No interrupt file — normal case, reset error count
              interruptErrCount = 0;
              return;
            }
            interruptErrCount++;
            if (interruptErrCount % 5 === 1) {
              console.warn(`${label} interrupt poll error: ${err instanceof Error ? err.message : String(err)}`);
            }
            if (interruptErrCount >= 20) {
              console.error(`${label} interrupt poll failed ${interruptErrCount} times, disabling`);
              clearInterval(interruptPoller!);
              interruptPoller = null;
            }
          }
        }, 200);

        try {
          if (llmRetryPending) {
            // Retry the last turn without draining inbox (LLM was the failure, not inbox)
            llmRetryPending = false;
            await runtime.retryLastTurn(wrappedCallbacks);
            llmRetryCount = 0;
            llmRetryDelayMs = 30_000;
            saveLlmRetryState();
            if (turnStarted) {
              streamWriter?.write({ ts: Date.now(), type: 'turn_end' });
            }
            await onBatchComplete?.();
          } else {
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
              saveLlmRetryState();
              if (turnStarted) {
                streamWriter?.write({ ts: Date.now(), type: 'turn_end' });
              }
              await onBatchComplete?.();
            } else {
              await waitForInbox(inboxPendingDir, fallbackTimeout);
            }
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

        // Distinguish system idle timeout, user interrupts from genuine errors
        if (err instanceof SystemAbortError) {
          // System idle timeout
          if (turnStarted) {
            const secs = Math.round(err.timeoutMs / 1000);
            streamWriter?.write({ ts: Date.now(), type: 'turn_interrupted', message: `Interrupted by system, ${secs}s timeout` });
          }
          await new Promise(resolve => setTimeout(resolve, INTERRUPT_RECOVERY_DELAY_MS));
        } else if (err instanceof Error && err.message === 'Execution aborted') {
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
          // Transient LLM failure — schedule retry via llmRetryPending flag
          llmRetryCount++;
          const delaySec = Math.round(llmRetryDelayMs / 1000);
          console.warn(`${label} LLM error, retrying in ${delaySec}s (${llmRetryCount}/${LLM_MAX_RETRIES}): ${err.message}`);
          streamWriter?.write({ ts: Date.now(), type: 'turn_error', error: `${err.message} [retrying in ${delaySec}s]` });
          await new Promise(resolve => setTimeout(resolve, llmRetryDelayMs));
          llmRetryDelayMs = Math.min(llmRetryDelayMs * 2, 300_000);
          llmRetryPending = true; // next iteration will call retryLastTurn
          saveLlmRetryState();
        } else {
          // Non-LLM error, or max retries exceeded — reset and wait
          const isLLMMaxRetry = err instanceof Error && LLM_ERROR_PATTERN.test(err.message);
          llmRetryCount = 0;
          llmRetryDelayMs = 30_000;
          saveLlmRetryState();
          console.error(`${label} processBatch error:`, err);
          if (turnStarted) {
            const msg = err instanceof Error ? err.message : String(err);
            streamWriter?.write({ ts: Date.now(), type: 'turn_error', error: msg });
          }
          // Notify motion when LLM max retries exhausted (claw only)
          if (isLLMMaxRetry && notifyMotionDir) {
            const errMsg = err instanceof Error ? err.message : String(err);
            // viewport notification
            try {
              const line = JSON.stringify({ ts: Date.now(), type: 'user_notify', subtype: 'llm_error', clawId, error: errMsg }) + '\n';
              fsNative.appendFileSync(path.join(notifyMotionDir, 'stream.jsonl'), line);
            } catch (notifyErr) {
              console.warn(`${label} Failed to notify motion stream: ${notifyErr instanceof Error ? notifyErr.message : String(notifyErr)}`);
            }
            // inbox notification for motion LLM
            try {
              writeInboxMessage({
                inboxDir: path.join(notifyMotionDir, 'inbox', 'pending'),
                type: 'watchdog_claw_llm_error',
                source: clawId,
                priority: 'high',
                body: `Claw ${clawId} LLM error after ${LLM_MAX_RETRIES} retries: ${errMsg}`,
                idPrefix: 'llm-error',
              });
            } catch (notifyErr) {
              console.warn(`${label} Failed to notify motion inbox: ${notifyErr instanceof Error ? notifyErr.message : String(notifyErr)}`);
            }
          }
          await waitForInbox(inboxPendingDir, fallbackTimeout);
        }
      }
    }
  })();

  return { promise, stop };
}
