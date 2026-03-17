/**
 * MotionRuntime - 管理者运行时
 * 
 * Motion 是 Clawforum 的管理者，通过 exec 调用 CLI 管理其他 Claw。
 * 系统提示注入顺序与 Claw 不同：
 * AGENTS.md → SOUL.md → REVIEW.md → MEMORY.md → skills → contract
 */

import * as path from 'path';
import { promises as fs } from 'fs';
import { ClawRuntime, type ClawRuntimeOptions } from '../runtime.js';
import type { Message } from '../../types/message.js';

/**
 * MotionRuntime 选项（继承 ClawRuntimeOptions）
 */
export interface MotionRuntimeOptions extends ClawRuntimeOptions {}

/**
 * MotionRuntime - 管理者运行时
 * 
 * 特点：
 * - 系统提示注入顺序包含 SOUL.md 和 REVIEW.md
 * - 使用与其他 Claw 相同的工具集（exec 是核心）
 * - 无专属工具，通过 exec 调用 CLI 管理其他 Claw
 */
export class MotionRuntime extends ClawRuntime {
  constructor(options: MotionRuntimeOptions) {
    super(options);
  }

  /**
   * 构建系统提示词
   * 注入顺序：AGENTS.md → SOUL.md → REVIEW.md → MEMORY.md → skills → contract
   */
  protected override async buildSystemPrompt(): Promise<string> {
    const parts = await this.contextInjector.buildParts();
    const sections: string[] = [];

    // 1. AGENTS.md（基础角色定义）
    if (parts.agents) {
      sections.push(parts.agents);
    }

    // 2. SOUL.md（行为原则）
    try {
      const soul = (await this.systemFs.read('SOUL.md')).trim();
      if (soul) {
        sections.push(soul);
      }
    } catch {
      // SOUL.md 不存在，跳过
    }

    // 3. REVIEW.md（复盘指引）
    try {
      const review = (await this.systemFs.read('REVIEW.md')).trim();
      if (review) {
        sections.push(review);
      }
    } catch {
      // REVIEW.md 不存在，跳过
    }

    // 3.5 HEARTBEAT.md（心跳任务指引）
    try {
      const heartbeat = (await this.systemFs.read('HEARTBEAT.md')).trim();
      if (heartbeat) {
        sections.push(heartbeat);
      }
    } catch {
      // HEARTBEAT.md 不存在，跳过
    }

    // 4. MEMORY.md（持久记忆）
    if (parts.memory) {
      sections.push(parts.memory);
    }

    // 5. skills（技能元数据）
    if (parts.skills) {
      sections.push(parts.skills);
    }

    // 6. contract（活跃契约）
    if (parts.contract) {
      sections.push(parts.contract);
    }

    // 7. AUTH_POLICY.md（授权策略，如存在）
    try {
      const authPolicy = (await this.systemFs.read('AUTH_POLICY.md')).trim();
      if (authPolicy) {
        sections.push(authPolicy);
      }
    } catch {
      // AUTH_POLICY.md 不存在，跳过
    }

    return sections.join('\n\n');
  }

  /**
   * Motion 专用：批量处理 inbox + 统计 claw outbox 未读数
   * @override
   */
  override async processBatch(): Promise<number> {
    if (!this.initialized) await this.initialize();

    const outboxCounts = await this._countClawOutboxes();
    const { injected: ownInbox, count: inboxCount } = await this._drainOwnInbox();

    // 有未读 claw outbox 时，注入一条提示消息
    if (outboxCounts.size > 0) {
      const parts: string[] = [];
      for (const [clawId, count] of outboxCounts) {
        parts.push(`${clawId}(${count})`);
      }
      ownInbox.unshift({
        role: 'user',
        content: `[system message] 未处理 claw outbox: ${parts.join(', ')}`,
      });
    }

    if (ownInbox.length === 0) return 0;

    const session = await this.sessionManager.load();
    const messages: Message[] = [...session.messages];
    messages.push(...ownInbox);

    await this._runReact(messages);
    return ownInbox.length;
  }

  /**
   * 统计所有 claw outbox/pending 未读数量
   * 不读取内容、不移动文件——motion 通过 `exec: claw outbox <id>` 主动消费
   */
  private async _countClawOutboxes(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const clawsDir = path.join(path.dirname(this.options.clawDir), 'claws');

    let clawIds: string[] = [];
    try {
      clawIds = await fs.readdir(clawsDir);
    } catch {
      return counts;
    }

    for (const clawId of clawIds) {
      if (clawId === 'motion') continue;
      const clawPath = path.join(clawsDir, clawId);

      try {
        const stat = await fs.stat(clawPath);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }

      const pendingDir = path.join(clawPath, 'outbox', 'pending');
      try {
        const files = await fs.readdir(pendingDir);
        const mdFiles = files.filter(f => f.endsWith('.md'));
        if (mdFiles.length > 0) {
          counts.set(clawId, mdFiles.length);
        }
      } catch {
        continue;
      }
    }

    return counts;
  }
}
