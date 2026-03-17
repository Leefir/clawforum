/**
 * daemon command - 守护进程内部命令
 *
 * 由 ProcessManager.spawn 调用，不对用户暴露
 * 负责启动 ClawRuntime 并保持运行直到收到 SIGTERM
 */

import * as path from 'path';
import * as fsNative from 'fs';
import { randomUUID } from 'node:crypto';
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

  // 创建 fs 实例
  const fs = new NodeFileSystem({ baseDir: clawDir, enforcePermissions: false });

  // MVP 对齐：初始化 + 恢复契约（替代 start() 的 InboxWatcher）
  await runtime.initialize();
  await runtime.resumeContractIfPaused();

  // 启动时检查：若有活跃契约但 inbox 为空，写启动消息触发执行
  try {
    const inboxPending = path.join(clawDir, 'inbox', 'pending');
    const activeDir = path.join(clawDir, 'contract', 'active');
    const inboxEmpty = !fsNative.existsSync(inboxPending) ||
      fsNative.readdirSync(inboxPending).filter(f => f.endsWith('.md')).length === 0;
    
    let hasRunning = false;
    try {
      const entries = fsNative.readdirSync(activeDir, { withFileTypes: true });
      hasRunning = entries.some(e => e.isDirectory());
    } catch { /* no active dir */ }
    
    if (inboxEmpty && hasRunning) {
      fsNative.mkdirSync(inboxPending, { recursive: true });
      const now = new Date();
      const ts = now.toISOString().replace(/[-:]/g, '').slice(0, 15);
      const uuid8 = randomUUID().slice(0, 8);
      const content = `---\nid: startup-${now.getTime()}\ntype: message\nsource: system\npriority: high\ntimestamp: ${now.toISOString()}\n---\n\n系统启动。请检查活跃契约并继续执行。\n`;
      fsNative.writeFileSync(path.join(inboxPending, `${ts}_startup_${uuid8}.md`), content);
    }
  } catch {
    // best-effort
  }

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
  });

  // 检查是否有活跃契约（active/ 或 paused/ 中存在子目录）
  function hasContract(): boolean {
    const contractDir = path.join(clawDir, 'contract');
    for (const sub of ['active', 'paused']) {
      try {
        const entries = fsNative.readdirSync(path.join(contractDir, sub), { withFileTypes: true });
        if (entries.some(e => e.isDirectory())) return true;
      } catch { /* skip */ }
    }
    return false;
  }

  // 处理 SIGTERM - 优雅关闭
  process.on('SIGTERM', async () => {
    stop();
    streamWriter.close();
    try {
      await runtime.stop();
    } catch {
      // 忽略停止错误
    }
    // 只有有活跃契约时才通知 motion
    if (hasContract()) {
      notifyMotionExit(name, 'SIGTERM');
    }
    process.exit(0);
  });

  // 处理 SIGINT (Ctrl+C) - 同样优雅关闭
  process.on('SIGINT', async () => {
    stop();
    streamWriter.close();
    try {
      await runtime.stop();
    } catch {
      // 忽略停止错误
    }
    // 只有有活跃契约时才通知 motion
    if (hasContract()) {
      notifyMotionExit(name, 'SIGINT');
    }
    process.exit(0);
  });

  await promise;
}
