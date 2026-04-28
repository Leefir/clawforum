# Assembly 接口契约

> 本契约描述 Assembly 模块对其他模块的应然承诺。模块需遵循 Module Logic Principles。

## 1. 所有权

### 层级

L6c 装配（与 L6a Daemon / L6a Watchdog / L6b CLI 同层 / 「装配模块图」业务语义独立可变 / 装配根 / 在所有 L1-L5 之上）。

### 职责

「模块装配根」—— 按 identity（motion / claw）配置分支决定启哪些模块 / 调各模块 setup 函数 / 注入跨模块回调 / 返回 readonly Instances 句柄集给 Daemon / 关停时按依赖拓扑反向调各模块 close/stop。Assembly 会随模块数量增加而变大 / 但对外耦合界面恒定为「装配 + 反向清理」两动作 / 外部模块增减不影响调用方。

不做：
- 不做模块**内部初始化**（`init()` / `loadAll()` / `archive()` 等归各模块自身业务语义 / 由 createX 工厂内部完成）
- 不做 Runtime 业务动作（session repair / resumeContractIfPaused 由 Daemon 调）
- 不做错误回滚（构造途中失败抛错 / 由 Daemon catch + process.exit / OS 回收资源 / 不调 disassemble 回滚）
- 不允许 Instances 字段重新赋值（readonly + tsc 编译期保证 / Daemon 仅读字段或调字段对象方法）

### 资源

- 无（Assembly 本身无状态 / 不持磁盘或进程级资源）
- 仅在 `assemble()` / `disassemble()` 调用期间持有构造中的局部引用

### 业务语义

- 「装配 + 拆装」业务语义唯一发起点：identity 分支 / 跨模块回调注入 / Instances 句柄集构造 / 反向拓扑关停
- 装配「按需」（任何 daemon 进程入口需要装配模块图时调用）
- Snapshot 单实例约束：唯一 `Snapshot` 对象 / 同时出现在 `Instances.snapshot` + `RuntimeDependencies.snapshot` / 双实例 = `recovery-snapshot` audit 重复 bug

## 2. 接口

### 类型签名

```ts
import type { GlobalConfig, ClawConfig } from '@/types/config';
import type { MotionRuntime, ClawRuntime } from '@/core/runtime';
import type { StreamWriter } from '@/core/stream';
import type { Snapshot } from '@/core/snapshot';
import type { ProcessManager } from '@/core/process-manager';
import type { AuditWriter } from '@/foundation/audit';
import type { CronRunner } from '@/core/cron';
import type { Heartbeat } from '@/core/runtime';

export type Identity = 'motion' | 'claw';

export interface AssembleConfig {
  identity: Identity;
  clawId: string;
  clawDir: string;
  globalConfig: GlobalConfig;     // 来自 clawforum.yaml
  clawConfig: ClawConfig | null;  // identity='claw' 时必填 / 'motion' 时为 null
}

export interface Instances {
  readonly runtime: MotionRuntime | ClawRuntime;
  readonly streamWriter: StreamWriter;
  readonly snapshot: Snapshot;
  readonly processManager: ProcessManager;
  readonly auditWriter: AuditWriter;
  readonly cronRunner?: CronRunner;   // motion only + config.cron.enabled
  readonly heartbeat?: Heartbeat;     // motion only + heartbeat_interval_ms > 0
}

export class LockConflictError extends Error {
  readonly clawId: string;
}

export function assemble(config: AssembleConfig): Promise<Instances>;
export function disassemble(instances: Instances, signal: string): Promise<void>;
```

### 前后置条件

