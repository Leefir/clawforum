/**
 * Heartbeat - Motion 心跳触发器
 *
 * 间隔可配置（heartbeat_interval_ms），默认禁用（0）。开启后向 motion inbox 写入 heartbeat 消息
 */

import * as path from 'path';
import * as fsNative from 'fs';
import { writeInboxMessage } from '../utils/inbox-writer.js';
import type { Logger } from '../foundation/monitor/types.js';

export interface HeartbeatOptions {
  /** 心跳间隔（秒），默认 300（5分钟） */
  interval?: number;
  monitor?: Logger;
}

/**
 * Motion 心跳触发器
 */
export class Heartbeat {
  private baseDir: string;
  private interval: number;
  private lastRun: number;
  private monitor?: Logger;

  constructor(baseDir: string, options: HeartbeatOptions = {}) {
    this.baseDir = baseDir;
    this.interval = (options.interval ?? 300) * 1000;
    this.lastRun = Date.now();  // 启动后等满一个 interval 再首次触发
    this.monitor = options.monitor;
  }

  /**
   * 检查是否应该执行心跳
   */
  isDue(): boolean {
    const now = Date.now();
    return now - this.lastRun >= this.interval;
  }

  /**
   * 触发心跳：向 motion inbox 写入 heartbeat 消息
   */
  fire(): void {
    try {
      const inboxDir = path.join(this.baseDir, 'motion', 'inbox', 'pending');
      fsNative.mkdirSync(inboxDir, { recursive: true });

      // 去重：已有未处理心跳则跳过
      const existing = fsNative.readdirSync(inboxDir);
      if (existing.some(f => f.includes('_heartbeat_'))) {
        this.lastRun = Date.now();  // 去重也重置计时器，避免重复检查
        return;
      }

      writeInboxMessage({
        inboxDir,
        type: 'heartbeat',
        source: 'system',
        priority: 'low',
        body: '心跳触发，请巡查。',
        idPrefix: 'hb',
      });
      this.lastRun = Date.now();  // 只在成功写入后更新
    } catch (error) {
      // lastRun 未更新 → 下次 isDue() 立即可重试
      if (this.monitor) {
        this.monitor.log('error', { context: 'Heartbeat.fire', error: String(error) });
      } else {
        console.warn('[Heartbeat] fire failed:', String(error));
      }
    }
  }
}
