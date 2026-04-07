import type { ITool, ToolResult, ExecContext, ToolPermissions } from '../executor.js';
import type { TaskSystem } from '../../task/system.js';
import type { Message, ToolDefinition } from '../../../types/message.js';
import { SkillRegistry } from '../../skill/registry.js';
import { ToolRegistry } from '../registry.js';
import { DEFAULT_LLM_IDLE_TIMEOUT_MS, DEFAULT_MAX_STEPS } from '../../../constants.js';
import { buildDispatcherUserMessage, buildMiningUserMessage } from '../../../prompts/index.js';
import { AskMotionTool } from './ask-motion.js';
import { isDispatchCaller } from '../caller-type.js';

export class DispatchTool implements ITool {
  readonly name = 'dispatch';
  readonly description = `创建一个 Dispatcher 作为 Motion 的分身，继承 Motion 的上下文（system prompt + tool registration + messages)，根据上下文用户意图决定将任务派发给哪个claw，并匹配dispatch-skills。

dispatcher 可以：
- 决定目标 claw（新建或复用），并通过 exec 调用 CLI 安装所需技能
- 在最终回复输出 [CONTRACT_DONE] 块，供系统解析契约创建结果
- 通过 exec 调用 CLI 执行其他系统操作
- 直接使用工具完成独立任务

dispatcher 不能：
- 直接调用 spawn 工具（会报错）
- 直接调用 dispatch 工具（递归防护）

优先用 dispatch 的场景：
- 任务需要给 claw 创建契约
- 任务可能匹配已有 dispatch-skills 

已知确切 prompt 的一次性任务，Motion 直接用 spawn 即可。`;

  readonly requiredPermissions: (keyof ToolPermissions)[] = ['spawn'];
  readonly readonly = false;
  readonly idempotent = false;

  constructor(
    private getSystemPrompt: () => Promise<string>,  // buildSystemPrompt() 是 async
    private getToolsForLLM: () => ToolDefinition[], // Motion 完整工具列表（KV cache 关键）
  ) {}

  schema = {
    type: 'object',
    properties: {
      goal:     { type: 'string', description: '本次目标：用户这次想完成什么（Motion 对用户意图的目标描述，不含 claw 名称）' },
      maxSteps: { type: 'number', description: 'dispatcher 最大步数（默认继承主循环 max_steps）' },
      idleTimeoutMs: {
        type: 'number',
        description: 'LLM 静默超时阈值（ms）。超过此时间无 LLM 输出则终止 dispatcher。默认 60000ms（可通过 .clawforum/config.yaml 的 motion.llm_idle_timeout_ms 配置）。',
      },
      targetClaw: {
        type: 'string',
        description: '目标 claw id（kebab-case）。仅当用户明确指定了目标 claw 时填写，否则省略——claw 选择由 dispatcher 决定。若用户要求新建特定名称的 claw，请先创建 claw 再调用 dispatch。',
      },
      mode: {
        type: 'string',
        enum: ['describing', 'mining'],
        description: "调度模式。'mining'（默认）：先挖掘用户意图再创建契约；'describing'：直接进入契约创建流程。",
      },
    },
    required: ['goal'],
  };

  async execute(args: Record<string, unknown>, ctx: ExecContext): Promise<ToolResult> {
    // 防止递归：dispatcher 不能再调 dispatch
    if (isDispatchCaller(ctx.callerType)) {
      return { success: false, content: 'Dispatcher cannot call dispatch (recursion not allowed).' };
    }

    // 扫描 clawspace/dispatch-skills/ 生成简介（结构同普通 skill：子目录 + SKILL.md）
    let skillsSummary = '';
    try {
      const dispatchSkillRegistry = new SkillRegistry(ctx.fs, 'clawspace/dispatch-skills');
      await dispatchSkillRegistry.loadAll();
      const formatted = dispatchSkillRegistry.formatForContext();
      if (!formatted.includes('No skills loaded')) {
        skillsSummary = formatted;
      }
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        ctx.monitor?.log?.('error', { context: 'dispatch.loadSkills', error: String(e) });
      }
    }

