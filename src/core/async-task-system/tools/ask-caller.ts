/**
 * ask_caller tool - Subagent asks parent claw about its context at spawn time
 *
 * Uses DialogStore.restorePrefix(marker) to reconstruct main context and
 * queries a LLM clone for clarification.
 */

import type { Tool, ExecContext } from '../../../foundation/tools/index.js';
import type { ToolResult } from '../../../foundation/tool-protocol/index.js';
import { MarkerNotFoundError } from '../../../foundation/dialog-store/index.js';
import type { DialogStore } from '../../../foundation/dialog-store/index.js';

export const ASK_CALLER_TOOL_NAME = 'ask_caller' as const;

export function createAskCallerTool(deps: {
  mainDialogStore?: DialogStore;
  mainContextSnapshot?: { clawId: string; toolUseId: string };
}): Tool {
  const { mainDialogStore, mainContextSnapshot } = deps;

  return {
    name: ASK_CALLER_TOOL_NAME,
    profiles: ['subagent'],
    description: 'Ask the parent claw a question about its context at the time of spawn. Useful when you need clarification on intent or context that was not captured in the spawn intent.',
    schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to ask the parent claw' },
      },
      required: ['question'],
    },
    readonly: true,
    idempotent: false,

    async execute(args: Record<string, unknown>, _ctx: ExecContext): Promise<ToolResult> {
      const question = String(args.question ?? '');
      if (!question) {
        return { success: false, content: 'ask_caller: question is required', error: 'missing question' };
      }
      if (!mainDialogStore || !mainContextSnapshot) {
        return {
          success: false,
          content: 'ask_caller unavailable: parent context not available (this tool requires subagent profile + main context capture)',
          error: 'no main context',
        };
      }
      try {
        const restored = await mainDialogStore.restorePrefix(mainContextSnapshot);
        // LATENT (phase 812 latent advertise ratify + r129 C fork phase 1182):
        // LLM clone call wrapper 未实施 / 不返字面 TODO 给子代理 (DP「不丢弃静默」)
        // sunset triggers (详 design/modules/l4_async_task_system.md §A.phase1182-ask-caller-latent-marker):
        //   (a) spawn subagent 真依赖 ask_caller 完成任务 N≥1 production case → 立即填实
        //   (b) §10.2 ask_caller workflow finalize + LLM clone call wrapper impl 立项
        //   (c) 假信息影响 spawn 真案例 N≥1 → 紧急治
        //   (d) `feedback_design_claim_requires_empirical_evidence` Tier 1 evidence 失效 → 重 ratify
        // 防止假信息: 改返 success:false (subagent 收到 LATENT error 应 graceful 处理 / 不被假答案误导)
        void restored; // 保留 restorePrefix 调用 (LLM cache 命中关键)
        return {
          success: false,
          content: 'ask_caller is currently LATENT (placeholder not implemented). See design/behavior.md + design/modules/l4_async_task_system.md §A.phase1182-ask-caller-latent-marker for sunset triggers.',
          error: 'latent_not_implemented',
        };
      } catch (err) {
        if (err instanceof MarkerNotFoundError) {
          return {
            success: false,
            content: `ask_caller: marker not found (toolUseId=${mainContextSnapshot.toolUseId})`,
            error: 'marker not found',
          };
        }
        throw err;
      }
    },
  };
}
