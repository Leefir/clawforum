/**
 * Watchdog 守护进程
 * 每 30s 检查 motion 存活，内置简易 cron
 */

import * as fs from 'fs';
import { existsSync } from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { setTimeout } from 'timers/promises';
import { getMotionDir, loadGlobalConfig } from '../config.js';
import { ProcessManager } from '../../foundation/process/manager.js';
import { NodeFileSystem } from '../../foundation/fs/node-fs.js';
import { writeInboxMessage } from '../../utils/inbox-writer.js';

// 获取 .clawforum/ 目录（优先使用 CLAWFORUM_ROOT）
function getClawforumDir(): string {
  return path.dirname(getMotionDir());
}

// PID 文件路径
function getWatchdogPidFile(): string {
  return path.join(getClawforumDir(), 'watchdog.pid');
}

/**
 * 创建 Motion 专用的 ProcessManager
 */
function createMotionPM(): ProcessManager {
  const baseDir = path.dirname(getMotionDir());
  const nfs = new NodeFileSystem({ baseDir, enforcePermissions: false });
  return new ProcessManager(nfs, baseDir, (id) => {
    if (id === 'motion') return path.join(baseDir, 'motion');
    return path.join(baseDir, 'claws', id);
  });
}

// Watchdog PID 管理
function writeWatchdogPid(pid: number): void {
  fs.writeFileSync(getWatchdogPidFile(), pid.toString(), 'utf-8');
}

function removeWatchdogPid(): void {
  try {
    fs.unlinkSync(getWatchdogPidFile());
  } catch {
    // 忽略
  }
}

