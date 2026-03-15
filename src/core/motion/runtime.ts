/**
 * MotionRuntime - 管理者运行时
 * 
 * Motion 是 Clawforum 的管理者，通过 exec 调用 CLI 管理其他 Claw。
 * 系统提示注入顺序与 Claw 不同：
 * AGENTS.md → SOUL.md → REVIEW.md → MEMORY.md → skills → contract
 */

import { ClawRuntime, type ClawRuntimeOptions } from '../runtime.js';

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

    return sections.join('\n\n');
  }
}
