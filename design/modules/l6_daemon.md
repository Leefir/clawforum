# Daemon 接口契约

> 本契约描述 Daemon 模块对其他模块的应然承诺。模块需遵循 Module Logic Principles。
>
> **方法论定位**：冻结契约登记（phase172 / 2026-04-21 / L6a 进程入口）—— 按 `feedback_top_module_freeze_window` / 顶层模块在下层契约未稳时抢跑建立后「冻结 + 未来稳定化 phase」/ §8.A 10/10 全清零（phase191 里程碑）。

## 1. 所有权

### 层级

L6a 进程入口（与 L6a Watchdog / L6b CLI / L6c Assembly 同层 / 「进程生命周期管理」业务语义独立可变 / phase172 L6 首契约）。

### 职责

「进程生命周期管理」—— main 入口 / 信号处理 / 按 Assembly 返回的 Instances 触发 shutdown。装配职责已独立为 Assembly（L6c）/ Daemon 不知被启的模块内部细节 / 只对 Instances 调反向清理。

按生命周期三段：

**启动期**：
- lockfile 单实例保护（写 `status/pid` / 冲突由 Assembly 抛 `LockConflictError`）
- 调 `assemble(config)` 取 `Instances`
- 装后初始化：`daemon_start` audit + snapshot commit（context=daemon-start）
- 装配失败时发 `assemble_failed`（module=runtime / phase=post_assemble_init）后上抛退出

**运行期**：
- `startDaemonLoop(options)` 驱动 Runtime（主路径 processBatch / 中断 abort / 重试 retryLastTurn / 阻塞 waitForInbox）
- review_request 路径已迁 ContractSystem（phase188 / Daemon 仅保留 onInboxMessages 转调）

**关停期**：
- 安装信号 handler（SIGTERM / SIGINT → shutdown 闭包）
- shutdown 调 `disassemble(instances, signal)` 反向拓扑清理
- unlink `status/pid`（pid 匹配时）
- 异常退出 `daemon_crash` audit

不做：
- 不做模块装配（归 Assembly L6c）
- 不做事件循环内部状态（归 Runtime / driver 在 Daemon / state 在 Runtime / `B.p172-1` 登记）
- 不做子代理派发（归 TaskSystem L4）
- 不做审计落盘（归 AuditLog）

### 资源

| 资源 | 类别 | 持久化 |
|---|---|---|
| `<dir>/status/pid` lockfile | 独占 | ✓ 启动写 / 关停删 |
| `process.on('SIGTERM' \| 'SIGINT')` signal handler | 进程级 | — |
| `process.on('uncaughtException')` + `process.on('unhandledRejection')` | 双层兜底（shim + 内层）| — |
| 无内存状态 | — | ✗ instances 是 Assembly 返回不可变引用 |

### 业务语义

- 「进程启动」：`daemonCommand(name)`
- 「事件循环驱动」：`startDaemonLoop(options)` → Runtime（driver 在 Daemon / state 在 Runtime）
- 「inbox 阻塞等待」：`waitForInbox(...)`
- 「进程关停」：`shutdown(signal)` 闭包 + `disassemble`
- 装配「按需」（任何 long-running daemon 进程入口装）

## 2. 接口

### 类型签名

```ts
import type { Instances } from '@/assembly';
import type { ClawRuntime } from '@/core/runtime';
import type { Heartbeat } from '@/core/runtime';
import type { Audit } from '@/foundation/audit';
import type { StreamWriter } from '@/core/stream';
import type { InboxMessage } from '@/foundation/messaging';

export function daemonCommand(name: string): Promise<void>;
// 唯一消费方：src/daemon-entry.ts（进程 main）

export interface DaemonInboxConfig {
  pendingDir: string;
  fallbackTimeoutMs?: number;
}

export interface DaemonMotionExtensions {
  heartbeat?: Heartbeat;
  onInboxMessages?: (messages: InboxMessage[]) => Promise<void>;
}

export interface DaemonLoopOptions {
  // 核心驱动（5 必填平铺）
  runtime: ClawRuntime;
  agentDir: string;
  clawId: string;
  label: string;
  audit: Audit;

  // inbox 配置（必填子组）
  inbox: DaemonInboxConfig;

  // motion 扩展（可选子组 / claw 整体省略）
  motion?: DaemonMotionExtensions;

  // 流式 / 回调（2 平铺可选）
  streamWriter?: StreamWriter;
  onBatchComplete?: () => Promise<void>;
}

export function startDaemonLoop(options: DaemonLoopOptions): {
  promise: Promise<void>;
  stop: () => void;
};

export function waitForInbox(
  fs: FileSystem,
  audit: Audit,
  pendingDir: string,
  fallbackTimeoutMs: number,
): Promise<void>;
```

