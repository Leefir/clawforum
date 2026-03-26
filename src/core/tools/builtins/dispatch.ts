import type { ITool, ToolResult, ExecContext, ToolPermissions } from '../executor.js';
import type { TaskSystem } from '../../task/system.js';
import type { Message, ToolDefinition } from '../../../types/message.js';
import { SkillRegistry } from '../../skill/registry.js';
import { ToolRegistry } from '../registry.js';
import { DEFAULT_LLM_IDLE_TIMEOUT_MS, DEFAULT_MAX_STEPS } from '../../../constants.js';

const CONTRACT_AGENT_SYSTEM_PROMPT = `你是契约创建子代理，负责为指定 claw 设计并创建一份契约。

## 可用工具

- exec：执行 shell 命令（clawforum CLI 及文件操作）
- read / write：读写 motion 工作区文件（clawspace/ 目录）
- skill：加载技能模板
- status：查看 claw 列表和状态

## 工作流程

### 第一步：设计契约，写 YAML 文件

将契约 YAML 写入 motion 工作区（如 \`clawspace/contract-draft.yaml\`）：

\`\`\`yaml
schema_version: 1
title: "契约标题（50字以内）"
goal: "一句话描述目标"
deliverables:
  - clawspace/output.md
subtasks:
  - id: kebab-case-id
    description: "动词 + 做什么 + 具体输出路径，例如：收集5份模板并保存到 clawspace/templates.md"
acceptance:
  - subtask_id: kebab-case-id
    type: script
    script_file: acceptance/kebab-case-id.sh
  - subtask_id: another-subtask-id
    type: llm
    prompt_file: acceptance/another-subtask-id.prompt.txt
escalation:
  max_retries: 3
\`\`\`

规则：
- subtask id 用 kebab-case
- type "script" 对应 script_file；type "llm" 对应 prompt_file（不可混用，否则验收静默失败）
- **每个 subtask_id 在 acceptance 里只能出现一次**：同一 subtask_id 写两条验收（如 script + llm）只有第一条生效，第二条被静默忽略
- 验收脚本从 clawDir 运行，用 \`clawspace/<filename>\` 检查文件

### 第二步：创建契约，获取 contractId

\`\`\`
clawforum contract create --claw <clawId> --file clawspace/contract-draft.yaml
\`\`\`

输出格式：\`Contract created: <contractId> for claw <clawId>\`
→ 从中提取 contractId。

### 第三步：写验收脚本/提示词

契约创建后，将验收文件写入目标 claw 的验收目录：

脚本路径：\`.clawforum/claws/<clawId>/contract/active/<contractId>/acceptance/<id>.sh\`
提示词路径：\`.clawforum/claws/<clawId>/contract/active/<contractId>/acceptance/<id>.prompt.txt\`

用 exec 创建目录并写文件：
\`\`\`
mkdir -p .clawforum/claws/<clawId>/contract/active/<contractId>/acceptance
\`\`\`

脚本示例（exit 0 = 通过，exit 1 = 失败）：
\`\`\`bash
#!/bin/bash
if [ -f "clawspace/output.md" ]; then exit 0; else exit 1; fi
\`\`\`

LLM 提示词必须包含 \`{{evidence}}\` 和 \`{{artifacts}}\` 占位符。

## 其他 CLI 命令

\`\`\`
clawforum status                              # 查看所有 claw
clawforum claw create <name>                  # 新建 claw（目标不存在时）
clawforum skill install --claw <id> --skill <name>  # 为 claw 安装技能
\`\`\`
`;

export class DispatchTool implements ITool {
  readonly name = 'dispatch';
  readonly description = `创建一个 Dispatcher 分身，继承 Motion 的 system prompt 和工具列表，读取 dispatch-skills 模板后决定如何派发工作。

dispatcher 可以：
- 决定目标 claw（新建或复用），并通过 exec 安装所需技能
- 在最终回复输出 [SPAWN_REQUEST] 块，由系统自动调度契约创建子代理
- 通过 exec 调用 CLI 执行其他系统操作
- 直接使用工具完成独立任务

dispatcher 不能：
- 直接调用 spawn 工具（会报错）
- 通过 exec 直接创建契约（应输出 SPAWN_REQUEST，让系统调度）

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
{"targetClaw":"<clawId>","prompt":"<给契约创建子代理的完整 prompt>"}
[/SPAWN_REQUEST]

**prompt 写法**：这是给"契约设计者"的指令，不是给"任务执行者"的。
契约创建子代理的工作是：写 YAML → clawforum contract create --file → 写验收脚本。
prompt 里应说明：
- 目标 claw 是哪个
- 要完成什么任务（由该 claw 执行，不是子代理本人执行）
- 期望的 deliverables（路径）和验收标准

示例：
"为 openclaw-explorer claw 创建契约，任务是探索 OpenClaw 的 Gateway/Docker/Config 模块并生成报告到 clawspace/deep-analysis.md，验收标准：该文件存在且包含各模块分析。"

不要把"执行任务"的 prompt 放进去（子代理不会去做实际工作）。
契约创建子代理没有任何上下文，prompt 必须自包含（不能引用"本次对话"）。`;

    const taskSystem = ctx.taskSystem;
    if (!taskSystem) {
      return { success: false, content: 'TaskSystem not available. dispatch tool requires TaskSystem.' };
    }

