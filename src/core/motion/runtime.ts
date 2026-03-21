/**
 * MotionRuntime - manager runtime
 *
 * Motion is the manager of Clawforum. It manages other Claws via CLI calls through exec.
 * The system prompt injection order differs from regular Claws:
 * AGENTS.md → SOUL.md → REVIEW.md → MEMORY.md → skills → contract
 *
 * Note: HEARTBEAT.md is not included in the system prompt; it is injected only via inbox message when a heartbeat fires.
 */

import { ClawRuntime, type ClawRuntimeOptions } from '../runtime.js';

/**
 * MotionRuntime options (extends ClawRuntimeOptions)
 */
export interface MotionRuntimeOptions extends ClawRuntimeOptions {}

/**
 * MotionRuntime - manager runtime
 *
 * Characteristics:
 * - System prompt injection order includes SOUL.md and REVIEW.md
 * - Uses the same toolset as other Claws (exec is the core tool)
 * - No dedicated tools; manages other Claws via CLI through exec
 */
export class MotionRuntime extends ClawRuntime {
  constructor(options: MotionRuntimeOptions) {
    super(options);
  }

  /**
   * 构建系统提示词
   * 注入顺序：AGENTS.md → SOUL.md → REVIEW.md → MEMORY.md → skills → contract
   * 
   * 注：HEARTBEAT.md 只在心跳触发时通过 inbox 消息注入，不在 system prompt 中
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

}