function getWatchdogPid(): number | null {
  try {
    const content = fs.readFileSync(getWatchdogPidFile(), 'utf-8');
    const pid = parseInt(content.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function isWatchdogAlive(): boolean {
  const pid = getWatchdogPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    removeWatchdogPid();
    return false;
  }
}

// 日志
function log(message: string): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  console.log(logLine.trim());
  
  const logDir = path.join(getClawforumDir(), 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(path.join(logDir, 'watchdog.log'), logLine, 'utf-8');
}

// 写入 inbox 消息（YAML frontmatter .md 格式）
function writeWatchdogInboxMessage(type: string, content: Record<string, unknown>): void {
  const inboxDir = path.join(getMotionDir(), 'inbox', 'pending');
  const body = (content.message as string) ?? JSON.stringify(content);
  writeInboxMessage({
    inboxDir,
    type: `watchdog_${type}`,
    source: 'watchdog',
    priority: 'high',
    body,
    idPrefix: `${Date.now()}_${type}`,
    filenameTag: `watchdog_${type}`,
  });
}

// Cron 状态
let lastArchiveDate: string | null = null;
let lastDiskCheckHour: number = -1;
const lastInactivityNotified: Map<string, number> = new Map();
const clawPreviouslyAlive: Map<string, boolean> = new Map();
const inactivityNotifyCount: Map<string, number> = new Map();  // 连续通知计数，用于退避

// Global config (loaded lazily on first access)
let globalConfigCache: ReturnType<typeof loadGlobalConfig> | null = null;
function getGlobalConfig() {
  if (!globalConfigCache) {
    globalConfigCache = loadGlobalConfig();
  }
  return globalConfigCache;
}

// 解析 stream.jsonl，返回最后一次事件时间戳和最后一次错误信息
interface ClawActivityInfo {
  lastEventMs: number | null;  // 任意事件的最新 ts（防长 react 误判）
  lastError: string | null;    // 最后一个终止事件是 turn_error 时的错误信息
                               // 只有 turn_end 才清除
}

// Claw 健康快照（用于通知 motion 决策）
interface ClawSnapshot {
  status: 'running' | 'stopped';
  contract: string;       // 'active:<contractId>' | 'paused:<contractId>' | 'none'
  inboxPending: number;
  outboxPending: number;
}

function gatherClawSnapshot(clawDir: string, pm: ProcessManager, clawId: string): ClawSnapshot {
  const status = pm.isAlive(clawId) ? 'running' : 'stopped';

  // 找 contract（active 优先）
  let contract = 'none';
  for (const sub of ['active', 'paused']) {
    try {
      const entries = fs.readdirSync(path.join(clawDir, 'contract', sub), { withFileTypes: true });
      const dir = entries.find(e => e.isDirectory());
      if (dir) { contract = `${sub}:${dir.name}`; break; }
    } catch { /* skip */ }
  }

  // inbox/outbox pending 数量
  const countMd = (dir: string) => {
    try { return fs.readdirSync(dir).filter(f => f.endsWith('.md')).length; } catch { return 0; }
  };
  const inboxPending = countMd(path.join(clawDir, 'inbox', 'pending'));
  const outboxPending = countMd(path.join(clawDir, 'outbox', 'pending'));

  return { status, contract, inboxPending, outboxPending };
}

// 只计 LLM 直接输出事件（排除 llm_start/tool_result 等基础设施事件）
const LLM_OUTPUT_EVENTS = new Set(['thinking_delta', 'text_delta', 'tool_call']);

function getClawActivityInfo(clawDir: string): ClawActivityInfo {
  const streamFile = path.join(clawDir, 'stream.jsonl');
  try {
    const content = fs.readFileSync(streamFile, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    let lastEventMs: number | null = null;
    let lastError: string | null = null;

    for (const line of lines) {
      try {
        const event = JSON.parse(line) as { type: string; ts?: number; error?: string };
        const ts = typeof event.ts === 'number' ? event.ts : null;
        if (!ts) continue;

        // 只有 LLM 直接输出才算活跃
        if (LLM_OUTPUT_EVENTS.has(event.type) && (lastEventMs === null || ts > lastEventMs)) {
          lastEventMs = ts;
        }

        // 只追踪终止事件来判断错误状态
        if (event.type === 'turn_end') {
          lastError = null;         // 真正完成一轮，清除错误
        } else if (event.type === 'turn_error') {
          lastError = event.error ?? 'unknown error';
        }
        // turn_interrupted：不清除错误，不设置错误
      } catch { /* skip */ }
    }

    return { lastEventMs, lastError };
  } catch {
    return { lastEventMs: null, lastError: null };
  }
}

// 检查有活跃契约但长时间无进展的 claw，发送提醒
function maybeCronClawInactivity(pm: ProcessManager): void {
  const timeoutMs = getGlobalConfig().watchdog?.claw_inactivity_timeout_ms ?? 300000;
  const clawsDir = path.join(getClawforumDir(), 'claws');
  if (!fs.existsSync(clawsDir)) return;

  const now = Date.now();
  for (const clawId of fs.readdirSync(clawsDir)) {
    const clawDir = path.join(clawsDir, clawId);

    // 有活跃契约？
    if (!clawHasContract(clawDir)) continue;

    // 解析 stream.jsonl 获取真实进展
    const { lastEventMs, lastError } = getClawActivityInfo(clawDir);

    // 直接用 lastEventMs 作为参考基准（任意事件都更新）
    const referenceMs = lastEventMs;
    if (referenceMs === null) continue;

    // 未超时
    if (now - referenceMs < timeoutMs) continue;

    // 重置计数：若 claw 有新进展（lastEventMs > 上次通知时间）
    const lastNotified = lastInactivityNotified.get(clawId) ?? 0;
    if (lastEventMs !== null && lastEventMs > lastNotified) {
      inactivityNotifyCount.set(clawId, 0);
    }

    const notifyCount = inactivityNotifyCount.get(clawId) ?? 0;

    // 退避间隔：前 2 次用 timeoutMs，第 3 次起用 3x
    const effectiveInterval = notifyCount >= 2 ? timeoutMs * 3 : timeoutMs;
    if (now - lastNotified < effectiveInterval) continue;

    // 收集快照信息
    const snapshot = gatherClawSnapshot(clawDir, pm, clawId);
    const inactiveMin = Math.round((now - referenceMs) / 60000);

    // 无指令的 body：纯事实数据（含第几次通知）
    const displayCount = notifyCount + 1;
    let body = `Claw ${clawId} 无进展 ${inactiveMin}m（第 ${displayCount} 次通知）。状态：${snapshot.status}，契约：${snapshot.contract}，inbox_pending：${snapshot.inboxPending}，outbox_pending：${snapshot.outboxPending}`;
    if (lastError) body += `，最后错误：${lastError}`;

    log(`[watchdog] Claw ${clawId} no progress ${inactiveMin}m (notify #${displayCount}) with active contract${lastError ? ` (last error: ${lastError})` : ''}`);
    writeWatchdogInboxMessage('claw_inactivity', {
      message: body,
      claw_id: clawId,
      inactive_ms: now - referenceMs,
      status: snapshot.status,
      contract: snapshot.contract,
      inbox_pending: snapshot.inboxPending,
      outbox_pending: snapshot.outboxPending,
      notify_count: displayCount,
      ...(lastError ? { last_error: lastError } : {}),
    });
    inactivityNotifyCount.set(clawId, displayCount);
    lastInactivityNotified.set(clawId, now);
  }
}

// 检查 claw 是否有活跃或暂停的契约
function clawHasContract(clawDir: string): boolean {
  for (const sub of ['active', 'paused']) {
    try {
      const entries = fs.readdirSync(path.join(clawDir, 'contract', sub), { withFileTypes: true });
      if (entries.some(e => e.isDirectory())) return true;
    } catch { /* skip */ }
  }
  return false;
}

// 检测 claw 进程崩溃并通知 motion
function maybeCronClawCrash(pm: ProcessManager): void {
  const clawsDir = path.join(getClawforumDir(), 'claws');
  if (!fs.existsSync(clawsDir)) return;

  for (const clawId of fs.readdirSync(clawsDir)) {
    const clawDir = path.join(clawsDir, clawId);
    const currentlyAlive = pm.isAlive(clawId);
    const wasAlive = clawPreviouslyAlive.get(clawId);

    if (wasAlive === true && !currentlyAlive) {
      // 只在有活跃/暂停契约时通知 motion（无契约的 claw 停止无需通知）
      if (!clawHasContract(clawDir)) {
        log(`[watchdog] Claw ${clawId} stopped (no active contract, skipping notification)`);
        clawPreviouslyAlive.set(clawId, currentlyAlive);
        continue;
      }
      log(`[watchdog] Claw ${clawId} crashed (was alive, now stopped)`);

      // 收集快照信息
      const snapshot = gatherClawSnapshot(clawDir, pm, clawId);
      const body = `契约：${snapshot.contract}，outbox_pending：${snapshot.outboxPending}`;

      writeInboxMessage({
        inboxDir: path.join(getMotionDir(), 'inbox', 'pending'),
        type: 'crash_notification',
        source: clawId,
        priority: 'high',
        body,
        filenameTag: 'claw_crash',
      });
    }

    clawPreviouslyAlive.set(clawId, currentlyAlive);
  }
}

// 日志归档（每日 00:00）
function maybeCronArchive(): void {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  if (lastArchiveDate === today) return;
  if (now.getHours() !== 0 || now.getMinutes() >= 5) return;
  
  log('[watchdog] Running daily archive...');
  
  const archiveDays = getGlobalConfig().watchdog?.log_archive_days ?? 30;
  const thirtyDaysAgo = Date.now() - archiveDays * 24 * 60 * 60 * 1000;
  const archiveDir = path.join(getClawforumDir(), 'logs', 'archive');
  fs.mkdirSync(archiveDir, { recursive: true });
  
  // 扫描 motion/dialog/archive/
  const motionArchiveDir = path.join(getMotionDir(), 'dialog', 'archive');
  if (fs.existsSync(motionArchiveDir)) {
    for (const file of fs.readdirSync(motionArchiveDir)) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(motionArchiveDir, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < thirtyDaysAgo) {
        fs.renameSync(filePath, path.join(archiveDir, `motion_${file}`));
      }
    }
  }
  
  // 扫描 claws/*/dialog/archive/
  const clawsDir = path.join(getClawforumDir(), 'claws');
  if (fs.existsSync(clawsDir)) {
    for (const clawId of fs.readdirSync(clawsDir)) {
      const clawArchiveDir = path.join(clawsDir, clawId, 'dialog', 'archive');
      if (!fs.existsSync(clawArchiveDir)) continue;
      for (const file of fs.readdirSync(clawArchiveDir)) {
        if (!file.endsWith('.json')) continue;
        const filePath = path.join(clawArchiveDir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < thirtyDaysAgo) {
          fs.renameSync(filePath, path.join(archiveDir, `${clawId}_${file}`));
        }
      }
    }
  }
  
  lastArchiveDate = today;
  log('[watchdog] Daily archive complete');
}

// 磁盘检查（每小时）
function maybeCronDiskCheck(): void {
  const now = new Date();
  const currentHour = now.getHours();
  
  if (lastDiskCheckHour === currentHour) return;
  if (now.getMinutes() >= 5) return;
  
  log('[watchdog] Running hourly disk check...');
  
  // 计算 claws/*/clawspace/ 总大小
  let totalSize = 0;
  const clawsDir = path.join(getClawforumDir(), 'claws');
  if (fs.existsSync(clawsDir)) {
    for (const clawId of fs.readdirSync(clawsDir)) {
      const clawspaceDir = path.join(clawsDir, clawId, 'clawspace');
      if (!fs.existsSync(clawspaceDir)) continue;
      totalSize += getDirSize(clawspaceDir);
    }
  }
  
  const totalMB = Math.round(totalSize / 1024 / 1024);
  const limitMB = getGlobalConfig().watchdog?.disk_warning_mb ?? 500;
  
  if (totalMB > limitMB) {
    log(`[watchdog] WARNING: Disk usage ${totalMB}MB > ${limitMB}MB`);
    writeWatchdogInboxMessage('disk_warning', {
      message: `磁盘用量 ${totalMB}MB，限制 ${limitMB}MB`,
      usage_mb: totalMB,
      limit_mb: limitMB,
      timestamp: new Date().toISOString(),
    });
  } else {
    log(`[watchdog] Disk check: ${totalMB}MB / ${limitMB}MB`);
  }
  
  lastDiskCheckHour = currentHour;
}

// 递归计算目录大小
function getDirSize(dir: string): number {
  let size = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;  // 跳过 symlink 防循环
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += getDirSize(fullPath);
    } else {
      size += fs.statSync(fullPath).size;
    }
  }
  return size;
}