### 前后置条件

- **daemonCommand**：计算 `dir = clawforumDir/name` / 确保 `status/` 子目录 / 写 pid（冲突上抛 LockConflictError）/ 调 assemble + startDaemonLoop / 注册 4 signal handler / 进程驻留至 shutdown
- **initialize / startDispatch 分离**（Runtime 侧）：Daemon 调 assemble 后调 `runtime.initialize` / 再调 `startDaemonLoop`（不能跨过）
- **DaemonLoopOptions 4 组结构**（phase185 由 11 平铺重构）：核心驱动 + inbox + motion + 流式回调 / motion 子组 claw 省略
- **shutdown idempotent**：再次调不抛 / disassemble 全序继续

### 失败分类

| 场景 | 行为 | 分类 |
|---|---|---|
| LockConflictError | preAssembleAudit `assemble_failed`（module=lockfile / phase=preconstruct）+ 友好提示 + process.exit(1)（phase189 闭环）| 预期失败 |
| 其他 assemble 失败 | preAssembleAudit `assemble_failed`（module=pre_assemble / phase=preconstruct）+ process.exit(1) | 不可预期失败 |
| `runtime.initialize()` 抛错 | auditWriter `assemble_failed`（module=runtime / phase=post_assemble_init）+ process.exit(1) | 不可预期失败 |
| daemon-loop fatal | audit `daemon_loop_fatal` + process.exit(1) | 不可预期失败 |
| LLM error 重试 | audit `daemon_loop_llm_retry`（指数 backoff / max LLM_MAX_RETRIES）+ 继续 | 软失败 |
| interrupt poller 异常 | audit `daemon_loop_interrupt_poller_disabled` + 继续（poller 关闭）| 软失败 |
| uncaughtException / unhandledRejection（运行期）| audit `daemon_crash` + process.exit(1) | 不可预期 |
| uncaughtException / unhandledRejection（shim 极早期）| shimAudit `daemon_uncaught_exception` / `daemon_unhandled_rejection` + console.error + exit（phase189 闭环）| 不可预期 |
| SIGTERM / SIGINT | shutdown 闭包 → disassemble → unlink pid → process.exit(0) | 预期 |

## 3. 审计事件清单

> 应然事件常量集中定义于 `src/daemon/audit-events.ts` `DAEMON_AUDIT_EVENTS`（应然 / 模块自治 / 实然 caller const 引用 / B.p344 ✅ closed phase386）。

daemon.ts 自产事件（5 个 / 含 phase189 复用）：

| 事件 type | 触发位置 | 载荷 |
|---|---|---|
| `daemon_start` | daemonCommand 装后初始化 | `clawId`, `pid` |
| `daemon_crash` | uncaughtException / unhandledRejection（运行期）| `err` |
| `assemble_failed`（载荷特化）| daemon.ts 三分支：lockfile / pre_assemble / post_assemble_init | `module`, `phase`, `reason` |

> **~~B.p344-W drift~~ ✅ closed（phase385 / δ 撤销 / framing 错位）**：实然 2 events 各归各家 / `daemon_started`（ASSEMBLY_AUDIT_EVENTS.DAEMON_STARTED）由 Assembly assemble.ts:521 own / `daemon_start`（ASSEMBLY_AUDIT_EVENTS.DAEMON_START）由 Daemon daemon.ts:108 own（含 prompt hash sha256）/ 2 events 不同语义 / 0 双发。

daemon-loop.ts 自产事件（5 个 / phase173 落地）：

| 事件 type | 触发时机 | 关键载荷 |
|---|---|---|
| `daemon_loop_iteration` | processBatch 完成 / wait 触发 | `type=chain\|wait`, `injected`, `chain_total` |
| `daemon_loop_interrupt` | runtime 抛 IdleTimeout / UserInterrupt / PriorityInbox | `cause=idle_timeout\|user_interrupt\|priority_inbox`, `recovery_delay_ms` |
| `daemon_loop_llm_retry` | LLM error 重试 | `attempt`, `max`, `delay_ms`, `err` |
| `daemon_loop_fatal` | daemon-loop 顶层 catch | `err` |
| `daemon_loop_interrupt_poller_disabled` | poller 异常关闭 | `err_count`, `last_err` |

