import type { ITool, ToolResult, ExecContext, ToolPermissions } from '../executor.js';
import type { TaskSystem } from '../../task/system.js';
import type { Message, ToolDefinition } from '../../../types/message.js';
import { SkillRegistry } from '../../skill/registry.js';
import { ToolRegistry } from '../registry.js';
import { DEFAULT_LLM_IDLE_TIMEOUT_MS, DEFAULT_MAX_STEPS } from '../../../constants.js';
import { spawnTool } from './spawn.js';
import * as fsNative from 'fs';
import * as path from 'path';
import { CONTRACT_AGENT_SYSTEM_PROMPT, buildDispatcherUserMessage } from '../../../prompts/index.js';
import { TOOL_PROFILES } from '../profiles.js';

/**
 * Extract text from message content (handles string, array, or object formats)
 */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(c => {
      if (typeof c === 'string') return c;
      if (typeof c === 'object' && c !== null) {
        const obj = c as Record<string, unknown>;
        if (typeof obj.text === 'string') return obj.text;
        if (typeof obj.content === 'string') return obj.content;
        if (Array.isArray(obj.content)) return extractText(obj.content);
      }
      return '';
    }).join('\n');
  }
  return '';
}

export class DispatchTool implements ITool {
  readonly name = 'dispatch';
  readonly description = `创建一个 Dispatcher 作为 Motion 的分身，继承 Motion 的上下文（system prompt + tool registration + messages)，根据上下文用户意图决定将任务派发给哪个claw，并匹配dispatch-skills。

dispatcher 可以：
- 决定目标 claw（新建或复用），并通过 exec 调用 CLI 安装所需技能
- 在最终回复输出 [SPAWN_REQUEST] 块，由系统自动调度“契约创建子代理”
- 通过 exec 调用 CLI 执行其他系统操作
- 直接使用工具完成独立任务

dispatcher 不能：
- 直接调用 spawn 工具（会报错）
- 通过 exec 直接创建契约（系统根据dispatcher输出的 SPAWN_REQUEST调度“契约创建子代理”，子代理有创建契约的全面提示词，会完成契约创建）

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
    },
    required: ['goal'],
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

    const userMessage = buildDispatcherUserMessage(
      args.goal as string,
      skillsSummary,
      args.targetClaw as string | undefined,
    );
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

        // 校验 targetClaw 存在
        if (targetClaw) {
          const clawsDir = path.resolve(ctx.clawDir, '..', 'claws');
          const clawDir = path.join(clawsDir, targetClaw);
          if (!fsNative.existsSync(clawDir)) {
            ctx.monitor?.log('warn', {
              context: 'dispatch.invalidTargetClaw',
              targetClaw,
              reason: 'claw directory does not exist',
            });
            const summary = result.replace(/\[SPAWN_REQUEST\][\s\S]*?\[\/SPAWN_REQUEST\]/g, '').trim();
            return `${summary}\n\n[SPAWN_REQUEST 已忽略：targetClaw "${targetClaw}" 不存在，请先创建该 claw]`;
          }
        }

        const augmentedPrompt = spawnPrompt;

        // 通过 spawn 工具创建契约创建子代理，确保 task_started 写入 parentStreamWriter
        const spawnResult = await spawnTool.execute({
          prompt: augmentedPrompt,
          tools: TOOL_PROFILES['subagent'],
          timeout: 600,
          maxSteps: DEFAULT_MAX_STEPS,
          systemPrompt: CONTRACT_AGENT_SYSTEM_PROMPT,
        }, ctx);

        if (!spawnResult.success || !spawnResult.metadata?.taskId) {
          ctx.monitor?.log('error', {
            context: 'dispatch.spawnContractAgent',
            error: spawnResult.content,
          });
          return result;  // 无法调度，跳过 SPAWN_REQUEST
        }
        const contractTaskId = spawnResult.metadata.taskId as string;

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

          // 从 messages.json 里找 exec tool_result 提取 contractId
          let cid: string | undefined;

          // 先试 messages 文件（可靠）
          try {
            const msgsRaw = await ctx.fs.read(`tasks/results/${tid}.messages.json`);
            const msgs: Array<{ role: string; content: unknown }> = JSON.parse(msgsRaw);
            for (const msg of msgs) {
              if (msg.role !== 'user') continue;
              const text = extractText(msg.content);
              const m = text.match(/Contract created:\s+(\d+-[a-f0-9]+)\s+for claw/);
              if (m) { cid = m[1]; break; }
            }
          } catch (e) {
            const code = (e as NodeJS.ErrnoException).code;
            if (code !== 'ENOENT') {
              ctx.monitor?.log('warn', {
                context: 'dispatch.parseMessages',
                taskId: tid,
                error: e instanceof Error ? e.message : String(e),
              });
            }
          }

          // 降级：兼容旧的 CONTRACT_CREATED 格式
          if (!cid) {
            const m = res.match(/CONTRACT_CREATED:\s+(\d+-[a-f0-9]+)/);
            cid = m?.[1];
          }

          if (!cid) return res;

          try {
            await ctx.fs.ensureDir('clawspace/pending-retrospective/by-contract');
            await ctx.fs.writeAtomic(
              `clawspace/pending-retrospective/by-contract/${cid}.json`,
              JSON.stringify({ contractId: cid, contractTaskId: tid, targetClaw: targetClaw ?? null, createdAt: new Date().toISOString() }),
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
