/**
 * Dispatcher User Message Builder
 * 
 * Builds the user message for dispatcher subagent.
 */

export function buildDispatcherUserMessage(
  goal: string,
  skillsSummary?: string,
  targetClaw?: string,
): string {
  let userMessage = `---
你是由 Motion 通过 \`dispatch\` 启动的 Dispatcher，以上为 Motion 的对话历史。对话历史仅供参考背景，本次任务为独立任务，你不在这个会话中。
- 你的任务是根据本次目标和对话历史，进行推理和执行两个阶段，最终完成契约创建，返回[CONTRACT_DONE]{"contractId":"<id>","targetClaw":"<claw-id>"}[/CONTRACT_DONE]
- 不能再调用 \`dispatch\`（递归防护）
- 不能调用 \`spawn\`（会报错）
`;

  userMessage += `\n## 本次目标\n${goal}`;

  if (skillsSummary) {
    userMessage += `\n\n${skillsSummary}`;
  }

  userMessage += `\n\n## 第一阶段：推理

请先进行以下推理：

**用户意图（background）**
为什么要做这件事？与具体行动无关的动机和背景。

**任务目标（goal）**
要完成什么？（可直接引用本次目标）

**全局要求与质量期望（expectations）**
用户的约束和偏好（显性的 + 推断的）、成果质量标准、预期产出路径（如有）。
不要遗漏用户在对话里表达过的要求。

**子任务拆分**
拆成哪几个子任务？每个子任务做什么、产出到 clawspace/<contract-slug>/ 哪个路径？

## 第二阶段：执行

推理完成后，按顺序执行：

### 1. 确定目标 claw`;

  if (targetClaw) {
    userMessage += `
目标 claw 已由用户指定：**${targetClaw}**，直接使用。`;
  } else {
    userMessage += `
用 \`clawforum claw list\` 查现有 claw，判断复用还是新建：
- 判断依据：上下文效率，不根据 claw 名称推断能力
- 如果现有 claw 的对话状态专注于不同的项目或任务域，应新建 claw
- 如需新建：
  exec: clawforum claw create <name>
  exec: clawforum claw daemon <name>
- targetClaw 必须是 claw id（kebab-case），不能是 UUID 或 taskId`;
  }

  userMessage += `

### 2. 安装 dispatch-skills（如需要）
exec: clawforum skill install --claw <id> --skill <name>

### 3. 加载 clawforum-guide skill，然后读 dispatcher-workflow.md
skill({ name: "clawforum-guide" })
read({ path: "skills/clawforum-guide/references/dispatcher-workflow.md" })

### 4. 写契约文件
clawspace/contract-drafts/<contract-slug>/contract.yaml（含 background、goal、expectations、subtasks、acceptance、escalation）
clawspace/contract-drafts/<contract-slug>/acceptance/<subtask-id>.sh 或 .prompt.txt

### 5. 提交契约
exec: clawforum contract create --claw <targetClawId> --dir clawspace/contract-drafts/<contract-slug>

### 6. 在最终回复末尾输出（格式不可变）
\`\`\`
[CONTRACT_DONE]{"contractId":"<id>","targetClaw":"<claw-id>"}[/CONTRACT_DONE]
\`\`\`

---

### background / expectations 写法指引

- **background**：用户意图，与具体行动无关的动机和背景。从对话上下文综合提炼，不是对任务的描述。
- **expectations**：全局执行要求和质量期望，适用于所有子任务。包含：用户约束和偏好（显性 + 推断）、成果质量标准、预期产出路径（如有交付物）。`;

  return userMessage;
}