daemon-entry.ts shim 事件（2 个 / phase189 落地）：

| 事件 type | 触发时机 | 载荷 |
|---|---|---|
| `daemon_uncaught_exception` | shim 层 uncaughtException（极早期 / daemon.ts 未入）| `err` |
| `daemon_unhandled_rejection` | shim 层 unhandledRejection（极早期）| `err` |

保留 console 清单（phase173 + phase189 + phase191 决策 / β/γ / phase372 去行号）：

定位：`grep -nE 'console\.(log|warn|error)' src/daemon/daemon.ts src/daemon/daemon-loop.ts`

| 位置（method/symbol）| 决策 | 理由 |
|---|---|---|
| `daemon.ts` heartbeat 残留清理 catch（`console.warn "Failed to clean up heartbeat files"`）| β 双写保留 | 启动期 best-effort / non-ENOENT 才报 |
| `daemon.ts` shutdown pid 清理 catch（`console.warn "Failed to clean up pid file"`）| β 双写保留 | shutdown 期 best-effort / failure 后 process.exit(0) |
| `daemon.ts` startup banner（`console.log` "${label} Started"）| γ 保留 | console.log 是人眼 checkpoint / `daemon_start` audit 已承载审计语义 |
| `daemon-loop.ts` interrupt poll + LLM error + processBatch error 类（`console.warn` / `console.error`）| γ 保留 | 同型先例 / audit 已承载语义 |

## 4. 层级声明

L6a 进程入口。下游进程入口 `src/daemon-entry.ts` 唯一消费 daemonCommand。上游 Assembly（L6c 同 L6 不同类）+ Runtime（L5）+ L1-L2 基础设施 / 不上引 L6+。

## 5. 上游依赖

| 依赖 | 层级 | 类型化 | 用途 |
|---|---|---|---|
| `Assembly` (`assemble` / `disassemble` / `Instances`) | L6c | direct import | 装配根 / 反向清理 |
| `Runtime` (`ClawRuntime`) | L5 | type + 公共 API（3 方法）| processBatch / abort / retryLastTurn |
| `Heartbeat` | L5 / motion-only | type-only | DaemonMotionExtensions |
| `ProcessManager` | L2 | direct（pid 自管理）| selfWritePid / selfRemovePid（B.p344-V drift 待 §5 同步）|
| `AuditWriter` / `Audit` | L2 | 接口注入 | daemon.ts + daemon-loop 全链路 audit |
| `StreamLog` | L2 | 接口可选注入 | parentStreamLog 镜像 |
| `FileWatcher` | L2 | direct | waitForInbox watch pendingDir |
| `FileSystem` | L1 | 接口注入 | pid 文件 + status/ |
| `oneLine` util | shared utils | direct | string utility（phase203 搬迁）|
| `DEFAULT_MAX_STEPS` / `DEFAULT_MAX_CONCURRENT_TASKS` / `DEFAULT_LLM_IDLE_TIMEOUT_MS` / `LLM_MAX_RETRIES` | constants | const-import | 默认值 + retry 阈值 |
| node 内置（path / fs / fs/promises / crypto）| external | direct | 必需 |

应然不依赖：
- 任何 L6+ 模块（其他 daemon 入口 / Watchdog 互不依赖）
- 业务模块的运行期实例（仅经 Instances 受信注入消费）
- 跨进程通信（lockfile 经 ProcessManager 抽象）

## 6. 不可消除的耦合

