/**
 * Dispatcher User Message Builder
 * 
 * Builds the user message for dispatcher subagent.
 */

export function buildDispatcherUserMessage(
  task: string,
  context?: string,
  skillsSummary?: string,
  targetClaw?: string,
): string {
  let userMessage = `---\n你是由 Motion 通过 \`dispatch\` 启动的 Dispatcher。\n- 不能再调用 \`dispatch\`（递归防护）\n- 不能调用 \`spawn\`（会报错）\n- 不能自己写契约 YAML 或验收脚本（由 SPAWN_REQUEST 触发的专属子代理负责）\n`;

  userMessage += `\n## 任务\n${task}`;

  if (context) {
    userMessage += `\n\n## 上下文\n${context}`;
  }

  if (skillsSummary) {
    userMessage += `\n\n${skillsSummary}\n通过 skill({ name: "<skill-name>", skillsDir: "clawspace/dispatch-skills" }) 加载完整模板。`;
  }

  if (targetClaw) {
    userMessage += `\n\n## 执行步骤

1. 目标 claw 已由用户指定：**${targetClaw}**，直接使用，无需判断。
2. 为该 claw 安装所需技能（如需要）：exec: clawforum skill install --claw ${targetClaw} --skill <name>
3. 在最终回复末尾输出以下块，用于发起子代理给 targetClaw 创建契约（必须，格式不可变）：

[SPAWN_REQUEST]
{"targetClaw":"${targetClaw}","prompt":"<给契约创建子代理的完整 prompt>"}
[/SPAWN_REQUEST]

**prompt 写法**：这是给"契约设计者"的指令，不是给"任务执行者"的。
契约创建子代理的工作是：设计契约 YAML、写验收文件，并通过 clawforum contract create --dir 提交。
prompt 里应说明：
- 目标 claw 是哪个
- 要完成什么任务（由该 claw 执行，不是子代理本人执行）
- 期望的 deliverables（路径）和验收标准

不要把"执行任务"的 prompt 放进去（子代理不会去做实际工作）。
契约创建子代理没有任何上下文，prompt 必须自包含（不能引用"本次对话"）。`;
  } else {
    userMessage += `\n\n## 执行步骤

1. 决定目标 claw（已有哪个最合适 / 需要新建）
   - 判断依据：上下文效率。如果现有 claw 的对话状态专注于不同的项目或任务域，复用会带入无关上下文，应新建 claw
   - Claw 的能力（dispatch-skills、分析模式）可以安装复制，上下文不该混用
   - 先用 \`clawforum claw list\` 查看现有 claw——输出含各 claw 最近契约标题（Last Contract 列），据此判断任务域是否匹配，再决定复用还是新建
   - Claw 名称只是标签，不代表能力专属，不要根据名称推断适用任务域
2. 如需新建 claw：直接用工具新建并启动 daemon：
   - exec: clawforum claw create <name> 
   - exec: clawforum claw daemon <name> 
3. 为该 claw 安装所需技能：直接用工具完成（exec: clawforum skill install --claw <id> --skill <name>）
4. 在最终回复末尾输出以下块，用于发起子代理给targetClaw创建契约（必须，格式不可变）：

[SPAWN_REQUEST]
{"targetClaw":"<clawId>","prompt":"<给契约创建子代理的完整 prompt>"}
[/SPAWN_REQUEST]

**targetClaw 规则**：必须是 claw id（kebab-case）。
不能是 UUID、不能是 taskId。
如需新建 claw，先用 \`clawforum claw create <name>\` 创建，确认成功后再填入该 claw 的 id。

**prompt 写法**：这是给"契约设计者"的指令，不是给"任务执行者"的。
契约创建子代理的工作是：设计契约 YAML、写验收文件，并通过 clawforum contract create --dir 提交。
prompt 里应说明：
- 目标 claw 是哪个
- 要完成什么任务（由该 claw 执行，不是子代理本人执行）
- 期望的 deliverables（路径）和验收标准

示例：
"为 openclaw-explorer claw 创建契约，任务是探索 OpenClaw 的 Gateway/Docker/Config 模块并生成报告到 clawspace/deep-analysis.md，验收标准：该文件存在且包含各模块分析。"

不要把"执行任务"的 prompt 放进去（子代理不会去做实际工作）。
契约创建子代理没有任何上下文，prompt 必须自包含（不能引用"本次对话"）。`;
  }

  return userMessage;
}
