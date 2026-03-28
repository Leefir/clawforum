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

## 重要：运行环境

你运行在 motion 进程里。目标 claw（${clawId}）的文件不在你的工作目录下。

读取目标 claw 的文件时，必须使用 read 工具的 \`claw\` 参数：
\`\`\`
{ "path": "clawspace/xxx.md", "claw": "${clawId}" }
\`\`\`

直接用相对路径读（不带 claw 参数）只会读到 motion 自己的文件，不是目标 claw 的。

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

如果本次执行中发现了值得复用的工作模式（对同类任务有指导价值），直接用 write 工具写入 dispatch-skill。

**输出目录**：\`clawspace/dispatch-skills/<skill-name>/\`

#### Skill 结构

\`\`\`
<skill-name>/
├── SKILL.md          必须
├── references/       可选：参考文档（按需加载，适合较长的背景资料）
├── scripts/          可选：可执行脚本（适合需要确定性执行的操作）
└── assets/           可选：模板/静态文件
\`\`\`

dispatch-skill 通常只需要 SKILL.md，只有需要存放较长参考资料时才建 references/。

#### SKILL.md 格式

\`\`\`markdown
---
name: skill-name
description: 这是触发机制——描述该 skill 做什么、何时使用。要具体，包含触发场景示例。
  例："当 claw 需要分析 X 类型任务时使用。适用场景：(1) ... (2) ..."
---

# Skill 标题

## 核心工作流程

（步骤化的工作指南，面向执行该任务的 claw）

## 注意事项

（执行中的关键经验、常见陷阱）
\`\`\`

**规则**：

- frontmatter 只能有 \`name\` 和 \`description\` 两个字段
- \`description\` 是唯一触发判断依据，必须清楚说明适用场景
- body 保持简洁，上下文窗口是共享资源
- 如有较长参考资料，写入 \`references/<topic>.md\` 并在 SKILL.md 中注明路径和加载时机

如果执行质量正常、没有特别值得提炼的经验，**不需要**强行写 skill。

### 第五步：返回复盘摘要

以 3-6 行精简格式总结：
- 执行结果（通过/失败，重试情况）
- 关键发现（执行质量、根因）
- 是否写入了新 skill（若有，说明 skill 名称和内容方向）

${skillsSection}`.trim();
}