// Daemon 主循环
export async function daemonCommand(): Promise<void> {
  log('[watchdog] Daemon starting...');
  
  writeWatchdogPid(process.pid);
  
  let stopped = false;
  
  // 创建 Motion ProcessManager（循环外复用）
  const pm = createMotionPM();
  
  process.on('SIGTERM', () => {
    log('[watchdog] Received SIGTERM, shutting down...');
    stopped = true;
    removeWatchdogPid();
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    log('[watchdog] Received SIGINT, shutting down...');
    stopped = true;
    removeWatchdogPid();
    process.exit(0);
  });
  
  while (!stopped) {
    // 1. 检查 motion 存活
    if (!pm.isAlive('motion')) {
      log('[watchdog] motion crashed, restarting...');
      try {
        // 先清理可能存在的 stale PID 文件
        await pm.stop('motion').catch(() => {});
        const motionDir = getMotionDir();
        const pid = await pm.spawn('motion', motionDir);  // 使用默认 daemon-entry.js
        log(`[watchdog] motion restarted, PID=${pid}`);
      } catch (err) {
        log(`[watchdog] FAILED to restart motion: ${err}`);
      }
    }
    
    // 2. 简易 cron
    maybeCronArchive();
    maybeCronDiskCheck();
    maybeCronClawInactivity(pm);
    maybeCronClawCrash(pm);
    
    // 3. 休眠（间隔可配置）
    const intervalMs = getGlobalConfig().watchdog?.interval_ms ?? 30000;
    await setTimeout(intervalMs);
  }
}

