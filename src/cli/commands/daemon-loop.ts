/**
 * 通用 daemon 事件循环
 * motion 和 claw 共用
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
  agentDir: string;                      // agent 根目录，用于监听 interrupt 信号
  inboxPendingDir: string;
  label: string;                         // 日志前缀，如 '[motion daemon]' 或 '[daemon]'
  onBatchComplete?: () => Promise<void>; // chain reaction 结束后回调
  fallbackTimeoutMs?: number;            // fs.watch fallback 超时（默认 30000ms）
  streamWriter?: StreamWriter;           // 流式事件写入
  heartbeat?: Heartbeat;                 // 心跳实例（motion 专用）
}

/**
 * 等待 inbox 目录出现新文件，或超时。
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
 * 运行 daemon 事件循环。
 * 返回 promise 和 stop 函数。
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
      // 心跳检查（移入 daemon loop，避免 setInterval 竞态）
      if (options.heartbeat?.isDue()) {
        options.heartbeat.fire();
      }

      // motion: 扫描 claw outbox 未读消息
      if (options.heartbeat) {
        scanClawOutboxes(path.join(agentDir, '..'));
      }

      let turnStarted = false;
      let currentSources: string[] = [];
      let interruptPoller: ReturnType<typeof setInterval> | null = null;

      try {
        // 获取流式回调（如果有 streamWriter）
        const callbacks = streamWriter?.createCallbacks();
        
        // 包装回调：拦截 onInboxDrained 获取 sources，在 onBeforeLLMCall 写 turn_start
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

        // 启动 interrupt 文件轮询
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
            // chain reaction：处理到无积压为止
            let more = injected;
            while (more > 0 && !stopped) {
              more = await runtime.processBatch(wrappedCallbacks);
            }
            
            // 一轮结束（非中断）
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
        // 清理轮询
        if (interruptPoller) {
          clearInterval(interruptPoller);
          interruptPoller = null;
        }

        // 区分用户中断和真正错误
        if (err instanceof Error && err.message === 'Execution aborted') {
          // 用户中断
          if (turnStarted) {
            streamWriter?.write({ ts: Date.now(), type: 'turn_interrupted' });
          }
          // 中断后短暂等待，避免立即处理下一条 inbox 消息（如心跳）
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