- **assemble 成功返回**：所有模块已构造 / 跨模块回调已注入 / `acquireLock` 已拿到 / `daemon_started` audit 已写
- **assemble 失败**：写 `assemble_failed`（载荷含失败模块名 + phase + reason）后抛 Error（带 cause）/ 或 `acquireLock` 冲突时写 `assemble_lock_conflict` 抛 LockConflictError
- **disassemble 返回前保证写入 `daemon_stop`** / 中间步骤失败写 `disassemble_step_failed` 后继续
- **Instances readonly 值对象**：Daemon 不得重新赋值字段（tsc 编译期保证）/ 调字段对象的方法允许
- **L1-L2 装配**：phase155B 起 Assembly 负责全部 L1-L2 预制 + 装配 / 通过 `RuntimeDependencies` 一次性注入 Runtime
- **L1 预制**：`systemFs`（enforcePermissions=false）+ `clawFs`（enforcePermissions=true）/ 两者 baseDir=clawDir
- **跨模块回调注入时机**：phase182 升级后 / parentStreamLog + contractNotifyCallback 经 `RuntimeDependencies` 字段注入 / 不再 setter 双阶段

### 失败分类

| 场景 | 行为 | 分类 |
|---|---|---|
| lockfile 冲突（已有进程在跑） | audit `assemble_lock_conflict` + 抛 LockConflictError | 预期失败 |
| 某模块 constructor 抛错 | audit `assemble_failed`（module/phase/reason）+ 抛 Error(cause) | 不可预期失败 |
| `snapshot.init()` 失败 | audit `assemble_failed`（module='snapshot', phase='init'）+ 抛 | 不可预期失败 |
| `recovery-snapshot commit` 失败 | audit `assemble_failed`（phase='recovery-commit'）+ **不抛**（recovery 失败不阻塞启动 / 显式决策）| 软失败 |
| 跨模块回调注入失败 | audit `assemble_failed` + 抛 | 不可预期失败 |
| `runtime.initialize()` 抛错 | audit `assemble_failed`（module='runtime', phase='post_assemble_init'）+ Daemon process.exit(1) | 不可预期失败（兜底）|
| 所有步骤成功 | audit `daemon_started`（clawId + pid）| ok |
| disassemble 某步抛错 | audit `disassemble_step_failed` + 继续下一步 | 全序继续 |
| disassemble 末尾 | audit `daemon_stop`（signal）| ok |

**关键约束**：audit 是观察通道 / 不是失败处理通道。assemble 不可预期失败必须抛给 Daemon 决策（process.exit）；disassemble 失败不抛（关停过程已无消费者可决策）/ AuditWriter 不在 disassemble 内 close（TSV 追加写无 close 义务 / 保证 daemon_stop 写入磁盘）。

## 3. 审计事件清单

> 应然事件常量集中定义于 `src/assembly/audit-events.ts` `ASSEMBLY_AUDIT_EVENTS`（应然 / 模块自治 / 实然 caller const 引用 / B.p344-Z ✅ closed phase386）。

| 事件 type | 触发位置 | 载荷 |
|---|---|---|
| `daemon_started` | assemble() 末尾 | `clawId`, `pid` |
| `daemon_stop` | disassemble() 末尾 | `signal` |
| `daemon_unclean_exit` | assemble() 进入时 detectUncleanExit | `last_ts` |
| `assemble_failed` | assemble() 任一构造步骤失败 | `module`, `phase`, `reason` |
| `assemble_lock_conflict` | `processManager.acquireLock` 失败 | `clawId` |
| `disassemble_step_failed` | disassemble() 任一步抛错 | `step`, `reason` |

外加（phase328+phase336 LLM_AUDIT_EVENTS / 模块自治）：

| 事件 type | 触发位置 | 载荷 |
|---|---|---|
| `llm_provider_attempt_failed` / `llm_retry_scheduled` / `llm_provider_exhausted` / `llm_fallback_switched` / `llm_breaker_opened` / `llm_breaker_half_open` / `llm_breaker_closed` / `llm_healthcheck_failed` / `llm_stream_reset` / `llm_stream_parse_error` / `llm_idle_failover_triggered` | `src/assembly/llm-audit-sink.ts` 经 LLMEventSink 注入 sink fan-out | LLMService 契约 §3 透传 |

