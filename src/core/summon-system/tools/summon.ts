import type { Tool, ExecContext } from '../../../foundation/tools/index.js';
import type { ToolResult } from '../../../foundation/tool-protocol/index.js';

import type { Message, ToolDefinition } from '../../../foundation/llm-provider/types.js';
import { createSkillSystem } from '../../../foundation/skill-system/index.js';
import { DISPATCH_SKILLS_PATH as DISPATCH_SKILLS_DIR } from '../../evolution-system/index.js';
import type { ToolRegistry } from '../../../foundation/tools/index.js';
import { DEFAULT_LLM_IDLE_TIMEOUT_MS } from '../../../foundation/llm-orchestrator/index.js';
import { buildDescribingUserMessage, buildMinerSystemPrompt, buildMiningUserMessage } from '../../../prompts/index.js';
import { ASK_MOTION_TOOL_NAME, ASK_MOTION_TOOL_DESCRIPTION, ASK_MOTION_TOOL_SCHEMA } from './ask-motion.js';
import { writePendingSubagentTaskFile } from '../../async-task-system/index.js';
import { SUMMON_AUDIT_EVENTS } from '../audit-events.js';

const SUMMON_SUBAGENT_TIMEOUT_MS = 3600 * 1000;   // 1 hour

/**
 * Strip trailing incomplete assistant message so subagent LLM doesn't see unpaired tool_uses.
 * phase 1123 NEW (R1 形态、duplicate from shadow-system/tools/shadow.ts:22-31、N=2 duplicate 已 design row §7.B B.phase1123-strip-incomplete-tool-use-duplicate-N2 登记、N≥3 callsite 浮出时迁 foundation/llm-provider/_helpers.ts 单一源).
 */
function stripIncompleteToolUse(msgs: Message[] | undefined): Message[] | undefined {
  if (!msgs || msgs.length === 0) return msgs;
  const last = msgs[msgs.length - 1];
  if (last.role === 'assistant' && Array.isArray(last.content)) {
    if (last.content.some((block: unknown) => (block as { type?: string })?.type === 'tool_use')) {
      return msgs.slice(0, -1);
    }
  }
  return msgs;
}

export const SUMMON_TOOL_NAME = 'summon' as const;

export class SummonTool implements Tool {
  readonly name = SUMMON_TOOL_NAME;
  readonly description = `召唤子代理，创建契约。支持两种模式：

**mining（默认）**：创建意图挖掘子代理，通过与 Motion 分身多轮问答澄清用户意图，再由子代理完成契约创建。适合意图模糊或需确认优先级、目标 claw 的场景。

**shadow**：直接创建子代理完成契约创建，子代理继承 Motion 的完整上下文。适合意图明确、无需额外澄清的场景。

两种模式均不能：
- 调用 spawn 工具（会报错）
- 递归调用 summon 工具

优先用 summon 的场景：
- 任务需要给 claw 创建契约
- 任务可能匹配已有 dispatch-skills

已知确切 prompt 的一次性任务，Motion 直接用 spawn 即可。`;

  readonly readonly = false;
  readonly idempotent = false;
  readonly profiles = ['full'] as const;

  constructor(
    private getSystemPrompt: () => Promise<string>,  // buildSystemPrompt() 是 async
    private getToolsForLLM: () => ToolDefinition[], // Motion 完整工具列表（KV cache 关键）
    private getToolsForProfile: (profile: string) => ToolDefinition[], // 按 profile 获取工具列表
    private getCurrentMessages?: () => Message[] | undefined,  // current turn dialogMessages (L4 → factory injection)
  ) {}

  schema = {
    type: 'object',
    properties: {
      goal:     { type: 'string', description: '本次目标：用户这次想完成什么（Motion 对用户意图的目标描述，不含 claw 名称）' },
      maxSteps: { type: 'number', description: '子代理最大步数（默认继承主循环 max_steps）' },
      idleTimeoutMs: {
        type: 'number',
        description: 'LLM 静默超时阈值（ms）。超过此时间无 LLM 输出则终止子代理。默认 60000ms。',
      },
      targetClaw: {
        type: 'string',
        description: '目标 claw id（kebab-case）。仅当用户明确指定了目标 claw 时填写，否则省略——claw 选择由子代理决定。若用户要求新建特定名称的 claw，请先创建再调用 summon。',
      },
      mode: {
        type: 'string',
        enum: ['shadow', 'mining'],
        description: "调度模式。'mining'（默认）：先挖掘用户意图再创建契约；'shadow'：直接进入契约创建流程。",
      },
    },
    required: ['goal'],
  };

  async execute(args: Record<string, unknown>, ctx: ExecContext): Promise<ToolResult> {
    // shadow 防御（phase 767）：summon 是 async-only routing，shadow 内调用会导致 orphan
    if (ctx.isShadow) {
      return {
        success: false,
        content: 'summon is not callable from within shadow (async-only routing would orphan after shadow exits).',
        error: 'shadow_summon_rejected',
      };
    }

    // 扫描 clawspace/dispatch-skills/ 生成简介（结构同普通 skill：子目录 + SKILL.md）
    let skillsSummary = '';
    try {
      const dispatchSkillRegistry = createSkillSystem(ctx.fs, DISPATCH_SKILLS_DIR, ctx.auditWriter);
      await dispatchSkillRegistry.loadAll();
      const formatted = dispatchSkillRegistry.formatForContext();
      if (!formatted.includes('No skills loaded')) {
        skillsSummary = formatted;
      }
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        ctx.auditWriter?.write(SUMMON_AUDIT_EVENTS.LOAD_SKILLS_FAILED, `error=${String(e)}`);
      }
    }

