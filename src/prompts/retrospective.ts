/**
 * Retrospective Prompt Builder
 *
 * Builds the prompt for contract retrospective subagent.
 */

export function buildRetroPrompt(
  clawId: string,
  contractId: string,
  skillsSummary?: string,
): string {
  const skillsSection = skillsSummary
    ? `## 现有 dispatch-skills（供参考，避免重复）

${skillsSummary}`
    : '';

  return `上面是本次契约创建的完整过程（包含创建者的原始意图和契约设计）。契约已执行完成，请对本次执行进行复盘。

目标 claw：${clawId}
契约 ID：${contractId}

---

## 复盘步骤

### 第一步：读取执行结果

\`\`\`
clawforum contract log --claw ${clawId}
\`\`\`

查看各 subtask 的最终状态、重试次数、失败原因、验收 evidence。

### 第二步：还原工作过程

\`\`\`
clawforum claw trace --claw ${clawId} --contract ${contractId}
\`\`\`

阅读 claw 的完整工作过程（多轮执行，步骤编号 #1, #2, ...）。
如需某步骤详情：

\`\`\`
clawforum claw trace --claw ${clawId} --contract ${contractId} --step <n>
\`\`\`

### 第三步：评估执行质量

结合上下文中的契约创建意图，判断：
- 哪些 subtask 执行顺利？哪些多次重试？失败根因是什么？
- claw 的工作方式是否高效？有无明显浪费或绕路？
- 契约设计本身是否给执行造成了障碍？

### 第四步：提炼 dispatch-skill（如有）

如果本次执行中发现了值得复用的工作模式（对同类任务有指导价值），使用 skill-creator 技能将其写入 dispatch-skills：

\`\`\`
skill({ name: "skill-creator" })
\`\`\`

skill-creator 会引导你完成 SKILL.md 的结构化写入，输出到 \`clawspace/dispatch-skills/<skill-name>/\`。

如果执行质量正常、没有特别值得提炼的经验，**不需要**强行写 skill。

### 第五步：返回复盘摘要

以 3-6 行精简格式总结：
- 执行结果（通过/失败，重试情况）
- 关键发现（执行质量、根因）
- 是否写入了新 skill（若有，说明 skill 名称和内容方向）

${skillsSection}`.trim();
}
