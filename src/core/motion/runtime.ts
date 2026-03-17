/**
 * MotionRuntime - 管理者运行时
 * 
 * Motion 是 Clawforum 的管理者，通过 exec 调用 CLI 管理其他 Claw。
 * 系统提示注入顺序与 Claw 不同：
 * AGENTS.md → SOUL.md → REVIEW.md → MEMORY.md → skills → contract
 */

import { ClawRuntime, type ClawRuntimeOptions, type StreamCallbacks } from '../runtime.js';
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
   * Motion 专用：批量处理 inbox
   * @override
   */
  override async processBatch(callbacks?: StreamCallbacks): Promise<number> {
    if (!this.initialized) await this.initialize();

    const { injected: ownInbox, count: inboxCount, pendingFiles } = await this._drainOwnInbox();
    if (ownInbox.length === 0) return 0;

    // 通知 daemon-loop 注入了哪些消息
    if (callbacks?.onInboxDrained) {
      const sources = ownInbox.map(m => {
        const text = typeof m.content === 'string' ? m.content : '';
        return text.replace(/\r?\n/g, ' ').slice(0, 80);
      });
      callbacks.onInboxDrained(sources);
    }

    const session = await this.sessionManager.load();
    const messages: Message[] = [...session.messages, ...ownInbox];
    await this._runReact(messages, callbacks);
    await this._commitInbox(pendingFiles);  // react 成功后才移
    return ownInbox.length;
  }
}