| 耦合 | 方向 | 类型化 | 消除路径 / 放弃理由 |
|---|---|---|---|
| Daemon → Assembly | L6a → L6c | direct import | 不消除（Assembly 装配根 / Daemon 是唯一消费方）|
| Daemon → Runtime 公共 API（3 方法）| L6a → L5 | 接口注入 | 不消除（事件循环 driver 接合点 / 收窄至 3 方法 = M#8 最小）|
| driver / state 分离（daemon-loop 驱动 / Runtime 持态）| publisher-subscriber 形态 B | 协议约定 | 不消除（B.p172-1 / Daemon 控制进程生命周期 × 循环节奏 / Runtime 隔离于进程机制 / 为未来 CLI / chat 等非 daemon 入口复用）|
| Instances 结构依赖（Assembly 返回不可变引用）| L6a 解构使用 | readonly 字段集 | 不消除（装配模式必然 / Daemon 是 Instances 主消费方）|
| signal handler 全局进程级 | 进程级副作用 | unloadable | 不消除（L6a 进程入口本质 / 4 handler 不可卸载）|
| DaemonLoopOptions publisher-subscriber 形态 B（phase185 4 组）| Daemon 注入 / daemon-loop 反向 callback | 接口 | B.p172-2 显式登记 / 不消除（driver/state 分离副作用）|
| 双层 handler（shim + 内层）| daemon-entry.ts + daemon.ts | 设计意图 | phase189 闭环 / 双发 audit 区分极早期 vs 运行期崩溃 |

## 7. 持久化

### 磁盘布局

```
<clawforumDir>/<name>/
└── status/
    └── pid              ← Daemon 独占 lockfile / 启动写当前 process.pid / 关停删（pid 匹配时）
```

### 重建语义

- 进程重启 → daemonCommand 写新 pid（冲突由 Assembly LockConflictError 上抛）
- pid 文件即权威 / 进程在 / pid 在 / 进程失活 / 下次启动经 ProcessManager isAlive 自动清理 stale 文件
- 无内存状态 / instances 由 Assembly 重建

## 8. 应然 vs 实然差距登记

> 原则：本节只登记实然 ≠ 应然的 gap（待治理或已治理的历史）+ 偏差 + 历史纪律。当前实然若与应然 align 则不在此登记。

### 8.A 必修违规（含历史已闭环）

**§7.A 10/10 全清零里程碑（phase191 / 4 phase 接力 173+188+189+191）**：

| §A 条 | 类型 | 状态 | 触发情境 |
|---|---|---|---|
| ~~A.1 daemon-loop.ts 370 行运行时零 audit~~ | drift | **已闭环（phase173）** | 集成 5 类 audit（iteration / interrupt / llm_retry / fatal / interrupt_poller_disabled）|
| ~~A.2 console 16 处无 audit 跟进~~ | drift | **已闭环（phase173+188+189+191 / 16→0）** | phase173 daemon-loop 5 处 → 5 audit / phase188 review_request 10 处随代码删 / phase189 启动失败 3 处 audit + console 双写 / phase191 残余 3 处全登记保留运维可见 |
| ~~A.3 assemble 失败路径 audit 覆盖不全~~ | drift | **已闭环（phase189 / `af6f03a`）** | preAssembleAudit 预构造 / LockConflictError + 其他失败均 audit / module/phase 双字段承载 pre/post-assemble 二维状态 |
| ~~A.4a daemonCommand 入口全路径单测~~ | drift | **已闭环（phase174）** | 新建 `tests/cli/daemon-command.test.ts`（378 行 / 11 it）|
| ~~A.4b waitForInbox 无直接单测~~ | drift | **已闭环（phase183 / `37e8bcc`）** | +4 it 三路径 + settled guard / 0 产品代码 |
| ~~A.4c review_request 130 行路径零测试~~ | drift | **已闭环（phase188 / 代码迁 ContractManager）** | review_request 全归 ContractSystem / Daemon 零业务代码需直测 |
| ~~A.4d shutdown 信号处理单测~~ | drift | **已闭环（phase174）** | A4d shutdown signal + crash handler 4 it |
| ~~A.5 DaemonLoopOptions 11 字段超阈值~~ | drift | **已闭环（phase185 / `79c2a9c`）** | 11 平铺 → 4 组结构（核心驱动 5 + inbox 子组 + motion 子组 + 流式 2）/ 顶层 visible 9 |
| ~~A.6 review_request `new SkillRegistry` 临时实例化~~ | drift | **已闭环（phase177 / `91e8f64`）** | daemon.ts:179 → `createSkillRegistry` 工厂调用 |
| ~~A.7 daemon-entry shim 双层 handler audit 缺口~~ | drift | **已闭环（phase189 / `af6f03a`）** | shimAudit 预构造 / 双层 handler 共存 + 双发 audit / `daemon_uncaught_exception` + `daemon_unhandled_rejection` 新 audit type |

