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
   * Motion 专用：批量处理 inbox + drain 所有 claw outbox
   * @override
   */
  override async processBatch(): Promise<number> {
    if (!this.initialized) await this.initialize();

    const clawMessages = await this._drainClawOutboxes();
    const { injected: ownInbox, count: inboxCount } = await this._drainOwnInbox();

    if (clawMessages.length === 0 && inboxCount === 0) return 0;

    const session = await this.sessionManager.load();
    const messages: Message[] = [...session.messages];

    // claw outbox 消息先注入（时间顺序）
    for (const { clawId, body } of clawMessages) {
      messages.push({ role: 'user', content: `[来自 claw ${clawId}]\n${body}` });
    }
    // 自身 inbox（heartbeat 通知等）后注入
    messages.push(...ownInbox);

    await this._runReact(messages);
    return clawMessages.length + inboxCount;
  }

  /**
   * 读取并 drain 所有 claw outbox/pending/*.md
   * 返回 [{ clawId, body }]，失败文件移到 failed/
   */
  private async _drainClawOutboxes(): Promise<Array<{ clawId: string; body: string }>> {
    const result: Array<{ clawId: string; body: string }> = [];
    const clawsDir = path.join(path.dirname(this.options.clawDir), 'claws');

    let clawIds: string[] = [];
    try {
      clawIds = await fs.readdir(clawsDir);
    } catch {
      return result;
    }

    for (const clawId of clawIds) {
      if (clawId === 'motion') continue;
      const clawPath = path.join(clawsDir, clawId);
      
      // 跳过非目录项
      try {
        const stat = await fs.stat(clawPath);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }

      const pendingDir = path.join(clawPath, 'outbox', 'pending');
      const doneDir = path.join(clawPath, 'outbox', 'done');
      const failedDir = path.join(clawPath, 'outbox', 'failed');

      // 读取待处理消息
      let files: string[] = [];
      try {
        files = await fs.readdir(pendingDir);
        files = files.filter(f => f.endsWith('.md'));
      } catch {
        continue; // outbox/pending 不存在或无法读取
      }

      if (files.length === 0) continue;

      // 按文件名排序（时间顺序）
      files.sort();

      for (const name of files) {
        const filePath = path.join(pendingDir, name);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          // outbox 文件无 frontmatter，body = 全文
          result.push({ clawId, body: content });

          // 移入 done/
          try {
            await fs.mkdir(doneDir, { recursive: true });
            await fs.rename(filePath, path.join(doneDir, `${Date.now()}_${name}`));
          } catch {
            // 移动失败不阻止处理
          }
        } catch {
          // 读失败，移入 failed/
          try {
            await fs.mkdir(failedDir, { recursive: true });
            await fs.rename(filePath, path.join(failedDir, `${Date.now()}_${name}`));
          } catch {
            // 移动失败忽略
          }
        }
      }
    }

    return result;
  }
}