> 11 个 LLM_AUDIT_EVENTS 由 Assembly 装配 LLMEventSink 后 fan-out 写 / 物理位置 `src/assembly/llm-audit-events.ts` 与 caller llm-audit-sink.ts 同目录（phase328 历史关联 + phase336 H1 拆分）。

## 4. 层级声明

L6c 装配根。下游 Daemon（L6a）通过 `assemble` / `disassemble` 函数式调用。上游 L1-L5 各模块的 createX 工厂 / 不上引 L6+。

## 5. 上游依赖

| 依赖 | 层级 | 类型化 | 用途 |
|---|---|---|---|
| L1-L5 各模块 createX 工厂 / constructor | L1-L5 | direct import | 装配汇聚点本质 |
| `GlobalConfig` / `ClawConfig` | shared types | type-only | identity 分支 + module 配置 |
| `node` 内置（path / fs / 等）| external | direct | 必需 |

应然不依赖：
- 任何 L6+ 模块（Daemon class / Watchdog / CLI commands 内部）
- 业务模块的运行期实例（Assembly 仅构造 / 不消费业务）
- 跨进程通信（lockfile 经 ProcessManager 抽象）

## 6. 不可消除的耦合

| 耦合 | 方向 | 类型化 | 消除路径 / 放弃理由 |
|---|---|---|---|
| Assembly → 所有 L1-L5 模块 constructor / factory | L6c → L1-L5 | direct import | 不消除（装配职责本质 / Assembly 必须知道所有被装配模块构造签名）|
| identity 分支决定装配差异 | Assembly 内集中表达 | union type `'motion' \| 'claw'` | 不消除（M#9 显式表达编译器可检 / tsc 保证分支穷尽 / 不泄漏到业务模块）|
| 构造顺序隐含依赖拓扑 | 当前手写顺序 | 隐式 | drift / 推 r43+ 显式 DAG 声明（待复杂度告警）|
| 跨模块回调注入时机 | Assembly 内绑定 | 协议约定 | phase182 升级后改 RuntimeDependencies 字段注入 / 不再 setter 双阶段 |
| Snapshot 单实例约束 | Assembly 内构造 + 双视角共享 | readonly 引用 | 不消除（Daemon 视角 + Runtime 视角共享同一对象 / 双实例 = recovery-snapshot audit 重复）|
| Instances 字段对象生命周期由 Daemon 管理 | publisher-subscriber | readonly 修饰 | 不消除（关停拓扑保护本质）|

**消除路径首选 port pattern**（feedback_module_contract_structure r40.2）：Assembly 自身就是 13 port 的注入终点（消费方各自 own / Assembly 装配 default impl / 注入 RuntimeDependencies）—— phase337+335+340 三 phase 实证。

## 7. 持久化

无磁盘资源 —— Assembly 是装配胶水 / 持久化归各被装配模块（fs / audit / snapshot / session 等各归其主）。

**重建语义**：进程重启 → Daemon 调 assemble → 各模块按 identity 分支重建实例 / 内部状态从磁盘加载（归各模块）。

## 8. 应然 vs 实然差距登记

> 原则：本节只登记实然 ≠ 应然的 gap（待治理或已治理的历史）+ 偏差 + 历史纪律。当前实然若与应然 align 则不在此登记。

### 8.A 必修违规（含历史已闭环）

**§7.A 6/6 全清零里程碑**（phase154-158 接力）：