### 8.B 偏差登记（应然 silent / 实然采选 / 升档条件）

| §B 条 | 偏差性质 | 升档条件 |
|---|---|---|
| B.p172-1 driver / state 分离（daemon-loop 驱动 / Runtime 持态）| design-gap / 冻结期判定 | open（保留）| Daemon 控制进程生命周期 × 循环节奏 / Runtime 隔离于进程机制（为未来 CLI / chat 复用）。升档：driver 行为依赖 state 内部细节 / Runtime 内部状态改动波及 daemon-loop 测试 → 转 §A |
| B.p172-2 DaemonLoopOptions publisher-subscriber 形态 B | design-gap | open（保留 / phase185 重构后）| 顶层 9 字段（5 核心平铺 + inbox 必填子组 + motion? 可选子组 + 2 平铺可选）/ phase238 确认仍保留（MotionExtensions 2 字段 < 5 阈值 / 无 non-motion caller）。升档：子组字段数增至 5+ / motion 子组出现 non-motion caller |
| ~~B.p172-3 review_request 跨模块编排归属迁移~~ | drift | **已闭环（phase188 4/4 完成）** | 链路：phase174 契约 / phase175 实装 / phase184 切换 / phase188 清理 / 全归 ContractManager.handleReviewRequest |
| B.p172-4 字面量未抽常量（轻度）| drift / 低 | open / 合 phase169 B.p169-2 同期细化 | `'clawspace/dispatch-skills'`（contract/manager.ts:1411 + dispatch.ts:65 = 2 处 / < 3 处升档阈值）/ `'by-contract'`（contract/manager.ts:1334 1 处）/ 升档：≥ 3 处或 typo 导致 runtime bug |
| ~~B.p344-W daemon_started 归属错配~~ | ~~drift~~ | **✅ closed（phase385 / δ 撤销 / dispatch framing 错位第 9 案）** | **0 真违反 / 实然 2 events 各归各家**：`daemon_started` (with -ed) = ASSEMBLY_AUDIT_EVENTS.DAEMON_STARTED / Assembly assemble.ts:521 own / `daemon_start` = ASSEMBLY_AUDIT_EVENTS.DAEMON_START / Daemon daemon.ts:108 own（含 prompt hash sha256）/ drift 原 framing 把两 events 混为一谈推「双发 / 应移除 daemon_start」错位 / 释义豁免模板第 8 次复用 |
| ~~B.p344-V ProcessManager 调用未在 §5 登记~~ | ~~drift~~ | **✅ closed（phase385 / 应然 stale 同步条款第 5 次 / 已应用）** | r42 D fork 新发现 / 本契约 §5 已补 ProcessManager direct（line 189）/ 应然描述与实然 align |
| ~~B.p344-Z assembly audit event 字符串硬编码（继承）~~ | ~~drift~~ | **✅ closed phase386**（main `<MERGE_SHA>`）| NEW src/daemon/audit-events.ts (DAEMON_AUDIT_EVENTS / 6 events) / daemon.ts 2 caller + daemon-loop.ts 7 caller 改 const ref / LOOP_ITERATION + LOOP_INTERRUPT 单 const + payload 区分（行为契约 0 改）|

### 8.C 应然原则对照

> 仅列应然对各原则的承诺立场 / 不写「合规✓」claims。

**Module Logic Principles**

- M#1 独立可变职责：Daemon 职责 = 进程生命周期（启动 / 关停 / 信号）/ 变更源（启停策略 / 信号语义 / lockfile 机制）与 L5 Runtime 事件循环不同
- M#2 业务语义归属：启动 / 关停由本模块发起 / daemon-loop 事件循环 driver 在 Daemon / state 在 Runtime（B.p172-1 灰度登记）
- M#3 资源唯一归属：status/pid lockfile + process signal handler 归本模块独占
- M#4 持久化：lockfile 磁盘即权威 / instances 是 Assembly 不可变引用
- M#5 依赖单向：Daemon → Assembly / Runtime / SkillSystem / ContractSystem / 无上行 / 无循环
- M#6 依赖结构稳定：启动期 assemble 一次性注入 Instances / 运行期 readonly
- M#7 耦合界面稳定：DaemonLoopOptions 4 组结构（phase185）/ StreamCallbacks 结构较大保留
- M#8 耦合界面最小：daemonCommand(name) 单参最小 / DaemonLoopOptions 顶层 9 字段（5 平铺 + 2 子组 + 2 可选平铺）≤ 8 阈值软合规 / daemon-loop 对 Runtime 仅调 3 方法
- M#9 显式编译器可检：TypeScript 强类型贯穿 / DaemonLoopOptions / Instances 接口强制 / B.p344-Z caller 字符串硬编码暂违反
- M#10 不合理停下：phase172 冻结决策 / 不强行重构 / phase173+188+189+191 接力清零 §7.A
- M#11 边界对不上停下：A.1-A.7 显式登记 + 接力清零 / B.p172-1/2/3/4 显式登记

