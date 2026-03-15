/**
 * Heartbeat - Motion 心跳检测系统
 *
 * 每 60s 扫描所有 claw，执行：
 * 1. 崩溃检测与自愈（重启 + 通知）
 * 2. Stall 检测（长时间无响应的 claw）
 * 3. Outbox 监控（待处理消息通知）
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsNative from 'fs';
import { randomUUID } from 'crypto';
import { ProcessManager } from '../foundation/process/manager.js';

export interface HeartbeatOptions {
  /** 心跳间隔（秒），默认 60 */
  interval?: number;
  /** Stall 阈值（秒），默认 300（5分钟） */
  stallThreshold?: number;
  /** Outbox 通知冷却时间（秒），默认 300（5分钟） */
  outboxCooldown?: number;
}

export interface InboxMessage {
  id: string;
  type: 'crash_recovery' | 'stall_nudge' | 'outbox_notify';
  source: 'heartbeat';
  priority: 'critical' | 'high' | 'normal' | 'low';
  timestamp: string;
  content: string;
  clawId?: string;
}

/**
 * Motion 心跳检测系统
 */
export class Heartbeat {
  private baseDir: string;
  private pm: ProcessManager;
  private interval: number;
  private stallThreshold: number;
  private outboxCooldown: number;
  private lastRun: number;
  private outboxLastNotify: Map<string, number> = new Map();

  constructor(baseDir: string, pm: ProcessManager, options: HeartbeatOptions = {}) {
    this.baseDir = baseDir;
    this.pm = pm;
    this.interval = (options.interval ?? 60) * 1000;
    this.stallThreshold = (options.stallThreshold ?? 300) * 1000;
    this.outboxCooldown = (options.outboxCooldown ?? 300) * 1000;
    this.lastRun = 0;
  }

  /**
   * 检查是否应该执行心跳
   * 使用 monotonic 时间检查
   */
  isDue(): boolean {
    const now = Date.now();
    return now - this.lastRun >= this.interval;
  }

  /**
   * 执行完整的心跳检查
   * @returns 处理结果摘要
   */
  checkAll(): string[] {
    this.lastRun = Date.now();
    const results: string[] = [];

    try {
      const clawsDir = path.join(this.baseDir, 'claws');
      if (!fsNative.existsSync(clawsDir)) {
        return results;
      }

      const entries = fsNative.readdirSync(clawsDir);

      for (const entry of entries) {
        // 跳过 motion 自身和非目录项
        if (entry === 'motion') continue;
        
        const clawPath = path.join(clawsDir, entry);
        const stat = fsNative.statSync(clawPath);
        if (!stat.isDirectory()) continue;

        const clawId = entry;
        const isAlive = this.pm.isAlive(clawId);

        if (!isAlive) {
          // 崩溃检测与自愈
          const handled = this._handleCrash(clawId);
          if (handled) {
            results.push(`crash_recovery:${clawId}`);
          }
        } else {
          // Stall 检测
          const stalled = this._checkStall(clawId);
          if (stalled) {
            results.push(`stall_nudge:${clawId}`);
          }
        }

        // Outbox 监控（无论是否存活都检查）
        const notified = this._checkOutbox(clawId);
        if (notified) {
          results.push(`outbox_notify:${clawId}`);
        }
      }
    } catch (error) {
      // 心跳失败不应中断 Motion，记录即可
      console.error('[Heartbeat] checkAll failed:', error);
    }

    return results;
  }

  /**
   * 处理崩溃 claw：重启并通知 Motion
   */
  private _handleCrash(clawId: string): boolean {
    try {
      const clawDir = path.join(this.baseDir, 'claws', clawId);
      
      // 检查是否有活跃契约（MVP 对齐：无契约目录 = 无活跃契约）
      let hasActiveContract = false;
      try {
        const contractDir = path.join(clawDir, 'contract');
        if (fsNative.existsSync(contractDir)) {
          const entries = fsNative.readdirSync(contractDir);
          hasActiveContract = entries.some(e => e.endsWith('.json'));
        }
      } catch {
        // 读不到契约目录，视为无活跃契约
        hasActiveContract = false;
      }

      // MVP 对齐：无活跃契约时不自动重启（保守策略）
      if (!hasActiveContract) {
        this._writeInbox('motion', {
          id: `hb-${Date.now()}-${clawId}`,
          type: 'crash_recovery',
          source: 'heartbeat',
          priority: 'normal',
          timestamp: new Date().toISOString(),
          content: `Claw "${clawId}" 进程已停止（无活跃契约，未自动重启）`,
          clawId,
        });
        return true; // 已处理（通知）
      }

      // 有活跃契约，尝试重启
      try {
        this.pm.restart(clawId, clawDir);
        
        // 重启成功，写 Motion inbox
        this._writeInbox('motion', {
          id: `hb-${Date.now()}-${clawId}`,
          type: 'crash_recovery',
          source: 'heartbeat',
          priority: 'high',
          timestamp: new Date().toISOString(),
          content: `Claw "${clawId}" crashed and was automatically restarted. Active contract detected.`,
          clawId,
        });
        return true;
      } catch (restartError) {
        // 重启失败，critical 通知
        this._writeInbox('motion', {
          id: `hb-${Date.now()}-${clawId}`,
          type: 'crash_recovery',
          source: 'heartbeat',
          priority: 'critical',
          timestamp: new Date().toISOString(),
          content: `Claw "${clawId}" crashed and restart failed: ${restartError instanceof Error ? restartError.message : String(restartError)}`,
          clawId,
        });
        return false;
      }
    } catch (error) {
      console.error(`[Heartbeat] _handleCrash(${clawId}) failed:`, error);
      return false;
    }
  }