    // 注册钩子（在 scheduleSubAgent 之前，但用 taskId 定向确保正确性）
    let dispatcherTaskId: string | null = null;
    let removeHandler: (() => void) | null = null;

    removeHandler = taskSystem.addTaskResultHandler(async (taskId, callerType, result, isError) => {
      // ========== Step C: 处理 Dispatcher 的 SPAWN_REQUEST ==========
      // taskId 定向：只处理本次 dispatch 启动的那个 dispatcher
      if (callerType === 'dispatcher' && taskId === dispatcherTaskId) {
        removeHandler?.();   // 无论成功/失败都清理，防止 handler 泄漏
        if (isError) {
          return result;     // 失败直接透传，不处理 SPAWN_REQUEST
        }

        const blockMatch = result.match(/\[SPAWN_REQUEST\]\s*(\{[\s\S]*?\})\s*\[\/SPAWN_REQUEST\]/);
        if (!blockMatch) return result;

        let parsed: { targetClaw?: string; prompt?: string };
        try {
          parsed = JSON.parse(blockMatch[1]);
        } catch (e) {
          ctx.monitor?.log('warn', {
            context: 'dispatch.parseSpawnRequest',
            taskId,
            error: e instanceof Error ? e.message : String(e),
            raw: blockMatch[1].slice(0, 200),
          });
          return result;
        }
        const { targetClaw, prompt: spawnPrompt } = parsed;
        if (!spawnPrompt) return result;

        const augmentedPrompt = `${spawnPrompt}

在最终回复末尾必须包含以下行（不可省略，格式不可变）：
CONTRACT_CREATED: <contractId>`;

        const contractTaskId = await taskSystem.scheduleSubAgent({
          kind: 'subagent',
          prompt: augmentedPrompt,
          tools: ['exec', 'read', 'write', 'skill', 'status'],
          timeout: 600,
          maxSteps: DEFAULT_MAX_STEPS,
          parentClawId: ctx.clawId,
          originClawId: ctx.originClawId ?? ctx.clawId,
          systemPrompt: CONTRACT_AGENT_SYSTEM_PROMPT,
        });

        try {
          await ctx.fs.ensureDir('clawspace/pending-retrospective');
          await ctx.fs.writeAtomic(
            `clawspace/pending-retrospective/${contractTaskId}.json`,
            JSON.stringify({ contractTaskId, dispatcherTaskId: taskId, targetClaw: targetClaw ?? null, createdAt: new Date().toISOString() }),
          );
        } catch (e) {
          ctx.monitor?.log('error', {
            context: 'dispatch.writePendingRetrospective',
            contractTaskId,
            error: e instanceof Error ? e.message : String(e),
          });
        }

        // ========== Step D: 注册专属 handler 等待契约创建子代理结果，建立反向索引 ==========
        let removeContractHandler: (() => void) | null = null;
        removeContractHandler = taskSystem.addTaskResultHandler(async (tid, _callerType, res, isErr) => {
          if (tid !== contractTaskId) return res;        // 不是目标任务，跳过
          removeContractHandler?.();                      // 无论成功/失败都清理

          if (isErr) return res;

          const contractIdMatch = res.match(/CONTRACT_CREATED:\s+(\S+)/);
          const cid = contractIdMatch?.[1];
          if (!cid) return res;

          try {
            await ctx.fs.ensureDir('clawspace/pending-retrospective/by-contract');
            await ctx.fs.writeAtomic(
              `clawspace/pending-retrospective/by-contract/${cid}.json`,
              JSON.stringify({ contractId: cid, contractTaskId: tid, createdAt: new Date().toISOString() }),
            );
          } catch (e) {
            ctx.monitor?.log('warn', {
              context: 'dispatch.writeByContract',
              taskId: tid,
              contractId: cid,
              error: e instanceof Error ? e.message : String(e),
            });
          }

          return res;
        });

        const summary = result.replace(/\[SPAWN_REQUEST\][\s\S]*?\[\/SPAWN_REQUEST\]/g, '').trim();
        return summary || `Dispatcher 完成。契约创建子代理已启动（taskId: ${contractTaskId}）。`;
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
    const dispatcherMessages: Message[] = [
      ...dialogMessages,
      { role: 'user' as const, content: userMessage },
    ];

    // 使用 Motion 的完整工具列表，确保 KV cache 命中（system prompt + tools 前缀一致）
    const toolsForLLM = this.getToolsForLLM();

    // 调度 dispatcher（之后填入 dispatcherTaskId 供钩子定向）
    dispatcherTaskId = await taskSystem.scheduleSubAgent({
      kind: 'subagent',
      messages: dispatcherMessages,  // 完整对话上下文
      prompt: userMessage,            // 保留（兼容 fallback）
      tools: [],                     // 空 = 使用 registry 全部工具
      timeout: 3600,                 // 总超时 1 小时
      maxSteps: (args.maxSteps as number) ?? ctx.subagentMaxSteps ?? ctx.maxSteps ?? DEFAULT_MAX_STEPS,
      parentClawId: ctx.clawId,
      systemPrompt,
      callerType: 'dispatcher',
      idleTimeoutMs,
      originClawId: ctx.originClawId ?? ctx.clawId,
      toolsForLLM,                   // 使用 Motion 完整工具列表，确保 KV cache 命中
    });

    const taskId = dispatcherTaskId;

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
