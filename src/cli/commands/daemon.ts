/**
 * daemon command - main daemon entry point
 *
 * Supports foreground execution (CLAWFORUM_DAEMON_MODE) and automatic background launch via CLI
 * Responsible for starting ClawRuntime and keeping it running until SIGTERM is received
 */

import * as path from 'path';
import * as fsNative from 'fs';
import * as fsAsync from 'fs/promises';
import { randomUUID } from 'node:crypto';
import { ClawRuntime } from '../../core/runtime.js';
import { MotionRuntime } from '../../core/motion/runtime.js';
import { buildLLMConfig, loadGlobalConfig, loadClawConfig, getClawDir, getMotionDir } from '../config.js';
import type { ClawRuntimeOptions } from '../../core/runtime.js';
import type { InboxMessageInfo } from '../../core/runtime.js';
import type { Message } from '../../types/message.js';
import { startDaemonLoop } from './daemon-loop.js';
import { StreamWriter } from './stream-writer.js';
import { Heartbeat } from '../../core/heartbeat.js';
import { NodeFileSystem } from '../../foundation/fs/node-fs.js';
import { SkillRegistry } from '../../core/skill/registry.js';
import { DEFAULT_MAX_STEPS } from '../../constants.js';
import { scheduleSubAgentWithTracking } from '../../core/tools/builtins/spawn.js';
import { buildRetroPrompt } from '../../prompts/index.js';



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
    try {
      fsNative.writeFileSync(fd, String(process.pid));
    } finally {
      fsNative.closeSync(fd);
    }
  } catch (err: any) {
    if (err.code === 'EEXIST') {
      // lockfile 存在 → 检查持有者是否存活
      try {
        const lockPid = parseInt(fsNative.readFileSync(lockFile, 'utf-8').trim(), 10);
        process.kill(lockPid, 0); // 存活
        console.error(`[daemon] Another ${name} daemon is running (PID: ${lockPid}), exiting`);
        process.exit(1);
      } catch {
        // 持有者已死，删除 stale lock 并重试（ENOENT = 已被别人删，同样继续）
        try { fsNative.unlinkSync(lockFile); } catch (e: any) {
          if (e.code !== 'ENOENT') throw e;
        }
        const fd = fsNative.openSync(lockFile, 'wx');
        try {
          fsNative.writeFileSync(fd, String(process.pid));
        } finally {
          fsNative.closeSync(fd);
        }
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
        maxSteps: globalConfig.motion?.max_steps ?? DEFAULT_MAX_STEPS,
        toolProfile: 'full',
        toolTimeoutMs: globalConfig.tool_timeout_ms,
        subagentMaxSteps: globalConfig.motion?.subagent_max_steps,
        maxConcurrentTasks: globalConfig.motion?.max_concurrent_tasks ?? 3,
        idleTimeoutMs: globalConfig.motion?.llm_idle_timeout_ms,
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
        idleTimeoutMs: globalConfig.motion?.llm_idle_timeout_ms,
      } as ClawRuntimeOptions);

  await runtime.initialize();
  await runtime.resumeContractIfPaused();

  // motion 专属：heartbeat（0 表示禁用）
  let heartbeat: Heartbeat | null = null;
  if (isMotion) {
    const heartbeatIntervalMs = globalConfig.motion?.heartbeat_interval_ms ?? 0;
    if (heartbeatIntervalMs > 0) {
      heartbeat = new Heartbeat(path.join(dir, '..'), {
        interval: heartbeatIntervalMs / 1000  // 转换为秒
      });
    }
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
  } catch (e: any) {
    if (e?.code !== 'ENOENT') {
      console.warn(`[daemon] Failed to clean up heartbeat files: ${e?.message}`);
    }
  }

  // 共用核心循环
  const streamWriter = new StreamWriter(dir);
  streamWriter.open();
  runtime.setParentStreamWriter(streamWriter);
  runtime.setContractNotifyCallback((type, data) => {
    streamWriter.write({ ts: Date.now(), type: 'user_notify', subtype: type, ...data });
  });
  const inboxPendingDir = path.join(dir, 'inbox', 'pending');

  // 注册 review_request 处理器（仅 motion）
  const onInboxMessages = isMotion
    ? async (infos: InboxMessageInfo[]) => {
        for (const { meta } of infos) {
          if (meta.type !== 'review_request') continue;
          const contractId = meta.contract_id;
          if (!contractId) continue;

          // 查 by-contract 反向索引（Step D 写入）
          const byContractPath = path.join(
            dir, 'clawspace', 'pending-retrospective', 'by-contract', `${contractId}.json`,
          );
          let contractTaskId: string;
          let targetClaw: string | null = null;
          try {
            const raw = JSON.parse(await fsAsync.readFile(byContractPath, 'utf-8'));
            contractTaskId = typeof raw.contractTaskId === 'string' ? raw.contractTaskId : '';
            targetClaw = typeof raw.targetClaw === 'string' ? raw.targetClaw : null;
            if (!contractTaskId) continue;
            if (!targetClaw) {
              console.warn('[daemon] by-contract index missing targetClaw, skipping retrospective for contract:', contractId);
              continue;
            }
          } catch { continue; }

          // 加载契约创建子代理的完整 messages（Step A 写入）
          const messagesPath = path.join(
            dir, 'tasks', 'results', `${contractTaskId}.messages.json`,
          );
          let messages: Message[];
          try {
            messages = JSON.parse(await fsAsync.readFile(messagesPath, 'utf-8'));
          } catch (e) {
            console.warn('[daemon] Failed to load messages.json for retrospective:', contractTaskId, e instanceof Error ? e.message : String(e));
            continue;
          }

          // 加载当前 dispatch-skills 列表（best-effort）
          let skillsSummary = '';
          try {
            const motionFs = new NodeFileSystem({ baseDir: dir, enforcePermissions: false });
            const reg = new SkillRegistry(motionFs, 'clawspace/dispatch-skills');
            await reg.loadAll();
            const formatted = reg.formatForContext();
            if (!formatted.includes('No skills loaded')) {
              skillsSummary = formatted;
            }
          } catch (e) {
            console.warn('[daemon] Failed to load dispatch-skills for retro prompt:', e instanceof Error ? e.message : String(e));
          }

          // 构建复盘 prompt
          const retroPrompt = buildRetroPrompt(targetClaw, contractId, skillsSummary);

          // 调度复盘子代理
          const taskSystem = runtime.getTaskSystem();
          try {
            await scheduleSubAgentWithTracking(
              taskSystem,
              streamWriter,
              {
                prompt: retroPrompt,
                messages,
                tools: ['read', 'write', 'skill', 'exec'],
                timeout: 600,
                maxSteps: DEFAULT_MAX_STEPS,
                parentClawId: 'motion',
                originClawId: 'motion',
              }
            );
          } catch (e) {
            console.warn('[daemon] retrospective schedule failed, keeping pending files for retry:', e);
            return;  // 不删文件，留待下次 daemon 重启时重试
          }

          // 调度成功后才清理（best-effort）
          await fsAsync.unlink(byContractPath).catch(e =>
            console.warn('[daemon] Failed to clean by-contract file:', e instanceof Error ? e.message : String(e))
          );
          const pendingPath = path.join(
            dir, 'clawspace', 'pending-retrospective', `${contractTaskId}.json`,
          );
          await fsAsync.unlink(pendingPath).catch(e =>
            console.warn('[daemon] Failed to clean pending-retrospective file:', e instanceof Error ? e.message : String(e))
          );
        }
      }
    : undefined;

  const { promise, stop } = startDaemonLoop({
    runtime,
    agentDir: dir,
    inboxPendingDir,
    label: isMotion ? '[motion daemon]' : '[daemon]',
    streamWriter,
    heartbeat: heartbeat ?? undefined,  // 传入心跳实例
    notifyMotionDir: isMotion ? undefined : getMotionDir(),
    onInboxMessages,   // 新增
  });

  // shutdown
  const shutdown = async (signal: string) => {
    stop();
    try {
      await runtime.stop();
    } catch (e) {
      console.error('[daemon] runtime.stop() failed:', e instanceof Error ? e.message : String(e));
    }
    streamWriter.close();
    // 清理 PID 文件和 lockfile（只有文件仍属于本进程才删除，防止误删新 daemon 的文件）
    try {
      const storedPid = fsNative.readFileSync(pidFile, 'utf-8').trim();
      if (storedPid === String(process.pid)) fsNative.unlinkSync(pidFile);
    } catch (e: any) {
      console.warn(`[daemon] Failed to clean up pid file: ${e?.message}`);
    }
    try {
      const storedLockPid = fsNative.readFileSync(lockFile, 'utf-8').trim();
      if (storedLockPid === String(process.pid)) fsNative.unlinkSync(lockFile);
    } catch (e: any) {
      console.warn(`[daemon] Failed to clean up lock file: ${e?.message}`);
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  const label = isMotion ? '[motion daemon]' : '[daemon]';
  console.log(`${label} Started`);
  await promise;
}
