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
你是由 Motion 通过 \`dispatch\` 启动的 Dispatcher。
- 不能再调用 \`dispatch\`（递归防护）
- 不能调用 \`spawn\`（会报错）
`;

  userMessage += `\n## 本次目标\n${goal}`;

  if (skillsSummary) {
    userMessage += `\n\n${skillsSummary}`;
  }

  userMessage += `\n\n## 第一阶段：思考（在任何工具调用之前完成）

请先在回复里写出以下推理，不要跳过：

**用户意图（background）**
为什么要做这件事？与具体行动无关的动机和背景。

**任务目标（goal）**
要完成什么？（可直接引用本次目标）

**全局要求与质量期望（expectations）**
用户的约束和偏好（显性的 + 推断的）、成果质量标准、预期产出路径（如有）。
不要遗漏用户在对话里表达过的要求。

**子任务拆分**
拆成哪几个子任务？每个子任务做什么、产出到 clawspace/<contract-slug>/ 哪个路径？

**目标 claw**`;

  if (targetClaw) {
    userMessage += `\n目标 claw 已由用户指定：**${targetClaw}**，直接使用，无需判断。`;
  } else {
    userMessage += `\n先用 \`clawforum claw list\` 查现有 claw，判断复用还是新建。
- 判断依据：上下文效率，不根据 claw 名称推断能力
- 如果现有 claw 的对话状态专注于不同的项目或任务域，复用会带入无关上下文，应新建 claw
- Claw 的能力可以安装复制，上下文不该混用
- 如需新建：\`clawforum claw create <name> && clawforum claw daemon <name>\`
- **targetClaw 必须是 claw id（kebab-case）**，不能是 UUID 或 taskId`;
  }

  userMessage += `\n
**dispatch-skills**
根据任务判断是否需要安装 dispatch-skills（\`exec: clawforum skill install --claw <id> --skill <name>\`）。

## 第二阶段：创建契约

第一阶段推理完成后，执行以下步骤：

1. **加载 clawforum-guide skill 查契约 YAML 格式和验收写法**：
   \`skill({ name: "clawforum-guide" })\`

2. **在 clawspace/contract-drafts/<contract-slug>/ 下写契约文件**：
   - contract.yaml（含 background、goal、expectations、subtasks、acceptance、escalation）
   - acceptance/<subtask-id>.sh 或 acceptance/<subtask-id>.prompt.txt

3. **提交契约**：
   \`exec: clawforum contract create --claw <targetClawId> --dir clawspace/contract-drafts/<contract-slug>\`

4. **在最终回复末尾输出（格式不可变，供系统解析）**：

\`\`\`
[CONTRACT_DONE]{"contractId":"<id>","targetClaw":"<claw-id>"}[/CONTRACT_DONE]
\`\`\`

---

### background / expectations 写法指引

- **background**：用户意图，与具体行动无关的动机和背景。从对话上下文综合提炼，不是对任务的描述。
- **expectations**：全局执行要求和质量期望，适用于所有子任务。包含：用户约束和偏好（显性 + 推断）、成果质量标准、预期产出路径（如有交付物）。`;

  return userMessage;
}
