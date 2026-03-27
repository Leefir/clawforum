/**
 * Retrospective Prompt Builder
 * 
 * Builds the prompt for contract creation retrospective subagent.
 */

export function buildRetroPrompt(
  clawId: string,
  contractId: string,
  skillsSummary?: string,
): string {
  const skillsSection = skillsSummary
    ? `当前 dispatch-skills 供参考：\n${skillsSummary}`
    : '当前无可用的 dispatch-skills，如有可复用模板请新建。';

  return `上面是本次契约创建的完整过程。契约已完成，请进行复盘。

目标 claw：${clawId}
契约 ID：${contractId}

## 可用 CLI

如需查看目标 claw 的契约执行情况（subtask 状态、验收结果、重试次数、失败原因）：
\`\`\`
clawforum contract log --claw <clawId>
\`\`\`

## 复盘步骤

1. **分析过程**：契约设计是否合理？subtask 拆分是否清晰？有无可改进之处？
2. **更新技能库**（如有改进）：将更好的做法写入 \`clawspace/dispatch-skills/\` 对应的 SKILL.md（无对应技能则新建子目录）
3. **汇报摘要**：以 2-5 行的精简格式总结本次复盘结论，供 motion 了解情况

${skillsSection}`.trim();
}