| §A 条 | 类型 | 状态 | 触发情境 |
|---|---|---|---|
| ~~A.1 Assembly 模块不存在~~ | drift | **已闭环（phase154）** | `src/assembly/` 落地 + assemble() / disassemble() 导出 / 装配代码搬出 daemon.ts |
| ~~A.2 Instances 接口不存在~~ | drift | **已闭环（phase154）** | interface Instances readonly 字段集 / tsc 编译期保证 |
| ~~A.3 TaskSystem setter 注入~~ | drift | **已闭环（phase157）** | constructor 重排 + 4 setter 删除 / 顺序 toolRegistry → skillRegistry → contractManager → outboxWriter → taskSystem |
| ~~A.4 Runtime.initialize() 混合装配与业务~~ | drift | **已闭环（phase156/157）** | 构造搬 Assembly / 业务（session repair）留 Runtime |
| ~~A.5 各模块 createX 工厂缺失~~ | drift | **已闭环（phase155）** | L1-L5 各模块导出 createX(config) 工厂 / Assembly 改调工厂 |
| ~~A.6 周边装配未纳入~~ | drift | **已闭环（phase158）** | createStreamCallbacks + waitForInbox 内 FileWatcher 装配 / watchdog 装配段收拢 Assembly |

### 8.B 偏差登记（应然 silent / 实然采选 / 升档条件）

| §B 条 | 偏差性质 | 升档条件 |
|---|---|---|
| B.1 Instances 接口字段增长（phase154→phase155-157+ 扩展）| design-gap / 设计意图 | 非 M#7 违反（约束「对外表面不随外部模块增减传染」）/ Assembly Instances 增长是自身 scope 演进的主动结果 / 每次扩展须同步本契约 §2 接口定义 |
| B.2 recovery-snapshot 失败不抛 | design-gap / 显式决策 | 启动期已有失败累积保护 / recovery 失败不应级联 block daemon 启动 / 登记不修 |
| B.3 构造顺序拓扑当前隐式表达（靠代码行顺序）| drift / 中 | open / 推 r43+ | 顺序约束变多（toolRegistry → skillRegistry → ... → taskSystem）/ 若未来出错风险上升 → 引入显式 DAG 声明 |
| B.4 LockConflictError 是 Assembly 专属类型 | drift / 边界违规 | open / 长期治理 | 锁冲突本应是 ProcessManager 的失败语义 / phase154 沿用 PM 抛通用 Error 现状 / 长期应由 ProcessManager 契约定义此错误类型 / Assembly 直接 re-throw |
| B.5 phase155B Snapshot 单实例约束 | design-gap / 显式 | 不修 | 双视角共享同一对象 / 重复 new Snapshot = audit `recovery-snapshot` 2 条而非 1 条 bug 风险 |
| B.6 phase155B Runtime 精确 audit + Daemon 兜底 audit 幂等共存 | design-gap / 显式 | 不修 | 同一失败可能写两条 assemble_failed / 精确粒度 + 笼统兜底同时存在是设计意图 / 不引入 AssembleFailedError 类（会扩散异常体系超 scope）|
| ~~B.p344-Z assembly audit event 字符串硬编码~~ | ~~drift~~ | **✅ closed phase386**（main `<MERGE_SHA>`）| disassemble.ts 3 caller 改 ASSEMBLY_AUDIT_EVENTS.DISASSEMBLE_STEP_FAILED const ref / 字符串值完全等价 / B.p344-Z 收尾（assembly 内 caller 风格并轨）|
| ~~B.p344-daemon-started daemon_started 归属错配~~ | ~~drift~~ | **✅ closed（phase385 / 同根 cross-ref l6_daemon B.p344-W）** | r42 D fork 发现 / 实由 Assembly assemble.ts:108 发（DAEMON_START）/ 本契约 §3 已显式列 / l6_daemon §3 已 phase385 同步移除 daemon_start 描述 / 双侧应然 align |
| B.p385-A DispatchTool 闭包注册结构性循环依赖（B 类偏差登记）| design-gap / 显式 | 不修 | Runtime initialize 期 DispatchTool 闭包绑（this.buildSystemPrompt / this.toolRegistry.formatForLLM）/ Assembly 构造期 Runtime 尚未 new / register 必须留 Runtime 内 / 实然 runtime.ts:242-254 注释已标「候选 γ：结构性循环依赖妥协」/ phase385 应然 sharpen 同步登记（cross-ref l5_runtime B.p166-1 ✅ closed）/ 升档：若未来 Assembly 重构允许两阶段构造 |

