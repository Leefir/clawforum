/**
 * Heartbeat - Motion 心跳触发器
 *
 * 每 300s（5分钟）触发一次，向 motion inbox 写入 heartbeat 消息
 */

import * as path from 'path';
import * as fsNative from 'fs';
import { randomUUID } from 'crypto';

export interface HeartbeatOptions {
  /** 心跳间隔（秒），默认 300（5分钟） */
  interval?: number;
}

/**
 * Motion 心跳触发器
 */
export class Heartbeat {
  private baseDir: string;
  private interval: number;
  private lastRun: number;

  constructor(baseDir: string, options: HeartbeatOptions = {}) {
    this.baseDir = baseDir;
    this.interval = (options.interval ?? 300) * 1000;
    this.lastRun = 0;
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
    this.lastRun = Date.now();

    try {
      const inboxDir = path.join(this.baseDir, 'motion', 'inbox', 'pending');
      fsNative.mkdirSync(inboxDir, { recursive: true });

      const now = new Date();
      const ts = now.toISOString().replace(/[-:]/g, '').slice(0, 15);
      const uuid8 = randomUUID().slice(0, 8);
      const filename = `${ts}_heartbeat_${uuid8}.md`;

      const content = `---
id: hb-${now.getTime()}
type: heartbeat
source: system
priority: low
timestamp: ${now.toISOString()}
---

[system message] 心跳触发，请巡查。
`;
      fsNative.writeFileSync(path.join(inboxDir, filename), content);
    } catch (error) {
      process.stderr.write(`[Heartbeat] fire failed: ${error}\n`);
    }
  }
}
