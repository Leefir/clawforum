import type { ITool, ToolResult, ExecContext, ToolPermissions } from '../executor.js';
import type { TaskSystem } from '../../task/system.js';
import { SkillRegistry } from '../../skill/registry.js';
import type { ToolRegistry } from '../registry.js';

export class DispatchTool implements ITool {
  readonly name = 'dispatch';
  readonly description = `创建一个 Spawnable SubAgent（dispatcher），继承 Motion 的 system prompt 和工具列表（命中 LLM KV cache），读取 dispatch-skills 模板后决定如何派发工作。

dispatcher 可以：
- spawn Worker SubAgent 执行内容任务
- contract create 建立需要验收的长期任务
- 在 clawspace/dispatch-skills/ 保存新模板供下次复用

优先用 dispatch（而非直接 spawn）的场景：
- 任务可能匹配已有模板（复用 prompt + skills 组合）
- 希望积累可复用模板库
- 希望命中 KV cache（dispatcher 与 Motion 共享请求前缀，节省 token）

已知确切 prompt 的一次性任务，直接用 spawn 即可。`;

  readonly requiredPermissions: (keyof ToolPermissions)[] = ['spawn'];
  readonly readonly = false;
  readonly idempotent = false;

  constructor(
    private getSystemPrompt: () => Promise<string>,  // buildSystemPrompt() 是 async
    private registry: ToolRegistry,                  // Motion 的完整注册表（KV cache 关键）
  ) {}

  schema = {
    type: 'object',
    properties: {
      task:     { type: 'string', description: '要完成的任务描述' },
      context:  { type: 'string', description: '当前对话的相关上下文（简短）' },
      maxSteps: { type: 'number', description: 'dispatcher 最大步数（默认 10）' },
      idleTimeoutMs: {
        type: 'number',
        description: 'LLM 静默超时阈值（ms）。超过此时间无 LLM 输出则终止 dispatcher。默认 30000。',
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
    } catch { /* dispatch-skills 目录不存在时跳过 */ }

    // dispatch-skills 简介注入消息末尾（不进 system prompt，保持共享前缀，确保 KV cache 命中）
    const prompt = [
      `## Task\n${args.task}`,
      args.context ? `## Context\n${args.context}` : '',
      skillsSummary
        ? `${skillsSummary}\nUse skill({ name: "<skill-name>", skillsDir: "clawspace/dispatch-skills" }) to load full template.`
        : '',
      `## Instructions
If a dispatch skill matches, load its full SKILL.md via skill tool, fill in variables, then spawn Worker or create contract accordingly.
If none match, write the prompt yourself. Save new templates to clawspace/dispatch-skills/<name>/SKILL.md for future reuse.
Return: which template was used (or "new"), what was dispatched, brief summary.`,
    ].filter(Boolean).join('\n\n');

    const taskSystem = (ctx as unknown as { taskSystem?: TaskSystem }).taskSystem;
    if (!taskSystem) {
      return { success: false, content: 'TaskSystem not available. dispatch tool requires TaskSystem.' };
    }

    // 异步调度 dispatcher（后台运行，结果通过 inbox 送回）
    const systemPrompt = await this.getSystemPrompt();
    const idleTimeoutMs = typeof args.idleTimeoutMs === 'number'
      ? args.idleTimeoutMs
      : 30000;

    const taskId = await taskSystem.scheduleSubAgent({
      kind: 'subagent',
      prompt,
      tools: [],           // 空 = 使用 registry 全部工具（spawn/skill/exec 均可用）
      timeout: 3600,       // 总超时 1 小时（idle timeout 会更早触发终止）
      maxSteps: (args.maxSteps as number) ?? 10,
      parentClawId: ctx.clawId,
      systemPrompt,
      callerType: 'dispatcher',
      idleTimeoutMs,
    });

    return {
      success: true,
      content: `Dispatcher started. Task ID: ${taskId}. Result will arrive in inbox when complete.`,
      metadata: { taskId },
    };
  }
}
