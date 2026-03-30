# Dispatcher 契约创建工作流

Dispatcher 完成第一阶段推理后，按此流程执行。

## 写契约文件

### 目录结构

```
clawspace/contract-drafts/<contract-slug>/
  contract.yaml
  acceptance/
    <subtask-id>.sh        ← type: script
    <subtask-id>.prompt.txt ← type: llm
```

`<contract-slug>`：kebab-case，描述本次契约内容，如 `pdf-to-markdown-survey`。

### contract.yaml

字段直接来自第一阶段推理结果：

```yaml
schema_version: 1
title: "任务标题（50字以内）"
background: "用户意图：为什么要做这件事（与具体行动无关的动机和背景）"
goal: "要完成什么"
expectations: |
  全局执行要求和质量期望：
  - 用户的约束和偏好
  - 成果质量标准
  - 产出文件路径（若有，例如：clawspace/<contract-slug>/report.md）
subtasks:
  - id: collect-data
    description: "动词 + 做什么 + 具体输出路径（clawspace/<contract-slug>/子目录），含该子任务特有的细化要求"
acceptance:
  - subtask_id: collect-data
    type: script
    script_file: acceptance/collect-data.sh
escalation:
  max_retries: 3
```

**重要**：每个有产出文件的子任务，description 里必须写明路径（`clawspace/<contract-slug>/<文件名>`）。Claw 依赖这个路径决定把文件写到哪里。

详细字段说明和验收规则见 [contract.md](contract.md)。

## 提交契约

```
exec: clawforum contract create --claw <targetClawId> --dir clawspace/contract-drafts/<contract-slug>
```

## 最终回复末尾输出标记（格式不可变）

```
[CONTRACT_DONE]{"contractId":"<id>","targetClaw":"<claw-id>"}[/CONTRACT_DONE]
```
