import * as fs from 'fs';
import * as path from 'path';
import { writeInboxMessage } from '../../../utils/inbox-writer.js';

/** 递归计算目录大小（bytes） */
function getDirSize(dir: string): number {
  let size = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += getDirSize(fullPath);
    } else {
      try { size += fs.statSync(fullPath).size; } catch { /* skip */ }
    }
  }
  return size;
}

export interface DiskMonitorOptions {
  clawforumDir: string;   // .clawforum/ 根目录
  motionInboxDir: string; // motion/inbox/pending/
  limitMB: number;        // 告警阈值
}

export async function runDiskMonitor(opts: DiskMonitorOptions): Promise<void> {
  const clawsDir = path.join(opts.clawforumDir, 'claws');
  if (!fs.existsSync(clawsDir)) return;

  let totalSize = 0;
  for (const clawId of fs.readdirSync(clawsDir)) {
    const clawspaceDir = path.join(clawsDir, clawId, 'clawspace');
    if (fs.existsSync(clawspaceDir)) {
      totalSize += getDirSize(clawspaceDir);
    }
  }

  const totalMB = Math.round(totalSize / 1024 / 1024);
  console.log(`[cron:disk-monitor] ${totalMB}MB / ${opts.limitMB}MB`);

  if (totalMB > opts.limitMB) {
    console.warn(`[cron:disk-monitor] WARNING: usage ${totalMB}MB > limit ${opts.limitMB}MB`);
    writeInboxMessage({
      inboxDir: opts.motionInboxDir,
      type: 'cron_disk_warning',
      source: 'cron',
      priority: 'high',
      body: `Disk usage ${totalMB}MB, limit ${opts.limitMB}MB`,
      idPrefix: `${Date.now()}_disk_warning`,
      filenameTag: 'disk_warning',
    });
  }
}