// Start command
export async function startCommand(): Promise<void> {
  if (isWatchdogAlive()) {
    const pid = getWatchdogPid();
    console.log(`Watchdog is already running (PID: ${pid})`);
    console.log('   Use "watchdog stop" first if you want to restart.');
    return;
  }
  
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const bundleEntry = path.join(thisDir, 'watchdog-entry.js');
  const watchdogEntryPath = existsSync(bundleEntry)
    ? bundleEntry
    : path.resolve(thisDir, '..', '..', '..', 'dist', 'watchdog-entry.js');
  const proc = spawn('node', [watchdogEntryPath], {
    detached: true,
    stdio: 'ignore',
  });
  proc.unref();
  
  // 等待 PID 文件写入
  let attempts = 0;
  while (!isWatchdogAlive() && attempts < 10) {
    await setTimeout(100);
    attempts++;
  }
  
  const pid = getWatchdogPid();
  if (pid) {
    console.log(`Watchdog started (PID: ${pid})`);
  } else {
    console.log('Watchdog may have failed to start');
  }
}

// Stop command
export async function stopCommand(): Promise<void> {
  const pid = getWatchdogPid();
  
  if (!pid || !isWatchdogAlive()) {
    console.log('Watchdog is not running');
    removeWatchdogPid();
    return;
  }
  
  console.log(`Stopping watchdog (PID: ${pid})...`);
  
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    console.log('Failed to send SIGTERM:', err);
  }
  
  // 等待 5s
  let attempts = 0;
  while (isWatchdogAlive() && attempts < 50) {
    await setTimeout(100);
    attempts++;
  }
  
  if (isWatchdogAlive()) {
    console.log('Watchdog still alive, sending SIGKILL...');
    try {
      process.kill(pid, 'SIGKILL');
    } catch (err) {
      console.log('Failed to send SIGKILL:', err);
    }
    await setTimeout(500);
  }
  
  removeWatchdogPid();
  
  if (isWatchdogAlive()) {
    console.log('Failed to stop watchdog');
  } else {
    console.log('Watchdog stopped');
  }
}
