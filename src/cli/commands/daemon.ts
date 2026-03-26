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
        maxSteps: globalConfig.motion?.max_steps ?? 100,
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
          try {
            const raw = JSON.parse(await fsAsync.readFile(byContractPath, 'utf-8'));
            contractTaskId = raw.contractTaskId;
            if (!contractTaskId) continue;
          } catch { continue; }

          // 加载契约创建子代理的完整 messages（Step A 写入）
          const messagesPath = path.join(
            dir, 'tasks', 'results', `${contractTaskId}.messages.json`,
          );
          let messages: Message[];
          try {
            messages = JSON.parse(await fsAsync.readFile(messagesPath, 'utf-8'));
          } catch { continue; }

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
          } catch { /* 加载失败不影响复盘启动 */ }

          // 构建复盘 prompt
          const retroPrompt = `上面是本次契约创建的完整过程。契约已完成，请进行复盘：

1. **分析过程**：契约设计是否合理？subtask 拆分是否清晰？有无可改进之处？
2. **更新技能库**（如有改进）：将更好的做法写入 \`clawspace/dispatch-skills/\` 对应的 SKILL.md（无对应技能则新建子目录）
3. **汇报摘要**：以 2-5 行的精简格式总结本次复盘结论，供 motion 了解情况

${skillsSummary ? `当前 dispatch-skills 供参考：\n${skillsSummary}` : '当前无可用的 dispatch-skills，如有可复用模板请新建。'}`.trim();

          // 调度复盘子代理
          const taskSystem = runtime.getTaskSystem();
          await taskSystem.scheduleSubAgent({
            kind: 'subagent',
            messages,               // 契约创建子代理完整 messages（含创建过程）
            prompt: retroPrompt,    // 追加为新 user message（Step B 的 agent.ts 逻辑）
            tools: ['read', 'write', 'skill', 'exec'],
            timeout: 600,
            maxSteps: 30,
            parentClawId: 'motion',
            originClawId: 'motion',
          }).catch(e => console.warn('[daemon] retrospective schedule failed:', e));

          // 清理 pending-retrospective 文件（best-effort）
          await fsAsync.unlink(byContractPath).catch(() => {});
          const pendingPath = path.join(
            dir, 'clawspace', 'pending-retrospective', `${contractTaskId}.json`,
          );
          await fsAsync.unlink(pendingPath).catch(() => {});
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
    } catch {
      // 忽略停止错误
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
