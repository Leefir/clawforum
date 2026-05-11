---
name: phase 740 magic 字面值 cluster cleanup N+1（contract dir + UUID_SHORT_LEN + AUDIT_MESSAGE_MAX_CHARS）
description: 25 site 3 类常量提取 / 既有 paths.ts + constants.ts 设施扩 / 0 行为差 / cluster 模板 mirror phase 651/652/657
type: project
---

phase 740 r? B fork：用户「写死常量审计」要求 → Explore agent 全栈扫驱动 → 3 真候选浮出 → 6 step land（A analysis + B-E src + F cohesion）。

## 核心增量

- `src/types/paths.ts` +3 NEW const：CONTRACT_ACTIVE_DIR / CONTRACT_PAUSED_DIR / CONTRACT_ARCHIVE_DIR
- `src/constants.ts` +2 NEW const：UUID_SHORT_LEN = 8 / AUDIT_MESSAGE_MAX_CHARS = 200
- 25 site cascade 跨 14 file：
  - contract dir 5 site（manager.ts 3 + start.ts 2）
  - UUID_SHORT_LEN 10 site（manager.ts + sync-backup.ts + dialog-store + audit/writer + 2 inbox-reader + 2 inbox-writer + exec.ts + outbox-writer.ts）
  - AUDIT_MESSAGE_MAX_CHARS 10 site（dispatch-contract-extract + snapshot + spawn + 2 sse-parser + 3 watchdog-state + 2 watchdog）

## 行为差

0（纯 const 提取 + caller cascade、字面值 0 变、tsc string literal type 推同 type）。

## Why

用户审计要求 / Explore agent 全栈扫 3 类 magic 字面值浮出 / 跨 14 file 25 site 重复 / DRY violation。

## How to apply

- contract dir 入 paths.ts（dir 字面 domain / mirror INBOX_PENDING_DIR / TASKS_QUEUES_PENDING_DIR pattern）
- UUID + audit 入 constants.ts（数值 / truncation domain / mirror READ_MAX_LINES / EXEC_MAX_OUTPUT pattern）
- out-of-scope：ls.ts tool description（LLM 文档面）+ markdown skills（不入 src）+ 不同语义 cap（.slice 100/300/500）

## 方法论贡献

1. **「magic 字面值 cluster cleanup」N+1 实证累**（phase 313+380+392+544+605+651+652+655+657+661+740、cluster 11 phase 深度成熟）
2. **「Explore agent 全栈扫驱动 phase」N+1 实证累**（前置 audit + Path #1 实测 + cluster 单 phase land 模板）
3. **「3 类 const 单 phase land」cluster 模板 N+1 实证**（mirror phase 651/652/657 多类 magic 单 phase 治理 / 总难度最小 Path #7）
4. **「主会话 plan + 用户 code 实施」N+1 实证累**（phase 631+637+660+737+738+740 cluster 持续硬化）
5. **「Step 7 节硬结构 + 反向 3 项」N+1 实证累**（phase 740 6 Step 全 7 节 + Step B-E 反向 3 PASS）

## 关联

- 既有 paths.ts + constants.ts：phase 380 + 392 + 544 + 651 + 652 + 657 + 661 cluster 立 + 扩
- Explore agent 驱动：N=1 实证（推 r+1 同型再遇升格独立 feedback）
- commit SHA：step B `<待 commit>` / step C `<待 commit>` / step D `<待 commit>` / step E `<待 commit>` / step F cohesion `<待 commit>`
