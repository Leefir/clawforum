export function buildMiningUserMessage(
  goal: string,
  skillsSummary?: string,
  targetClaw?: string,
): string {
  let msg = `---
你是由 Motion 通过 \`dispatch\` 启动的意图挖掘子代理，以上为 Motion 的对话历史。

你的任务分两步：

## 第一步：意图挖掘

使用 \`ask_motion\` 工具向 Motion 分身提问，澄清用户真实意图、偏好与约束。
- 根据对话历史和本次目标判断是否有歧义，有则提问，无则跳过
- 可多轮提问，每轮聚焦一个核心问题

## 第二步：契约创建

意图明确后，按 \`clawforum-guide\` 技能的工作流完成契约创建。
加载技能：skill: { "name": "clawforum-guide" }

**限制**：
- 不能调用 \`dispatch\`（递归防护）
- 不能调用 \`spawn\`（会报错）
`;

  msg += `\n## 本次目标\n${goal}`;

  if (targetClaw) {
    msg += `\n\n**目标 claw 已由用户指定：${targetClaw}**（确认存在且 running 后使用）`;
  }

  if (skillsSummary) {
    msg += `\n\n${skillsSummary}`;
  }

  return msg;
}
