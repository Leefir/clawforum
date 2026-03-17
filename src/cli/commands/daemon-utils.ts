/**
 * Daemon utilities - fs.watch 等待 inbox 新文件
 */

import * as fsNative from 'fs';

/**
 * 等待 inbox 目录出现新文件，或超时。
 * 用 fs.watch 监听 + fallback 超时（防止 watch 事件丢失）。
 */
export function waitForInbox(inboxPendingDir: string, timeoutMs: number): Promise<void> {
  return new Promise(resolve => {
    let watcher: ReturnType<typeof fsNative.watch> | null = null;
    const timer = setTimeout(() => {
      watcher?.close();
      resolve();
    }, timeoutMs);

    try {
      // 确保目录存在
      fsNative.mkdirSync(inboxPendingDir, { recursive: true });
      watcher = fsNative.watch(inboxPendingDir, () => {
        clearTimeout(timer);
        watcher?.close();
        resolve();
      });
      // watch 出错时 fallback 到超时
      watcher.on('error', () => {
        clearTimeout(timer);
        watcher?.close();
        resolve();
      });
    } catch {
      // watch 失败，fallback 到超时
      clearTimeout(timer);
      resolve();
    }
  });
}
