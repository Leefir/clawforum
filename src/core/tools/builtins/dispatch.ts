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

    // 构建 Dispatcher 的 user message（新架构格式）
    let userMessage = `---\n你是由 Motion 通过 \`dispatch\` 启动的 Dispatcher。\n- 不能再调用 \`dispatch\`（递归防护）\n- 不能调用 \`spawn\`（会报错）\n`;

    userMessage += `\n## 任务\n${args.task}`;

    if (args.context) {
      userMessage += `\n\n## 上下文\n${args.context}`;
    }

    if (skillsSummary) {
      userMessage += `\n\n${skillsSummary}\n通过 skill({ name: "<skill-name>", skillsDir: "clawspace/dispatch-skills" }) 加载完整模板。`;
    }

    userMessage += `\n\n## 执行步骤

1. 决定目标 claw（已有哪个最合适 / 需要新建）
2. 如需新建 claw：直接用工具新建（exec: clawforum claw create <name>）
3. 为该 claw 安装所需技能：直接用工具完成（exec: clawforum skill install --claw <id> --skill <name>）
4. 在最终回复末尾输出以下块（必须，格式不可变）：

[SPAWN_REQUEST]
{"targetClaw":"<clawId>","prompt":"<给契约创建子代理的完整 prompt，包含目标、要求、验收标准>"}
[/SPAWN_REQUEST]

契约创建子代理没有任何上下文，prompt 必须自包含（不能引用"本次对话"）。`;

    const taskSystem = ctx.taskSystem;
    if (!taskSystem) {
      return { success: false, content: 'TaskSystem not available. dispatch tool requires TaskSystem.' };
    }

    // 注册 onTaskResult 钩子处理 SPAWN_REQUEST 块 和 契约创建子代理结果
    // 闭包捕获 ctx.fs / ctx.taskSystem（同一 motion claw，多次调用安全覆盖）
    taskSystem.onTaskResult = async (taskId, callerType, result, isError) => {
      // ========== Step C: 处理 Dispatcher 的 SPAWN_REQUEST ==========
      if (callerType === 'dispatcher' && !isError) {
        // 解析 SPAWN_REQUEST 块
        const blockMatch = result.match(/\[SPAWN_REQUEST\]\s*\n(\{[\s\S]*?\})\s*\n\[\/SPAWN_REQUEST\]/);
        if (!blockMatch) return result;  // 无块，透传

        let parsed: { targetClaw?: string; prompt?: string };
        try {
          parsed = JSON.parse(blockMatch[1]);
        } catch {
          return result;  // JSON 解析失败，透传
        }
        const { targetClaw, prompt: spawnPrompt } = parsed;
        if (!spawnPrompt) return result;

        // 强制子代理在 finalText 中输出结构化行，供 Step D 解析 contractId
        const augmentedPrompt = `${spawnPrompt}

在最终回复末尾必须包含以下行（不可省略，格式不可变）：
CONTRACT_CREATED: <contractId>`;

        // 调度契约创建子代理
        const contractTaskId = await taskSystem.scheduleSubAgent({
          kind: 'subagent',
          prompt: augmentedPrompt,
          tools: ['exec', 'read', 'write', 'skill', 'status'],
          timeout: 600,
          maxSteps: 30,
          parentClawId: ctx.clawId,
          originClawId: ctx.originClawId ?? ctx.clawId,
        });

        // 记录待复盘信息（供 daemon-loop 后续追踪）
        try {
          await ctx.fs.ensureDir('clawspace/pending-retrospective');
          await ctx.fs.writeAtomic(
            `clawspace/pending-retrospective/${contractTaskId}.json`,
            JSON.stringify({
              contractTaskId,
              dispatcherTaskId: taskId,
              targetClaw: targetClaw ?? null,
              createdAt: new Date().toISOString(),
            }),
          );
        } catch {
          // best-effort，失败不阻断流程
        }

        // 剥离 SPAWN_REQUEST 块，只保留人类可读摘要
        const summary = result.replace(/\[SPAWN_REQUEST\][\s\S]*?\[\/SPAWN_REQUEST\]/g, '').trim();
        return summary || `Dispatcher 完成。契约创建子代理已启动（taskId: ${contractTaskId}）。`;
      }

      // ========== Step D: 处理契约创建子代理结果，建立反向索引 ==========
      if (callerType === 'subagent' && !isError) {
        // 检查是否是已追踪的契约创建任务
        let pendingEntry: { contractTaskId?: string; dispatcherTaskId?: string; targetClaw?: string | null } | null = null;
        try {
          const raw = await ctx.fs.read(`clawspace/pending-retrospective/${taskId}.json`);
          pendingEntry = JSON.parse(raw);
        } catch {
          // 不是 pending-retrospective 任务，跳过
          return result;
        }

        // 解析 contractId（契约创建子代理强制输出的格式）
        const contractIdMatch = result.match(/CONTRACT_CREATED:\s+(\S+)/);
        const contractId = contractIdMatch?.[1];
        if (!contractId) return result;  // 未找到，透传

        // 写反向索引: contractId -> contractTaskId
        try {
          await ctx.fs.ensureDir('clawspace/pending-retrospective/by-contract');
          await ctx.fs.writeAtomic(
            `clawspace/pending-retrospective/by-contract/${contractId}.json`,
            JSON.stringify({
              contractId,
              contractTaskId: taskId,
              createdAt: new Date().toISOString(),
            }),
          );
        } catch {
          // best-effort
        }
      }

      return result;
    };

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
      { role: 'user' as const, content: userMessage },
    ];

    // 使用 Motion 的完整工具列表，确保 KV cache 命中（system prompt + tools 前缀一致）
    const toolsForLLM = this.getToolsForLLM();

    const taskId = await taskSystem.scheduleSubAgent({
      kind: 'subagent',
      messages: dispatcherMessages,  // 完整对话上下文
      prompt: userMessage,            // 保留（兼容 fallback）
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
