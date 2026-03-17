/**
 * Watchdog 守护进程
 * 每 30s 检查 motion 存活，内置简易 cron
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';
import { getMotionDir } from '../config.js';
import { ProcessManager } from '../../foundation/process/manager.js';
import { NodeFileSystem } from '../../foundation/fs/node-fs.js';
import { randomUUID } from 'node:crypto';

// PID 文件路径
function getWatchdogPidFile(): string {
  return path.join(process.cwd(), '.clawforum', 'watchdog.pid');
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
  
  const logDir = path.join(process.cwd(), '.clawforum', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(path.join(logDir, 'watchdog.log'), logLine, 'utf-8');
}

// 写入 inbox 消息（YAML frontmatter .md 格式）
function writeInboxMessage(type: string, content: Record<string, unknown>): void {
  const inboxDir = path.join(getMotionDir(), 'inbox', 'pending');
  fs.mkdirSync(inboxDir, { recursive: true });
  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, '').slice(0, 15);
  const uuid8 = randomUUID().slice(0, 8);
  const filename = `${ts}_watchdog_${type}_${uuid8}.md`;
  
  // YAML frontmatter 格式
  const body = content.message ?? JSON.stringify(content);
  const yamlContent = `---
id: ${now.getTime()}_${type}
type: watchdog_${type}
source: watchdog
priority: high
timestamp: ${now.toISOString()}
---

${body}
`;
  fs.writeFileSync(path.join(inboxDir, filename), yamlContent, 'utf-8');
}

// Cron 状态
let lastArchiveDate: string | null = null;
let lastDiskCheckHour: number = -1;

// 日志归档（每日 00:00）
function maybeCronArchive(): void {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  
  if (lastArchiveDate === today) return;
  if (now.getHours() !== 0 || now.getMinutes() >= 5) return;
  
  log('[watchdog] Running daily archive...');
  
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const archiveDir = path.join(process.cwd(), '.clawforum', 'logs', 'archive');
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
  const clawsDir = path.join(process.cwd(), '.clawforum', 'claws');
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
  const clawsDir = path.join(process.cwd(), '.clawforum', 'claws');
  if (fs.existsSync(clawsDir)) {
    for (const clawId of fs.readdirSync(clawsDir)) {
      const clawspaceDir = path.join(clawsDir, clawId, 'clawspace');
      if (!fs.existsSync(clawspaceDir)) continue;
      totalSize += getDirSize(clawspaceDir);
    }
  }
  
  const totalMB = Math.round(totalSize / 1024 / 1024);
  const limitMB = 500;
  
  if (totalMB > limitMB) {
    log(`[watchdog] WARNING: Disk usage ${totalMB}MB > ${limitMB}MB`);
    writeInboxMessage('disk_warning', {
      message: `Clawspace disk usage exceeded limit`,
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
        const cliPath = path.resolve(process.cwd(), 'dist', 'cli.js');
        const motionDir = getMotionDir();
        const pid = await pm.spawn('motion', motionDir, [cliPath, 'motion', 'daemon']);
        log(`[watchdog] motion restarted, PID=${pid}`);
      } catch (err) {
        log(`[watchdog] FAILED to restart motion: ${err}`);
      }
    }
    
    // 2. 简易 cron
    maybeCronArchive();
    maybeCronDiskCheck();
    
    // 3. 休眠 30s
    await setTimeout(30000);
  }
}

// Start command
export async function startCommand(): Promise<void> {
  if (isWatchdogAlive()) {
    const pid = getWatchdogPid();
    console.log(`⚠️  Watchdog is already running (PID: ${pid})`);
    console.log('   Use "watchdog stop" first if you want to restart.');
    return;
  }
  
  const cliPath = path.resolve(process.cwd(), 'dist', 'cli.js');
  const proc = spawn('node', [cliPath, 'watchdog', 'daemon'], {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
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
    console.log(`✅ Watchdog started (PID: ${pid})`);
  } else {
    console.log('⚠️  Watchdog may have failed to start');
  }
}

// Stop command
export async function stopCommand(): Promise<void> {
  const pid = getWatchdogPid();
  
  if (!pid || !isWatchdogAlive()) {
    console.log('ℹ️  Watchdog is not running');
    removeWatchdogPid();
    return;
  }
  
  console.log(`Stopping watchdog (PID: ${pid})...`);
  
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    console.log('⚠️  Failed to send SIGTERM:', err);
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
      console.log('⚠️  Failed to send SIGKILL:', err);
    }
    await setTimeout(500);
  }
  
  removeWatchdogPid();
  
  if (isWatchdogAlive()) {
    console.log('❌ Failed to stop watchdog');
  } else {
    console.log('✅ Watchdog stopped');
  }
}
