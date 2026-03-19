/**
 * daemon command - 守护进程主入口
 *
 * 支持前台运行（CLAWFORUM_DAEMON_MODE）和通过 CLI 自动后台启动
 * 负责启动 ClawRuntime 并保持运行直到收到 SIGTERM
 */

import * as path from 'path';
import * as fsNative from 'fs';
import { randomUUID } from 'node:crypto';
import { ClawRuntime } from '../../core/runtime.js';
import { MotionRuntime } from '../../core/motion/runtime.js';
import { buildLLMConfig, loadGlobalConfig, loadClawConfig, getClawDir, getMotionDir } from '../config.js';
import type { ClawRuntimeOptions } from '../../core/runtime.js';
import { startDaemonLoop } from './daemon-loop.js';
import { StreamWriter } from './stream-writer.js';
import { Heartbeat } from '../../core/heartbeat.js';
import { HEARTBEAT_CHECK_INTERVAL_MS } from '../../constants.js';

/**
 * 检查是否有活跃契约（active/ 或 paused/ 中存在子目录）
 */
function hasContract(dir: string): boolean {
  const contractDir = path.join(dir, 'contract');
  for (const sub of ['active', 'paused']) {
    try {
      const entries = fsNative.readdirSync(path.join(contractDir, sub), { withFileTypes: true });
      if (entries.some(e => e.isDirectory())) return true;
    } catch { /* skip */ }
  }
  return false;
}

/**
 * 注入启动消息：若有活跃契约但 inbox 为空，写启动消息触发执行
 */
function injectStartupMessage(dir: string): void {
  try {
    const inboxPending = path.join(dir, 'inbox', 'pending');
    const activeDir = path.join(dir, 'contract', 'active');
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
  } catch { /* best-effort */ }
}

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
 * 守护进程主函数（支持 claw 和 motion）
 */
export async function daemonCommand(name: string): Promise<void> {
  const globalConfig = loadGlobalConfig();
  const isMotion = name === 'motion';

  // 配置
  const dir = isMotion ? getMotionDir() : getClawDir(name);
  
  // 写 PID 文件（兜底：无论启动方式都确保 PID 可查）
  const statusDir = path.join(dir, 'status');
  fsNative.mkdirSync(statusDir, { recursive: true });
  const pidFile = path.join(statusDir, 'pid');
  fsNative.writeFileSync(pidFile, String(process.pid));
  
  const clawConfig = isMotion ? null : loadClawConfig(name);
  const llmConfig = isMotion
    ? buildLLMConfig(globalConfig)
    : buildLLMConfig(globalConfig, clawConfig!);

  // Runtime
  const runtime = isMotion
    ? new MotionRuntime({
        clawId: 'motion',
        clawDir: dir,
        llmConfig,
        maxSteps: 100,
        toolProfile: 'full',
        toolTimeoutMs: globalConfig.tool_timeout_ms,
        subagentMaxSteps: 20, // motion 用默认值
        maxConcurrentTasks: 3,
      })
    : new ClawRuntime({
        clawId: name,
        clawDir: dir,
        llmConfig,
        maxSteps: clawConfig!.max_steps,
        toolProfile: clawConfig!.tool_profile,
        toolTimeoutMs: globalConfig.tool_timeout_ms,
        subagentMaxSteps: clawConfig!.subagent_max_steps,
        maxConcurrentTasks: clawConfig!.max_concurrent_tasks,
      } as ClawRuntimeOptions);

  await runtime.initialize();
  await runtime.resumeContractIfPaused();

  // motion 专属：heartbeat
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  if (isMotion) {
    // 从配置读取心跳间隔，默认 5 分钟（300 秒）
    const heartbeatIntervalMs = globalConfig.motion?.heartbeat_interval_ms ?? 300000;
    const heartbeat = new Heartbeat(path.join(dir, '..'), {
      interval: heartbeatIntervalMs / 1000  // 转换为秒
    });
    heartbeatInterval = setInterval(() => {
      if (heartbeat.isDue()) heartbeat.fire();
    }, HEARTBEAT_CHECK_INTERVAL_MS);
  }

  // 清理残留心跳（上次 daemon 的遗留，重启后无需立即巡查）
  try {
    const pendingDir = path.join(dir, 'inbox', 'pending');
    const files = fsNative.readdirSync(pendingDir);
    for (const f of files) {
      if (f.includes('_heartbeat_')) {
        fsNative.unlinkSync(path.join(pendingDir, f));
      }
    }
  } catch {}

  // 通用：有契约+空 inbox → 注入启动消息
  injectStartupMessage(dir);

  // 共用核心循环
  const streamWriter = new StreamWriter(dir);
  streamWriter.open();
  const inboxPendingDir = path.join(dir, 'inbox', 'pending');
  const { promise, stop } = startDaemonLoop({
    runtime,
    agentDir: dir,
    inboxPendingDir,
    label: isMotion ? '[motion daemon]' : '[daemon]',
    streamWriter,
  });

  // shutdown
  const shutdown = async (signal: string) => {
    stop();
    streamWriter.close();
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    try {
      await runtime.stop();
    } catch {
      // 忽略停止错误
    }
    if (!isMotion && hasContract(dir)) {
      notifyMotionExit(name, signal);
    }
    // 清理 PID 文件
    try { fsNative.unlinkSync(pidFile); } catch {}
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  const label = isMotion ? '[motion daemon]' : '[daemon]';
  console.log(`${label} Started`);
  await promise;
}