### 8.C 应然原则对照

> 仅列应然对各原则的承诺立场 / 不写「合规✓」claims。

**Module Logic Principles**

- M#1 独立可变职责：装配逻辑（identity 分支 + 跨模块回调注入 + 关停拓扑）vs Daemon 进程生命周期（信号处理 + 主事件循环）= 完全不同关注点 / 合并即违 M#1
- M#2 业务语义归属：「装配 + 拆装」业务语义由本模块发起 / 各模块内部初始化由各模块自身负责
- M#3 资源唯一归属：Assembly 无资源 / 各被装配模块持各自资源 / Snapshot 单实例约束保证唯一性
- M#4 持久化：无 / 装配胶水
- M#5 依赖单向：L6c → L1-L5 / 不反向依赖 / readonly Instances 防 Daemon 反向修改字段引用
- M#6 依赖结构稳定：identity union type 编译期穷尽 / 构造顺序当前隐式（B.3 待 DAG 升档）
- M#7 耦合界面稳定：对外仅 assemble + disassemble 两动作 / Instances 字段增长非 M#7 违反（B.1 自身 scope 演进）
- M#8 耦合界面最小：Daemon 仅消费 Instances readonly 字段 + 调方法 / 不见装配内部
- M#9 显式编译器可检：identity union + readonly Instances 字段 / B.p344-Z caller 字符串硬编码暂违反（待治理）
- M#10 不合理停下：phase155 6 phase 接力 / phase328 audit-sink 物理迁 / phase335 13 port 注入化 / phase340 verifier port 立 / 各 phase 都遵循「停下重构」纪律
- M#11 边界对不上停下：A.1-A.6 显式登记 + 接力清零 / B.3 顺序拓扑显式登记 / 不强行 mechanical

**Design Principles**

- D1 信息不丢失 / 可观察 / 可恢复 / 可审计：6+11 events 全覆盖 + Runtime 精确 audit + Daemon 兜底 audit 幂等共存（B.6）
- D2 不丢弃 / 静默：assemble 失败 + recovery 失败 + lockfile 冲突 + disassemble 失败 全 audit 留痕
- D3 用户可观察：audit.tsv 全链路覆盖 / `daemon_started` / `daemon_stop` / `assemble_failed` 经 `clawforum status` 可读
- D4 中断恢复：disassemble 反向拓扑 + 全序继续 / Daemon 信号处理保证关停最末写 daemon_stop
- D5 日志重建：每个装配步骤 audit + module + phase + reason 三字段 / 故障复盘可重建 assemble 链路
- D6 子代理后不阻塞：Assembly 是同步装配 / 业务异步归各模块（TaskSystem 等）
- D7 系统可信路径：受信注入 deps / 非 caller 持有引用决定权
- D8 事件驱动：事件由 Daemon 调 assemble / 不轮询
- D9 多 claw 不隔绝：identity 分支区分 motion / claw / 装配差异在 Assembly 内集中
- D10 motion 特殊：cronRunner / heartbeat 仅 motion 装 / identity 分支显式
- D11 CLI 唯一对外：Assembly 不与外部交互 / 由 Daemon 经 CLI 触发

**Philosophy**

- P3 多 agent 利用：identity 分支装配 motion + claw 不同 instances
- P4 系统为智能体服务：提供「装配 + 拆装」基础设施

**Path Principles**

- Path #1 实然为唯一基准：phase154-158 接力清零 / phase328 物理迁 / phase335 注入化 / phase340 port 立 / 各 phase Path #1 核
- Path #3 语义最小变更单元：每 phase 单一 scope（A.1-A.6 各自独立 / 不混合）
- Path #6 冲突立即中断：r42 D 结构合规复盘 / 发现 8 节模板 vs 实然结构脱节 / 停下补完
- 反向测试：本模块可独立替换 identity 配置而不动 Runtime —— M#1 ✓