    // 确定调度模式：mining（默认，意图挖掘）或 describing（直接进入契约创建）
    const mode = (args.mode as 'mining' | 'describing') ?? 'mining';
    const isMining = mode === 'mining';
    const callerType: 'describer' | 'miner' = isMining ? 'miner' : 'describer';

    // 根据模式构建用户消息
    const userMessage = isMining
      ? buildMiningUserMessage(args.goal as string, skillsSummary, args.targetClaw as string | undefined)
      : buildDispatcherUserMessage(args.goal as string, skillsSummary, args.targetClaw as string | undefined);
    const taskSystem = ctx.taskSystem;
    if (!taskSystem) {
      return { success: false, content: 'TaskSystem not available. dispatch tool requires TaskSystem.' };
    }

    // 注册钩子（在 scheduleSubAgent 之前，但用 taskId 定向确保正确性）
    let dispatcherTaskId: string | null = null;
    let removeHandler: (() => void) | null = null;

    removeHandler = taskSystem.addTaskResultHandler(async (taskId, resultCallerType, result, isError) => {
      if (isDispatchCaller(resultCallerType) && taskId === dispatcherTaskId) {
        removeHandler?.();
        if (isError) return result;

        const blockMatch = result.match(/\[CONTRACT_DONE\]\s*(\{[\s\S]*?\})\s*\[\/CONTRACT_DONE\]/);
        if (!blockMatch) {
          ctx.monitor?.log('warn', {
            context: 'dispatch.contractDoneNotFound',
            taskId,
            hint: 'Dispatcher finished without [CONTRACT_DONE] block — no retrospective will be scheduled',
          });
          return result;
        }

        let parsed: { contractId?: string; targetClaw?: string };
        try {
          parsed = JSON.parse(blockMatch[1]);
        } catch {
          ctx.monitor?.log('warn', { context: 'dispatch.parseContractDone', raw: blockMatch[1].slice(0, 200) });
          return result;
        }

        const { contractId, targetClaw } = parsed;
        if (!contractId || !targetClaw) {
          ctx.monitor?.log('warn', {
            context: 'dispatch.contractDoneMissingFields',
            taskId,
            parsed,
            hint: '[CONTRACT_DONE] block parsed but contractId or targetClaw missing — no retrospective will be scheduled',
          });
          return result;
        }

        try {
          await ctx.fs.ensureDir('clawspace/pending-retrospective/by-contract');
          await ctx.fs.writeAtomic(
            `clawspace/pending-retrospective/by-contract/${contractId}.json`,
            JSON.stringify({ contractId, dispatcherTaskId: taskId, targetClaw, createdAt: new Date().toISOString() }),
          );
        } catch (e) {
          ctx.monitor?.log('error', {
            context: 'dispatch.writeByContract',
            contractId,
            error: e instanceof Error ? e.message : String(e),
          });
        }

        const summary = result.replace(/\[CONTRACT_DONE\][\s\S]*?\[\/CONTRACT_DONE\]/g, '').trim();
        return summary || `契约已创建（contractId: ${contractId}，targetClaw: ${targetClaw}）。`;
      }
      return result;
    });

    // 异步调度 dispatcher（后台运行，结果通过 inbox 送回）
    // system prompt 保持与 Motion 完全一致，确保 KV cache 命中
    const systemPrompt = await this.getSystemPrompt();
    const idleTimeoutMs = typeof args.idleTimeoutMs === 'number'
      ? args.idleTimeoutMs
      : DEFAULT_LLM_IDLE_TIMEOUT_MS;

    // 构造包含完整对话上下文的 messages 数组
    const dialogMessages = ctx.dialogMessages ?? [];
    if (dialogMessages.length === 0) {
      console.warn('[dispatch] dialogMessages not provided or empty — dispatcher will run without conversation context');
    }

    // messages 截止至当前 dispatch tool_use（loop 在执行工具前已追加），tool_result 尚未产生。
    // 历史 dispatch 对（tool_use + tool_result）保持完整，确保 KV cache 命中。
    const dispatcherMessages: Message[] = [...dialogMessages];