**Design Principles**

- D1a 信息不丢失：phase191 §A.2 16→0 闭环 / 3 处 β/γ 保留 console 属运维可见非信息丢弃
- D1b 状态可观察：phase173 装配期 audit + daemon-loop 5 事件覆盖 batch / interrupt / retry / fatal / poller_disabled 全维度
- D1c 中断可恢复：SIGTERM/SIGINT 触发 disassemble / 按拓扑反向清理
- D1d 事后可审计：§7.A 10/10 全清零 / phase177/183/185/188/189/191 接力 / 所有路径 audit 留痕
- D2 不丢弃 / 静默：phase173 daemon-loop 清零 / phase191 16→0 闭环 / 3 处保留 console 属运维可见
- D3 用户可观察：console 输出 + Runtime stream callbacks 传达
- D4 LLM 调用恢复：daemon-loop LLM error retry（指数 backoff / max LLM_MAX_RETRIES）+ phase173 daemon_loop_llm_retry audit
- D5 日志重建：daemon-loop 5 事件 + review_request 链路 phase188 归 ContractSystem + LockConflictError phase189 preAssembleAudit + §A.2 phase191 / 完整 daemon 轨迹可从 audit.tsv 重建
- D6 智能体决策主体：无关（Daemon 是基础设施）
- D7 系统可信路径：Assembly / Runtime 经受信注入消费
- D8 事件驱动：daemon-loop 用 inbox watcher + timeout 组合实现事件驱动（waitForInbox）
- D9 多 claw 不隔绝：同一 daemonCommand 支持 motion + claw 两身份
- D10 motion 特殊：motion 走 review_request（已迁 ContractSystem）+ heartbeat（motion-only 字段）
- D11 CLI 唯一对外：Daemon 经 daemon-entry.ts 作为进程 main / 与 CLI 其他 command 共享 `src/cli/commands/`

**Philosophy**

- P1 Agent 即目录：name 参数决定 agent 目录（dir = path.join(clawforumDir, name)）
- P3 多 agent 利用：同一 daemonCommand 支持 motion + claw 两身份
- P4 系统为智能体服务：提供进程常驻 + 信号处理 + review_request 编排（已迁 ContractSystem）基础设施

**Path Principles**

- Path #1 实然为唯一基准：phase173/188/189/191/240/224 各 phase 起步 Path #1 复核 / 多次推翻或验证
- Path #3 语义最小变更：§7.A 10/10 全清零分 4 phase 接力 / 每 phase 单一 scope
- Path #6 冲突立即中断：phase172 冻结期决策 / 不强行重构 / phase173 §7.A3/A7 事实漏核纠正 / phase174 §7.A4a 文件名误登纠正 / phase169 C1 形态变种 3 次升格
- Path #8 总难度最低：A1 等大条分 phase 消化 / 不堆
- 反向测试：本模块可独立替换 Runtime / Assembly 实现而不动 daemon-entry —— M#1 ✓

### 8.D 历史纪律