  /**
   * 检查 claw 是否 stall（长时间无更新）
   */
  private _checkStall(clawId: string): boolean {
    try {
      const statusFile = path.join(this.baseDir, 'claws', clawId, 'status', 'STATUS.md');
      
      if (!fsNative.existsSync(statusFile)) {
        return false;
      }

      const content = fsNative.readFileSync(statusFile, 'utf-8');
      
      // 解析 updated_at
      const match = content.match(/updated_at:\s*(.+)/);
      if (!match) {
        return false;
      }

      const updatedAt = new Date(match[1].trim()).getTime();
      const now = Date.now();
      const age = now - updatedAt;

      if (age > this.stallThreshold) {
        // 发送催促消息
        const minutes = Math.floor(age / 60000);
        this._writeInbox(clawId, {
          id: `hb-${Date.now()}-${clawId}`,
          type: 'stall_nudge',
          source: 'heartbeat',
          priority: 'normal',
          timestamp: new Date().toISOString(),
          content: `[Motion] No status update for ${minutes} minutes. Please report current progress.`,
          clawId,
        });
        return true;
      }

      return false;
    } catch (error) {
      // 读取失败不视为 stall
      return false;
    }
  }

  /**
   * 检查 claw outbox 是否有待处理消息
   */
  private _checkOutbox(clawId: string): boolean {
    try {
      const outboxDir = path.join(this.baseDir, 'claws', clawId, 'outbox', 'pending');
      
      if (!fsNative.existsSync(outboxDir)) {
        return false;
      }

      const entries = fsNative.readdirSync(outboxDir);
      const hasMessages = entries.length > 0;

      if (!hasMessages) {
        return false;
      }

      // 检查冷却时间
      const now = Date.now();
      const lastNotify = this.outboxLastNotify.get(clawId) ?? 0;
      
      if (now - lastNotify < this.outboxCooldown) {
        return false; // 还在冷却期内
      }

      // 更新通知时间
      this.outboxLastNotify.set(clawId, now);

      // 通知 Motion
      this._writeInbox('motion', {
        id: `hb-${Date.now()}-${clawId}`,
        type: 'outbox_notify',
        source: 'heartbeat',
        priority: 'normal',
        timestamp: new Date().toISOString(),
        content: `Claw "${clawId}" has ${entries.length} pending message(s) in outbox.`,
        clawId,
      });

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 写入 inbox 消息
   */
  private _writeInbox(targetId: string, message: InboxMessage): void {
    try {
      // 确定 inbox 路径
      let inboxDir: string;
      if (targetId === 'motion') {
        inboxDir = path.join(this.baseDir, 'motion', 'inbox', 'pending');
      } else {
        inboxDir = path.join(this.baseDir, 'claws', targetId, 'inbox', 'pending');
      }

      // 确保目录存在
      fsNative.mkdirSync(inboxDir, { recursive: true });

      // 生成文件名: {YYYYMMDDTHHMMSS}_heartbeat_{uuid8}.md
      const now = new Date();
      const timestamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15);
      const uuid8 = randomUUID().slice(0, 8);
      const filename = `${timestamp}_heartbeat_${uuid8}.md`;
      const filepath = path.join(inboxDir, filename);

      // 构建内容（YAML frontmatter + body）
      const content = `---
id: ${message.id}
type: ${message.type}
source: ${message.source}
priority: ${message.priority}
timestamp: ${message.timestamp}
${message.clawId ? `claw_id: ${message.clawId}` : ''}
---

${message.content}
`;

      fsNative.writeFileSync(filepath, content);
    } catch (error) {
      console.error(`[Heartbeat] _writeInbox failed:`, error);
    }
  }
}