    // --- 关闭悬空的 dispatch tool_use ---
    //
    // dialogMessages 末尾是 assistant: tool_use(dispatch)，没有对应的 tool_result。
    // 原因：loop 在调用工具前已把 tool_use 追加到 messages，但 tool_result 在工具
    // 返回后才生成——而 dispatcher 作为异步任务，在工具返回之前就已拿到 messages 副本。
    //
    // 如果直接在 tool_use 后追加普通 user message（dispatcher 指令），会违反 Anthropic
    // API 规范（tool_use 后必须跟 tool_result），导致 LLM 行为不稳定：它会把"完成
    // dispatch 调用"误解为自己的任务，转而发通知报告而不是执行 dispatcher workflow。
    //
    // 修复：注入一个合并的 user message，同时包含：
    //   - tool_result：语法上关闭 dispatch tool_use（content 是占位符，dispatcher 无需知道
    //     Motion 实际收到的 "Dispatcher started..." 信息）
    //   - text：dispatcher 指令（与原 prompt 字段内容相同）
    // 两者合并为同一个 user message，保证消息结构 [tool_use → user(tool_result+text)] 合法。
    const lastMsg = dispatcherMessages[dispatcherMessages.length - 1];
    let dispatchToolUseId: string | undefined;
    if (lastMsg?.role === 'assistant' && Array.isArray(lastMsg.content)) {
      const lastBlock = lastMsg.content[lastMsg.content.length - 1];
      if (lastBlock?.type === 'tool_use' && lastBlock.name === 'dispatch') {
        dispatchToolUseId = (lastBlock as { type: string; id: string; name: string }).id;
      }
    }
    if (dispatchToolUseId) {
      dispatcherMessages.push({
        role: 'user',
        content: [
          // 占位 tool_result：关闭 dispatch 调用，content 无需与 Motion 实际收到的相同
          { type: 'tool_result', tool_use_id: dispatchToolUseId, content: 'Dispatcher activated.' },
          // dispatcher 指令紧跟其后，同属一个 user turn
          { type: 'text', text: userMessage },
        ],
      });
    }

    // 使用 Motion 的完整工具列表，确保 KV cache 命中（system prompt + tools 前缀一致）
    const toolsForLLM = this.getToolsForLLM();

    // 调度 dispatcher（之后填入 dispatcherTaskId 供钩子定向）
    try {
      dispatcherTaskId = await taskSystem.scheduleSubAgent({
        kind: 'subagent',
        messages: dispatcherMessages,           // 完整对话上下文（含注入的合并 user message）
        prompt: dispatchToolUseId ? '' : userMessage,  // 已注入则留空，否则 fallback
        tools: [],                     // 空 = 使用 registry 全部工具
        timeout: 3600,                 // 总超时 1 小时
        maxSteps: (args.maxSteps as number) ?? ctx.subagentMaxSteps ?? ctx.maxSteps ?? DEFAULT_MAX_STEPS,
        parentClawId: ctx.clawId,
        systemPrompt,
        idleTimeoutMs,
        originClawId: ctx.originClawId ?? ctx.clawId,
        toolsForLLM,                   // 使用 Motion 完整工具列表，确保 KV cache 命中
        callerType,                    // 'describer' 或 'miner'
        extraTools: isMining
          ? [
              new AskMotionTool(
                ctx.llm!,
                this.getSystemPrompt.bind(this),
                this.getToolsForLLM.bind(this),
                [...dispatcherMessages],  // Motion 上下文快照
              ),
            ]
          : undefined,
      });
    } catch (e) {
      removeHandler?.();
      throw e;
    }

    const taskId = dispatcherTaskId;

    ctx.parentStreamWriter?.write({
      ts: Date.now(),
      type: 'task_started',
      taskId,
      callerType,
    });

    return {
      success: true,
      content: `Dispatcher started. Task ID: ${taskId}. Result will arrive in inbox when complete.`,
      metadata: { taskId },
    };
  }
}