    // 确定调度模式：mining（默认，意图挖掘）或 shadow（直接进入契约创建）
    const mode = (args.mode as 'mining' | 'shadow') ?? 'mining';
    const isMining = mode === 'mining';
    const callerType: 'shadow' | 'miner' = isMining ? 'miner' : 'shadow';

    // 根据模式构建用户消息
    const userMessage = isMining
      ? buildMiningUserMessage(args.goal as string, skillsSummary, args.targetClaw as string | undefined)
      : buildDescribingUserMessage(args.goal as string, skillsSummary, args.targetClaw as string | undefined);
    if (isMining && !ctx.llm) {
      return { success: false, content: 'Mining mode requires LLM service, but none is available.' };
    }

    // 异步调度 summoner（后台运行，结果通过 inbox 送回）
    // miner 使用独立系统提示；shadow 复用 Motion 系统提示确保 KV cache 命中
    const systemPrompt = isMining
      ? buildMinerSystemPrompt()
      : await this.getSystemPrompt();
    const idleTimeoutMs = typeof args.idleTimeoutMs === 'number'
      ? args.idleTimeoutMs
      : DEFAULT_LLM_IDLE_TIMEOUT_MS;

    // 构造包含完整对话上下文的 messages 数组
    // L4 turn state → getter injection; fallback to ctx for transitional compat
    const dialogMessages = this.getCurrentMessages?.() ?? ctx.dialogMessages ?? [];
    if (dialogMessages.length === 0) {
      ctx.auditWriter?.write(SUMMON_AUDIT_EVENTS.NO_DIALOG_CONTEXT);
    }

    // phase 1123 bug fix：shadow mode 子代理继承 motion dialog 历史（恢复 phase 470 切断的设计 intent、与 ShadowSystem.shadow tool async path 对称）
    // mining mode 不传 shadowMessages：保 mining 不动 discipline、AskMotionTool 已提供 context
    // 不 push userMessage 入 shadowMessages：subagent-executor.ts:150 会读 task.shadowMessages、SubAgent.run 见 messages 非空时 push prompt（=task.intent=userMessage）、避免 double-push
    // strip 末尾 incomplete summon tool_use（loop 派发时 tool_use 已入 dialogMessages 但 tool_result 尚未生成、不 strip 会违反 Anthropic API）
    // 新 array 防 mutate motion dialogMessages（subagent-executor → SubAgent 链可能 push 主 dialog）
    const shadowMessages: Message[] | undefined = isMining
      ? undefined
      : [...(stripIncompleteToolUse(dialogMessages) ?? dialogMessages ?? [])];

    // miner 使用专属工具列表（miner profile + ask_motion）；shadow 用 Motion 完整列表确保 KV cache 命中
    const motionClawDir = isMining ? ctx.clawDir : undefined;
    const toolsForLLM = isMining
      ? [
          ...this.getToolsForProfile('miner'),
          { name: ASK_MOTION_TOOL_NAME, description: ASK_MOTION_TOOL_DESCRIPTION, input_schema: ASK_MOTION_TOOL_SCHEMA },
        ]
      : this.getToolsForLLM();

    // 装配 mainContextSnapshot from ctx.currentToolUseId
    const mainContextSnapshot = ctx.clawId && ctx.currentToolUseId
      ? { clawId: ctx.clawId, toolUseId: ctx.currentToolUseId }
      : undefined;

    // 调度 summoner（声明式 postProcessor 替代 closure 注册）
    try {
      const taskId = await writePendingSubagentTaskFile(ctx.fs, ctx.auditWriter, {
        kind: 'subagent',
        intent: userMessage,
        timeoutMs: SUMMON_SUBAGENT_TIMEOUT_MS,
        maxSteps: (args.maxSteps as number) ?? ctx.subagentMaxSteps ?? ctx.maxSteps,
        parentClawId: ctx.clawId,
        originClawId: ctx.originClawId ?? ctx.clawId,
        callerType,                    // 'shadow' 或 'miner'
        motionClawDir,
        postProcessor: 'summon-contract-extract',  // 声明式 post-processor
        mainContextSnapshot,
        systemPrompt,                            // phase 546: 透传 caller-side specialized prompt（mining: buildMinerSystemPrompt / shadow: this.getSystemPrompt()）
        shadowMessages,  // phase 1123 bug fix: shadow mode 继承 motion dialog 历史 / mining mode = undefined
      });

      return {
        success: true,
        content: `Summon subagent started (${mode} mode). Task ID: ${taskId}. Result will arrive in inbox when complete.`,
        metadata: { taskId },
      };
    } catch (e) {
      throw e;
    }
  }
}
