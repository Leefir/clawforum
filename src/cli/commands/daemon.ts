/**
 * daemon command - 守护进程内部命令
 *
 * 由 ProcessManager.spawn 调用，不对用户暴露
 * 负责启动 ClawRuntime 并保持运行直到收到 SIGTERM
 */

import * as path from 'path';
import { ClawRuntime } from '../../core/runtime.js';
import { NodeFileSystem } from '../../foundation/fs/node-fs.js';
import { buildLLMConfig, loadGlobalConfig, loadClawConfig, getClawDir } from '../config.js';
import type { ClawRuntimeOptions } from '../../core/runtime.js';

/**
 * 写 STATUS.md
 */
async function writeStatus(
  runtime: ClawRuntime,
  clawDir: string,
  fs: NodeFileSystem
): Promise<void> {
  const statusDir = path.join(clawDir, 'status');
  await fs.ensureDir(statusDir);

  // 获取 inbox/outbox pending 数量
  let inboxPending = 0;
  let outboxPending = 0;

  try {
    const inboxEntries = await fs.list('inbox/pending', { includeDirs: false });
    inboxPending = inboxEntries.length;
  } catch {
    // 忽略错误
  }

  try {
    const outboxEntries = await fs.list('outbox/pending', { includeDirs: false });
    outboxPending = outboxEntries.length;
  } catch {
    // 忽略错误
  }

  const statusContent = `updated_at: ${new Date().toISOString()}
state: running
inbox_pending: ${inboxPending}
outbox_pending: ${outboxPending}
`;

  await fs.writeAtomic(path.join(statusDir, 'STATUS.md'), statusContent);
}

/**
 * 守护进程主函数
 */
export async function daemonCommand(name: string): Promise<void> {
  // 加载配置
  const globalConfig = loadGlobalConfig();
  const clawConfig = loadClawConfig(name);

  const clawDir = getClawDir(name);
  const llmConfig = buildLLMConfig(globalConfig, clawConfig);

  // 创建 runtime
  const runtime = new ClawRuntime({
    clawId: name,
    clawDir,
    llmConfig,
    maxSteps: clawConfig.max_steps,
    toolProfile: clawConfig.tool_profile,
  } as ClawRuntimeOptions);

  // 创建 fs 实例用于写 STATUS.md
  const fs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: false });

  // 启动 runtime（这会启动 InboxWatcher）
  await runtime.start();

  // 立即写一次 STATUS.md
  await writeStatus(runtime, clawDir, fs);

  // 每 30s 更新 STATUS.md
  const statusInterval = setInterval(async () => {
    try {
      await writeStatus(runtime, clawDir, fs);
    } catch {
      // 忽略写状态错误
    }
  }, 30_000);

  // 处理 SIGTERM - 优雅关闭
  process.on('SIGTERM', async () => {
    clearInterval(statusInterval);
    try {
      await runtime.stop();
    } catch {
      // 忽略停止错误
    }
    process.exit(0);
  });

  // 处理 SIGINT (Ctrl+C) - 同样优雅关闭
  process.on('SIGINT', async () => {
    clearInterval(statusInterval);
    try {
      await runtime.stop();
    } catch {
      // 忽略停止错误
    }
    process.exit(0);
  });

  // 守护进程保持运行
  // 使用一个永远不会 resolve 的 promise 来保持进程
  await new Promise(() => {
    // 进程由信号处理器控制退出
  });
}
