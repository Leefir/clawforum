/**
 * daemon command - 守护进程内部命令
 *
 * 由 ProcessManager.spawn 调用，不对用户暴露
 * 负责启动 ClawRuntime 并保持运行直到收到 SIGTERM
 */

import * as path from 'path';
import * as fsNative from 'fs';
import { randomUUID } from 'crypto';
import { ClawRuntime } from '../../core/runtime.js';
import { NodeFileSystem } from '../../foundation/fs/node-fs.js';
import { buildLLMConfig, loadGlobalConfig, loadClawConfig, getClawDir, getMotionDir } from '../config.js';
import type { ClawRuntimeOptions } from '../../core/runtime.js';
import { startDaemonLoop } from './daemon-loop.js';
import { StreamWriter } from './stream-writer.js';

/**
 * 通知 motion claw 已退出（best-effort 同步写 .md YAML）
 * 在 process.exit 前调用，确保消息写入 motion inbox
 */
function notifyMotionExit(clawId: string, reason: string): void {
  try {
    const motionInbox = path.join(getMotionDir(), 'inbox', 'pending');
    fsNative.mkdirSync(motionInbox, { recursive: true });
    const now = new Date();
    const ts = now.toISOString().replace(/[-:]/g, '').slice(0, 15);
    const uuid8 = randomUUID().slice(0, 8);
    
    // YAML frontmatter 格式（MVP 对齐）
    const content = `---
id: crash-${now.getTime()}-${clawId}
type: crash_notification
source: claw_daemon
priority: high
timestamp: ${now.toISOString()}
claw_id: ${clawId}
---

Claw "${clawId}" exited (${reason}).
`;
    fsNative.writeFileSync(path.join(motionInbox, `${ts}_crash_${uuid8}.md`), content);
  } catch (err) {
    console.warn(`[daemon] Failed to notify motion of exit:`, err);
  }
}

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

  // MVP 对齐：初始化 + 恢复契约（替代 start() 的 InboxWatcher）
  await runtime.initialize();
  await runtime.resumeContractIfPaused();

  // 启动时检查：若有 running 契约但 inbox 为空，写启动消息触发执行
  try {
    const inboxPending = path.join(clawDir, 'inbox', 'pending');
    const contractDir = path.join(clawDir, 'contract');
    const inboxEmpty = !fsNative.existsSync(inboxPending) ||
      fsNative.readdirSync(inboxPending).filter(f => f.endsWith('.md')).length === 0;
    if (inboxEmpty && fsNative.existsSync(contractDir)) {
      const entries = fsNative.readdirSync(contractDir, { withFileTypes: true });
      const hasRunning = entries.some(e => {
        if (!e.isDirectory()) return false;
        try {
          const p = JSON.parse(fsNative.readFileSync(path.join(contractDir, e.name, 'progress.json'), 'utf-8'));
          return p.status === 'running';
        } catch (err) {
          console.warn(`[daemon] Failed to parse progress.json for ${e.name}:`, err);
          return false;
        }
      });
      if (hasRunning) {
        fsNative.mkdirSync(inboxPending, { recursive: true });
        const now = new Date();
        const ts = now.toISOString().replace(/[-:]/g, '').slice(0, 15);
        const uuid8 = randomUUID().slice(0, 8);
        const content = `---\nid: startup-${now.getTime()}\ntype: message\nsource: system\npriority: high\ntimestamp: ${now.toISOString()}\n---\n\n系统启动。请检查活跃契约并继续执行。\n`;
        fsNative.writeFileSync(path.join(inboxPending, `${ts}_startup_${uuid8}.md`), content);
      }
    }
  } catch {
    // best-effort
  }

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

  // 创建 stream writer
  const streamWriter = new StreamWriter(clawDir);
  streamWriter.open();

  // 统一事件循环
  const inboxPendingDir = path.join(clawDir, 'inbox', 'pending');
  const { promise, stop } = startDaemonLoop({
    runtime,
    inboxPendingDir,
    label: '[daemon]',
    streamWriter,
    onBatchComplete: async () => {
      await writeStatus(runtime, clawDir, fs);
    },
  });

  // 处理 SIGTERM - 优雅关闭
  process.on('SIGTERM', async () => {
    stop();
    streamWriter.close();
    clearInterval(statusInterval);
    try {
      await runtime.stop();
    } catch {
      // 忽略停止错误
    }
    notifyMotionExit(name, 'SIGTERM');
    process.exit(0);
  });

  // 处理 SIGINT (Ctrl+C) - 同样优雅关闭
  process.on('SIGINT', async () => {
    stop();
    streamWriter.close();
    clearInterval(statusInterval);
    try {
      await runtime.stop();
    } catch {
      // 忽略停止错误
    }
    notifyMotionExit(name, 'SIGINT');
    process.exit(0);
  });

  // 确保 exit 时清理 interval
  process.on('exit', () => {
    clearInterval(statusInterval);
  });

  await promise;
}
