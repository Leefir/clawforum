/**
 * 通用 daemon 事件循环
 * motion 和 claw 共用
 */

import * as fsNative from 'fs';
import * as path from 'path';
import type { ClawRuntime } from '../../core/runtime.js';
import type { StreamWriter } from './stream-writer.js';

export interface DaemonLoopOptions {
  runtime: ClawRuntime;
  inboxPendingDir: string;
  label: string;                         // 日志前缀，如 '[motion daemon]' 或 '[daemon]'
  onBatchComplete?: () => Promise<void>; // chain reaction 结束后回调（claw 用来写 STATUS.md）
  fallbackTimeoutMs?: number;            // fs.watch fallback 超时（默认 30s）
  streamWriter?: StreamWriter;           // 流式事件写入
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
  const { runtime, inboxPendingDir, label, onBatchComplete, streamWriter } = options;
  const fallbackTimeout = options.fallbackTimeoutMs ?? 30000;
  let stopped = false;

  const stop = () => { stopped = true; };

  const promise = (async () => {
    while (!stopped) {
      try {
        // 获取流式回调（如果有 streamWriter）
        const callbacks = streamWriter?.createCallbacks();
        
        // 包装 onBeforeLLMCall，在第一次调用时写 turn_start
        let turnStarted = false;
        const wrappedCallbacks = callbacks ? {
          ...callbacks,
          onBeforeLLMCall: () => {
            if (!turnStarted) {
              streamWriter?.write({ ts: Date.now(), type: 'turn_start' });
              turnStarted = true;
            }
            callbacks.onBeforeLLMCall?.();
          },
        } : undefined;
        
        const injected = await runtime.processBatch(wrappedCallbacks);
        if (injected > 0) {
          // chain reaction：处理到无积压为止
          let more = injected;
          while (more > 0 && !stopped) {
            more = await runtime.processBatch(wrappedCallbacks);
          }
          
          // 一轮结束
          if (turnStarted) {
            streamWriter?.write({ ts: Date.now(), type: 'turn_end' });
          }
          await onBatchComplete?.();
        } else {
          await waitForInbox(inboxPendingDir, fallbackTimeout);
        }
      } catch (err) {
        console.error(`${label} processBatch error:`, err);
        await waitForInbox(inboxPendingDir, fallbackTimeout);
      }
    }
  })();

  return { promise, stop };
}
