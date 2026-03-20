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
import { writeInboxMessage } from '../../utils/inbox-writer.js';

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
      writeInboxMessage({
        inboxDir: inboxPending,
        type: 'message',
        source: 'system',
        priority: 'high',
        body: '系统启动。请检查活跃契约并继续执行。',
        idPrefix: 'startup',
        filenameTag: 'startup',
      });
    }
  } catch { /* best-effort */ }
}


/**
 * 守护进程主函数（支持 claw 和 motion）
 */
export async function daemonCommand(name: string): Promise<void> {
  const globalConfig = loadGlobalConfig();
  const isMotion = name === 'motion';

  // 配置
  const dir = isMotion ? getMotionDir() : getClawDir(name);
  
  // lockfile 单实例保护
  const statusDir = path.join(dir, 'status');
  fsNative.mkdirSync(statusDir, { recursive: true });
  const lockFile = path.join(statusDir, 'daemon.lock');
  const pidFile = path.join(statusDir, 'pid');
  
  // 尝试获取排他锁
  try {
    const fd = fsNative.openSync(lockFile, 'wx');
    fsNative.writeFileSync(fd, String(process.pid));
    fsNative.closeSync(fd);
  } catch (err: any) {
    if (err.code === 'EEXIST') {
      // lockfile 存在 → 检查持有者是否存活
      try {
        const lockPid = parseInt(fsNative.readFileSync(lockFile, 'utf-8').trim(), 10);
        process.kill(lockPid, 0); // 存活
        console.error(`[daemon] Another ${name} daemon is running (PID: ${lockPid}), exiting`);
        process.exit(1);
      } catch {
        // 持有者已死，删除 stale lock 并重试
        fsNative.unlinkSync(lockFile);
        const fd = fsNative.openSync(lockFile, 'wx');
        fsNative.writeFileSync(fd, String(process.pid));
        fsNative.closeSync(fd);
      }
    } else {
      throw err;
    }
  }
  
  // 写 PID 文件（兜底：无论启动方式都确保 PID 可查）
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
        maxSteps: globalConfig.motion?.max_steps ?? 100,
        toolProfile: 'full',
        toolTimeoutMs: globalConfig.tool_timeout_ms,
        subagentMaxSteps: globalConfig.motion?.subagent_max_steps ?? 20,
        maxConcurrentTasks: globalConfig.motion?.max_concurrent_tasks ?? 3,
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
  let heartbeat: Heartbeat | null = null;
  if (isMotion) {
    // 从配置读取心跳间隔，默认 5 分钟（300 秒）
    const heartbeatIntervalMs = globalConfig.motion?.heartbeat_interval_ms ?? 300000;
    heartbeat = new Heartbeat(path.join(dir, '..'), {
      interval: heartbeatIntervalMs / 1000  // 转换为秒
    });
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
    heartbeat: heartbeat ?? undefined,  // 传入心跳实例
  });

  // shutdown
  const shutdown = async (signal: string) => {
    stop();
    streamWriter.close();
    try {
      await runtime.stop();
    } catch {
      // 忽略停止错误
    }
    // 清理 PID 文件和 lockfile
    try { fsNative.unlinkSync(pidFile); } catch {}
    try { fsNative.unlinkSync(lockFile); } catch {}
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  const label = isMotion ? '[motion daemon]' : '[daemon]';
  console.log(`${label} Started`);
  await promise;
}
