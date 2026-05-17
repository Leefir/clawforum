---
name: project_phase947_d_fork_done_in_full_profile_m2_smell
description: r118 D fork phase 947 — gap.3 DONE in 'full' profile M#2 design smell 三候选 derive + dominant α 主会话自决 + code 实施（profiles.ts 删 DONE + NEW reverse test）
type: project
---

# phase 947 r118 D fork — gap.3 DONE in 'full' profile M#2 smell α 实施

- 起步 commit: `6e9bf8b5`
- 类型: design + code Step A+B（主会话 own per `feedback_design_closure_single_step_a` + `feedback_business_decision_phase_user_ratify`）
- 主题: audit-2026-05-15 gap.3 + phase 786 P0.14 root cause M#2 错位（跨 ~160 phase defer 至本 phase ratify + code 落地）

## 实测

### TOOL_PROFILES 当前 (profiles.ts:51-55)

仅 2 profile：
- `full` (15 tools 含 DONE) — motion + claw 主代理走此 profile (system.ts:589)
- `subagent` (11 tools 含 DONE) — subagent / shadow 子代理走此 profile

**shadow profile 不存在**（既有 row α 候选 framing 过时）。

### DONE 业务语义

- DONE = subagent submit-subtask hard-stop 协议（phase 765 立 mechanism + ctx.capturedResult 写入）
- main motion 走 contract 流程经 submit_subtask、**不应 own DONE 协议**
- `full` profile 含 DONE = M#2 微违 (业务语义错位)

### phase 786 防御实效

- per-turn `stopRequested` reset 防 LLM 误调 DONE 后 sticky stop
- 0 production incident post phase 786
- 治症状不治根因 (profile 错配仍存)

### 28 原则 derive

dominant α 10 维度 9 +ve / β 4 +ve 含 workaround smell / γ 4 +ve 含多维 -ve。

## 改动

- l2_tools.md §B 既有 `B.X` row 状态升 closed by phase 947 Step B + framing reframe (shadow profile 不存在) + 5 升档条件
- `src/foundation/tools/profiles.ts:53` 删 `DONE_TOOL_NAME` from `full` profile array（14 tools）
- NEW `tests/foundation/tools/profiles-done-not-in-full.test.ts` reverse test 3 assertion
- phase 786 per-turn `stopRequested` reset 防御保留（defense-in-depth）
- 本 memory file NEW + MEMORY.md row
- **0 architecture.md / 0 audit report 改**

## status

- α-rm-DONE-from-full ✅ closed by phase 947 Step B（主会话 dominant α 自决 + code 落地）
- β-保现状 rejected（ML#2 + ML#8 + ML#9 三违反 + workaround smell）
- γ-DISTINCT-main-sub-DONE **deferred-pending-user-ratify**（多 phase 大改造 + 反 phase 765 mechanism）

## α 实施详

- `profiles.ts:53` 删 `DONE_TOOL_NAME` from `full` profile array (1 行改)
- 行为变更：main motion LLM 不再 advertise DONE 工具
- C2 LLM cache miss 一次性（acceptable per phase 801 模板）
- LLM-trained prompt expectation 可能 unstable（可接受、LLMs 跟 tool advertise 不跟 training）

## γ 候选详（推 user 备拍板）

- DONE_TOOL_NAME split 为 MAIN_DONE_TOOL_NAME + SUB_DONE_TOOL_NAME 语义分
- 各 profile own 各 const
- tool registry + capturedResult mechanism + contract path 全栈 cascade
- 多 phase 跨 round 大改造

## 升档条件登记 (α → γ trigger)

- (a) phase 786 reset 防御失效 → 重新评估 profile 边界
- (b) main motion LLM hallucinate-call DONE 触发 production incident → 紧急回滚或升 γ
- (c) NEW main agent profile 加入 N≥1 含 DONE → cluster 升 reframe γ
- (d) phase 765 capturedResult mechanism 重设计 cluster phase 触发 → 一并 γ
- (e) `feedback_audit_rediscovery_sister_phase_closed` cross-check 防 sub-agent re-flag (mirror phase 906 + 916 + 938 + 本 phase = 4 site cluster 模板累达 N=4)

## 副发现

1. **design row 跨 ~160 phase defer framing reframe 需要** N=1 首发：既有 row B.X 立时 α 候选「仅留 subagent + shadow profile」、跨 ~160 phase defer 至本 phase 时 `shadow profile` 不存在 (要么立时计划未实施、要么 row 起草误)。推 r+1 同型 (row 跨 N phase defer framing 重审) N≥2 → Tier 3 候选「design row 跨多 phase defer 后 framing 重审 SOP (row 更新时必 Path #1 实测 framing 是否 stale)」

2. **β ⚓ accepted-stable 模板「sub-agent re-flag 反 防御」N+1 累达 N=4**：mirror phase 906 viewport-pid-tolerated + phase 916 sync-exitcode + phase 938 skill-install-traversal + 本 phase = 4 site cross-check re-flag 模板 cluster 累。N=4 累达推 r+1 升 Tier 2 candidate「β ⚓ accepted-stable row 显式登记 sub-agent re-flag 防御 SOP」（phase 938 推 r+1 升 Tier 2 候选已立、本 phase N+1 累加强信号）

3. **跨 N phase defer 后真业务决策 ratify 模板** N=1 首发：既有 row 立时标「推 phase 787+ ratify」、实然跨 ~160 phase defer 至 phase 947 才 ratify + code 落地。推 r+1 同型 (row 内显式标「推 phase N+ ratify」是否真兑现追踪) N≥2 → Tier 3 候选「design row 显式 N+K phase 兑现追踪 SOP」

## 反向验证

```bash
grep -nE "phase 947|closed by phase 947" design/modules/l2_tools.md  # ≥1 hit
ls memory/project_phase947_d_fork_done_in_full_profile_m2_smell.md  # exists
grep -n "phase 947" memory/MEMORY.md  # ≥1 hit
grep -nE "DONE_TOOL_NAME" src/foundation/tools/profiles.ts  # 期望 line 55 仅 subagent 1 hit
npx tsc --noEmit  # 0 error
npx vitest run tests/foundation/tools/profiles-done-not-in-full.test.ts  # PASS
```

3 grep + 2 test hit 即 phase 947 pass。