### 8.D 历史纪律

- 2026-03 / phase154 A.1+A.2 清零（Assembly 模块落地 + Instances 接口）
- 2026-03 / phase155 A.5 清零（L1-L5 各模块 createX 工厂 + RuntimeDependencies 16 字段定义）
- 2026-03 / phase155B Snapshot 单实例约束 + Runtime 精确 audit + Daemon 兜底 audit 设计决策
- 2026-03 / phase156+phase157 A.3+A.4 清零（Runtime.initialize 装配 vs 业务拆分 + TaskSystem setter 删 + constructor 重排）
- 2026-03 / phase158 A.6 清零（周边装配收拢）
- 2026-04-21 / phase182 setter 双阶段升级（B.p166-5 / Runtime 公共接口 -2 setter / 改 RuntimeDependencies 字段注入）
- 2026-04-26 / phase328 LLMService L1→L2 audit-sink 物理迁移（`src/assembly/llm-audit-sink.ts`）
- 2026-04-26 / phase335 H7+H8 13 port 注入化（Runtime DispatchTool 物理迁）
- 2026-04-27 / phase336+phase338 H1 audit-events.ts 模块自治拆分（LLM_AUDIT_EVENTS 物理迁 `src/assembly/llm-audit-events.ts`）
- 2026-04-27 / phase340 ContractVerifierScheduler port 注入（H6+H11）
- 2026-04-27 / phase344 types/contract.ts 按语义域拆 3 文件
- 2026-04-27 / r42 D 结构合规复盘（§7→§8 编号修订 + Path 6 待补）

### 8.E 关键决策映射（modules.md 引用）

| KD | 描述 | 一致性 |
|---|---|---|
| KD#15 | Assembly 独立成 L6c | ✓ phase154 落地 |
| KD#23 | 装配职责三分（Assembly + Daemon + Runtime）| ✓ phase156-158 接力实施 |
| KD#25 | Runtime 不自建 L1-L2 / 经 RuntimeDependencies 注入 | ✓ phase155B 落地 |
| KD#28 | LLMService L1 / audit-sink 装配层 fan-out | ✓ phase328 物理迁 |
| KD（待编号）| port pattern 三 phase 实证（phase337+335+340）| ✓ Assembly 是 13 port 注入终点 |

## 9. 测试覆盖

应然行为（不绑定具体测试文件路径）：

- **assemble 成功路径**：所有模块构造 + 跨模块回调注入 + acquireLock + daemon_started audit
- **identity 分支**：motion 装 cronRunner + heartbeat / claw 不装 / Instances 字段 readonly + 编译期保证
- **lockfile 冲突**：assemble_lock_conflict audit + LockConflictError 抛
- **某模块构造失败**：assemble_failed（module + phase + reason）+ Error(cause) 抛 + Daemon process.exit
- **snapshot 失败二分**：init 失败抛 / recovery-commit 失败不抛（B.2 显式决策）
- **runtime.initialize 后置失败**：assemble_failed（module='runtime', phase='post_assemble_init'）+ Daemon 兜底
- **Snapshot 单实例**：双视角共享同一对象 / 重复 new = recovery-snapshot audit 重复 bug 防御测试
- **Runtime 精确 audit + Daemon 兜底 audit 幂等共存**：同一失败两条 assemble_failed 不重复触发关键路径
- **disassemble 全序继续**：某步抛错 disassemble_step_failed audit + 继续下一步
- **disassemble 末尾**：daemon_stop 写入磁盘（AuditWriter 不 close）
- **identity 分支穷尽**：tsc 保证 union type 不漏分支
- **审计回链**：6 ASSEMBLY_* + 11 LLM_AUDIT_EVENTS 全覆盖（B.p344-Z 治理后补 caller const 引用）
- **detectUncleanExit**：daemon_unclean_exit audit + 不影响 assemble 继续