- 2026-04-21 / phase172 L6a Daemon 冻结契约首次登记（顶层模块抢跑期 / 方法论：feedback_top_module_freeze_window）
- 2026-04-21 / phase173 §7.A1 + §7.A2（部分）清零（daemon-loop 5 audit 集成）/ §7.A3+A7 事实漏核纠正（phase169 C1 形态变种第 1 次）
- 2026-04-21 / phase174 §7.A4a + §7.A4d 清零（daemon-command.test.ts 11 it）/ phase169 C1 形态变种第 2 次（daemon.test.ts 文件名误登纠正）/ Path Principles 落地动作 phase169 C1 形态变种第 3 次升格 feedback
- 2026-04-21 / phase175 ContractManager.handleReviewRequest 实装（B.p172-3 链路第 2 步）
- 2026-04-21 / phase177 §7.A6 清零（daemon.ts:179 → createSkillRegistry 工厂）
- 2026-04-21 / phase183 §7.A4b 清零（waitForInbox 4 it 直测）
- 2026-04-21 / phase184 Daemon onInboxMessages 切换（B.p172-3 链路第 3 步 / 非破坏性 + 旧代码 gate 短路）
- 2026-04-21 / phase185 §7.A5 清零（DaemonLoopOptions 11 → 4 组结构）
- 2026-04-21 / phase188 §7.A4c 清零 + B.p172-3 链路第 4 步（review_request 全归 ContractSystem / daemon.ts -124 行 / §2.5 / §5.5 整章删）
- 2026-04-21 / phase189 §7.A3 + §7.A7 同根同治清零（preAssembleAudit + shimAudit + 4 module/phase 双字段 + 双层 handler 双发 audit）
- 2026-04-22 / phase191 §7.A2 16→0 闭环里程碑（残余 3 处 β/β/γ 保留 console 决策）/ §7.A 10/10 全清零里程碑达成
- 2026-04-26 / r42 D 结构合规修（29→32 补 Path 6 / phase188+189+191 集中收官）
- 2026-04-27 / r42 D fork 新发现：B.p344-W daemon_started 归属错配 + B.p344-V ProcessManager 调用未登记 + B.p344-Z caller 字符串硬编码（推 r43+ 应然同步）

### 8.E 关键决策映射（modules.md 引用）

| KD | 描述 | 一致性 |
|---|---|---|
| KD#15 | Assembly 是装配汇聚点 / Daemon 只做进程生命周期 | ✓ phase188 review_request 迁出 / Daemon 零装配业务代码 |
| KD#23 | 装配职责三分（Assembly + Daemon + Runtime）| ✓ phase188 / Daemon 仅持进程生命周期 |
| KD（B.p172-3 链路）| review_request 归 ContractSystem | ✓ phase174→phase175→phase184→phase188 4 步链路闭环 |

## 9. 测试覆盖

应然行为（不绑定具体测试文件路径）：

- **daemonCommand 启动期 7 路径**：assemble 成功（claw + motion）/ LockConflictError / 其他 assemble 失败 / runtime.initialize 失败 / snapshot uncategorized / snapshot rejection
- **shutdown 信号处理 4 路径**：SIGTERM / SIGINT → shutdown 闭包 → disassemble → pid unlink → process.exit(0)
- **crash handler 4 路径**：uncaughtException / unhandledRejection（运行期）→ writeCrash → daemon_crash audit → process.exit(1)
- **shim 极早期 handler**（phase189 闭环）：shimAudit 双发 audit + 构造失败 fallback + write 抛静默 / `daemon_uncaught_exception` + `daemon_unhandled_rejection`
- **waitForInbox 三路径 + settled guard**（phase183）：新文件到达 / 超时 / ensureDirSync 抛错 / settled guard close 只调一次
- **DaemonLoopOptions 4 组结构**（phase185）：顶层 9 字段 + inbox 必填子组 + motion 可选子组（claw 整体省略）
- **driver / state 分离**（B.p172-1）：daemon-loop 调 runtime.processBatch / runtime.abort / runtime.retryLastTurn 3 方法 / 不消费 Runtime 内部状态
- **daemon-loop 5 audit 事件回链**（phase173）：daemon_loop_iteration / daemon_loop_interrupt / daemon_loop_llm_retry / daemon_loop_fatal / daemon_loop_interrupt_poller_disabled
- **assemble 失败 audit 双轨**（phase189）：preAssembleAudit（pre_assemble 阶段）+ auditWriter（post_assemble 阶段）/ module + phase 双字段
- **review_request 路径**（phase188 后）：onInboxMessages → ContractManager.handleReviewRequest 转调（happy / 非 review_request / 多条 / ctx 字段断言）
- **β 双写 console 保留 3 处**（phase191）：heartbeat 清理失败 / pid 清理失败 / `${label} Started` console.log
- **lockfile 单实例**：写 status/pid（冲突 LockConflictError 上抛）/ 关停删（pid 匹配时）
- **审计回链**：每个 §3 daemon_* + assemble_failed 事件触发时机 + 载荷断言（B.p344-Z 治理后补 caller const 引用）
