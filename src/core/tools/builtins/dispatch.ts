import type { ITool, ToolResult, ExecContext, ToolPermissions } from '../executor.js';
import type { TaskSystem } from '../../task/system.js';
import type { Message, ToolDefinition } from '../../../types/message.js';
import { SkillRegistry } from '../../skill/registry.js';
import { ToolRegistry } from '../registry.js';
import { DEFAULT_LLM_IDLE_TIMEOUT_MS } from '../../../constants.js';

export class DispatchTool implements ITool {
  readonly name = 'dispatch';
  readonly description = `创建一个 Dispatcher 分身，继承 Motion 的 system prompt 和工具列表，读取 dispatch-skills 模板后决定如何派发工作。

dispatcher 可以：
- 通过 exec 调用 CLI 给指定 claw 创建契约（长期、可验收的任务）
- 通过 exec 调用 CLI 执行其他系统操作
- 直接使用工具完成独立任务

dispatcher 不能：
- 直接 spawn（如需 spawn，在最终回复中说明 prompt，由 Motion 执行）

优先用 dispatch 的场景：
- 任务需要给 claw 创建契约
- 任务可能匹配已有 dispatch-skills 模板

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
      task:     { type: 'string', description: '要完成的任务描述' },
      context:  { type: 'string', description: '当前对话的相关上下文（简短）' },
      maxSteps: { type: 'number', description: 'dispatcher 最大步数（默认继承主循环 max_steps）' },
      idleTimeoutMs: {
        type: 'number',
        description: 'LLM 静默超时阈值（ms）。超过此时间无 LLM 输出则终止 dispatcher。默认 60000ms（可通过 .clawforum/config.yaml 的 motion.llm_idle_timeout_ms 配置）。',
      },
    },
    required: ['task'],
  };

  async execute(args: Record<string, unknown>, ctx: ExecContext): Promise<ToolResult> {
    // 防止递归：dispatcher 不能再调 dispatch
    if (ctx.callerType === 'dispatcher') {
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

    // dispatch-skills 简介注入消息末尾（不进 system prompt，保持共享前缀，确保 KV cache 命中）
    let prompt = `## Task\n${args.task}`;
    if (args.context) {
      prompt += `\n\n## Context\n${args.context}`;
    }
    if (skillsSummary) {
      prompt += `\n\n${skillsSummary}\nUse skill({ name: "<skill-name>", skillsDir: "clawspace/dispatch-skills" }) to load full template.`;
    }
    prompt += `\n\n## Instructions
If a dispatch skill matches, load its full SKILL.md via skill tool, fill in variables, then act:
- 契约类任务：exec: clawforum contract create --goal "<goal>" <claw_id>
- 需要 spawn 的一次性任务：不要调 spawn，在最终回复里写明 "建议 Motion spawn: <prompt>"，Motion 会处理
If none match, decide and act directly. Save new templates to clawspace/dispatch-skills/<name>/SKILL.md for future reuse.
Return: which template was used (or "new"), what was done (or suggested), brief summary.`;

    // Dispatcher 身份说明（放在 user 消息中，不修改 system prompt 以保持 KV cache 命中）
    const dispatcherNotice = `\n\n---\n你是由 Motion 通过 \`dispatch\` 启动的 Dispatcher。\n- 不能再调用 \`dispatch\`（递归防护）\n- 不能调用 \`spawn\`（调用会报错）；需要 spawn 时，在最终回复中写明建议 prompt，由 Motion 执行\n- 契约创建：exec: clawforum contract create --goal "<goal>" <claw_id>`;
    prompt += dispatcherNotice;

    const taskSystem = ctx.taskSystem;
    if (!taskSystem) {
      return { success: false, content: 'TaskSystem not available. dispatch tool requires TaskSystem.' };
    }

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
    const dispatcherMessages: Message[] = [
      ...dialogMessages,
      { role: 'user' as const, content: prompt },
    ];

    // 使用 Motion 的完整工具列表，确保 KV cache 命中（system prompt + tools 前缀一致）
    const toolsForLLM = this.getToolsForLLM();

    const taskId = await taskSystem.scheduleSubAgent({
      kind: 'subagent',
      messages: dispatcherMessages,  // 完整对话上下文
      prompt,                         // 保留（兼容 fallback）
      tools: [],                     // 空 = 使用 registry 全部工具
      timeout: 3600,                 // 总超时 1 小时
      maxSteps: (args.maxSteps as number) ?? ctx.subagentMaxSteps ?? ctx.maxSteps ?? 100,
      parentClawId: ctx.clawId,
      systemPrompt,
      callerType: 'dispatcher',
      idleTimeoutMs,
      originClawId: ctx.originClawId ?? ctx.clawId,
      toolsForLLM,                   // 使用 Motion 完整工具列表，确保 KV cache 命中
    });

    ctx.parentStreamWriter?.write({
      ts: Date.now(),
      type: 'task_started',
      taskId,
      callerType: 'dispatcher',
    });

    return {
      success: true,
      content: `Dispatcher started. Task ID: ${taskId}. Result will arrive in inbox when complete.`,
      metadata: { taskId },
    };
  }
}
