# Phase 1452 — readFileState persist→load→gate Runtime restart e2e 测试（phase 1443 F-NEXT.3 治理）

**起 phase**: 2026-05-30
**worktree**: `/Users/lleefir/code/mess/260315/worktree/phase1452/`
**branch**: `phase1452`（基线 main @ `25736a1c`）
**前序**: phase 1443 §6 后续段 F-NEXT.3「Runtime restart e2e 测试（含 disk → Map round-trip + corrupt file fallback）」
**性质**: 测试覆盖补全（无 src 改动、纯 tests 加 NEW e2e、行为契约验证）

---

## 1. 当前状态

phase 1443 落地 readFileState 持久化（`persistReadFileState` + `loadReadFileState` + `clearReadFileState`）+ Runtime.initialize() load step + regime switch hook。

**已覆盖测试**：
- `tests/foundation/file-tool/file-state-persist.test.ts` 9 case unit-level：persist round-trip + subagent skip + load missing/valid/corrupt/unknown_version + clear delete/ENOENT/subagent
- `tests/core/builtins.test.ts` 89 case 触发 manager helpers（audit + persist 间接覆盖）

**仍缺**：
- ❌ Runtime restart e2e：daemon 进程 A read 文件 → 进程 A 关 → 进程 B 启 → load disk → gate 用 restored state 正确判断
- ❌ persist→load 链下 hash + timestamp + isFullRead 三字段完整往返断言（unit test 验证 JSON shape、未验证 gate 在 restored state 下行为）
- ❌ 跨"模拟 Runtime 生命周期"的 gate 决策连续性

per 编码规范「测试验证行为契约、让代码经历从未走过的路径」、F-NEXT.3 是真覆盖缺口。

## 2. 目标

NEW 1 个 e2e test file 覆盖 Runtime restart 行为契约：

| 契约 | 验证方式 |
|---|---|
| Runtime A → persist：read 全文 → state.json 含 entry | 1 read + assert disk file content shape |
| Runtime B → load：fresh ctx → loadReadFileState → Map 含 A 的 entry | 2 ctx construct + load + assert Map 状态 |
| Runtime B → gate：用 restored state 决策 write | 1 write attempt + assert success（hash 匹配、未变） |
| Runtime B → gate stale：外部改文件 → write 拒 reason=stale | external write + write attempt + assert reject + audit reason |
| Runtime B → gate partial：A 只 partial read → B load → write 拒 reason=partial | range read + restart + write + assert reject |
| corrupt disk file → load 返空 Map + audit + fail-safe（gate 拒"never read"）| write bad JSON + load + assert empty + audit + write try + reject reason=not-read |

行为契约**全 disk-real-fs**（NodeFileSystem 真磁盘、非 mock）= e2e 名副其实。

## 3. 修改文件

| 类型 | 路径 | 改什么 |
|---|---|---|
| NEW | `tests/foundation/file-tool/runtime-restart-gate-e2e.test.ts` | 6 case 覆盖契约表 |

不动 src 代码（行为契约本身已在 phase 1443 落、本 phase 仅补测试）。

## 4. 设计细节

### 4.1 fixture 模式

```ts
async function makeCtx(clawDir: string, persist: boolean): Promise<ExecContextImpl & { auditLog: any }> {
  const auditHelper = makeAudit();
  const fs = new NodeFileSystem({ baseDir: clawDir });
  const ctx = new ExecContextImpl({
    clawId: 'test-claw',
    clawDir: makeClawDir(clawDir),
    clawforumRoot: makeClawforumRoot(path.dirname(clawDir)),
    workspaceDir: path.join(clawDir, CLAWSPACE_DIR),
    syncDir: path.join(clawDir, 'tasks/sync'),
    profile: 'full',
    allowedGroups: new Set(['fs-read', 'fs-write']),
    callerLabel: 'claw',
    fs,
    fsFactory: (dir: string) => new NodeFileSystem({ baseDir: dir }),
    maxSteps: 20,
    auditWriter: auditHelper.audit,
    permissionChecker: createClawPermissionChecker({ clawDir: makeClawDir(clawDir), strict: true }),
    persistReadFileState: persist,
  });
  return Object.assign(ctx, { auditLog: auditHelper });
}
```

### 4.2 测试结构（6 case）

```ts
describe('Runtime restart gate e2e (phase 1443 / phase 1452)', () => {
  let baseDir: string;
  beforeEach: createTempDir + mkdir clawspace
  afterEach: cleanupTempDir

  // case 1: persist → load round-trip
  it('Runtime A reads → disk persists → Runtime B loads → gate sees same state')

  // case 2: full-read restart gate pass
  it('Runtime B accepts overwrite after Runtime A full read (hash matches)')

  // case 3: stale via external modify
  it('Runtime B rejects overwrite when file modified externally between restarts (reason=stale)')

  // case 4: partial-read restart gate reject
  it('Runtime B rejects overwrite when Runtime A only partial-read (isFullRead=false preserved)')

  // case 5: corrupt disk fallback
  it('Runtime B loads empty Map on corrupt disk file (audits parse_failed) and gate rejects as not-read')

  // case 6: subagent persist isolation
  it('subagent ctx (persistReadFileState=false) does NOT write disk file even with state mutations')
});
```

### 4.3 关键 assertions

```ts
// case 1
const ctxA = await makeCtx(clawDir, true);
await readTool.execute({ path: 'small.md' }, ctxA);
const stateA = ctxA.readFileState.get('clawspace/small.md');
expect(stateA?.isFullRead).toBe(true);
// disk verify
const onDisk = JSON.parse(await fs.readFile(path.join(clawDir, READ_STATE_FILE), 'utf-8'));
expect(onDisk.entries['clawspace/small.md']).toEqual(stateA);

// Runtime restart
const ctxB = await makeCtx(clawDir, true);
ctxB.readFileState = await loadReadFileState(ctxB.fs, ctxB.auditWriter);

// state match
expect(ctxB.readFileState.get('clawspace/small.md')).toEqual(stateA);

// case 2: gate accepts
const writeResult = await writeTool.execute({ path: 'small.md', content: 'new' }, ctxB);
expect(writeResult.success).toBe(true);
```

## 5. 不做

- ❌ 不动 src 代码（phase 1443 行为契约已立、本 phase 验证）
- ❌ 不引入 mock Runtime（fixture-heavy、不必要 — 直接 ExecContextImpl + NodeFileSystem 已等价）
- ❌ 不测 regime switch + restart 联动（独立场景、F-NEXT.4 candidate）
- ❌ 不测 concurrent multi-Runtime 同 clawDir（R7 docs 已 disclaim「JS 单线程 + tool execute 顺序 awaited、无并发」）
- ❌ 不补全 v2 format migration 测试（F-NEXT.2 独立 phase）
- ❌ 不加 CLI inspect 命令测试（F-NEXT.1 独立 phase）
- ❌ 不动 audit-events snapshot（已 phase 1443 sync）
- ❌ 不动 description / AGENTS.md（行为契约不变）

## 6. 验收

```bash
# typecheck
npx tsc --noEmit
# 预期：exit 0

# 新 test file 跑
CI=1 npx vitest run --config .config/vitest.config.ts --reporter=dot tests/foundation/file-tool/runtime-restart-gate-e2e.test.ts
# 预期：1 file passed、6 test passed

# 相关回归
CI=1 npx vitest related --config .config/vitest.config.ts --passWithNoTests --reporter=dot --run \
  src/foundation/file-tool/file-state-persist.ts \
  src/foundation/file-tool/file-state-manager.ts \
  src/foundation/file-tool/read.ts \
  src/foundation/file-tool/write.ts
# 预期：all passed

# 全量 (Step C 收官 SOP per Tier 2 feedback_closure_ratify_full_vitest_required)
CI=1 npx vitest run --config .config/vitest.config.ts --reporter=dot
# 预期：≥ 545 file passed、≥ 3155 test passed（既有 3147 + NEW 6 + buffer）、0 fail

# main 未由本 phase 触动
git -C /Users/lleefir/code/mess/260315/clawforum rev-parse main
# 预期：仍 25736a1c（或允许外部推进、但非本 phase commit）
```

## 7. 风险

- **R1（NodeFileSystem fixture cost）**：每 case 真磁盘 mkdir + write + read + clean → IO 比 mock 慢。**缓解**：用 `tempDir` createTempDir / cleanup 模式、6 case 总时长预估 < 5 s。
- **R2（cross-platform mtime 精度）**：case 3「外部 modify」需 mtime 严格递增。Linux/macOS 上 mtime 通常 ms 精度、可能两次 write 在同 ms。**缓解**：在第二次 write 前 `await new Promise(r => setTimeout(r, 15))` 强制 mtime 间隔。
- **R3（fixture 与既有 builtins.test.ts 重复）**：既有 89 case 已用 ExecContextImpl + NodeFileSystem。本 phase 新增 e2e 共享 fixture 风格、但 scope 不同（既有 = 单 ctx 行为、本 phase = 双 ctx 跨「restart」）。**缓解**：复用 `tests/utils/temp.ts` + `tests/helpers/audit.ts`，新建 fixture function 在新 test file 内。
- **R4（typecheck cross-package import）**：fixture 需 import `loadReadFileState` from `src/foundation/file-tool/file-state-persist.ts` + `ExecContextImpl` from `src/foundation/tools/`。phase 1441 立 utils 不深 import 规则、但 tests 不受 depcruise 约束、深 import OK。
- **R5（regime switch hook 联动未覆盖）**：本 phase 不测 regime switch + persist 联动（独立 case）。disk state 在 regime switch 后被清、restart 后 load 返空 = 也是正确行为。不在 scope。
- **R6（外部 worktree pruning 重演）**：sister `feedback_worktree_pre_commit_pruning_risk`（NEW Tier 3 by phase 1443 retrospective）已立。本 phase 起步即 anchor commit。
- **R7（pre-merge rebase 漏）**：sister `feedback_pre_merge_rebase_test`（NEW Tier 3 by phase 1443 retrospective）已立。本 phase merge main 前必 rebase + 跑测试。

## 8. self-audit（per NEW Tier 3 feedback_phase_self_audit_before_handoff、phase 1443 retrospective 立）

phase Step C 收官 commit 前主动对四段原则做 self-audit：

| 段 | 检查 | 结果 |
|---|---|---|
| Philosophy | 上下文工程 / 系统为智能体服务 | ✅ 测试验证 daemon restart 不丢 gate 状态 = 真服务 |
| Design Principles | 信息不丢 / 可观察 / 可恢复 / 可审计 / 智能体决策主体 | ✅ 直接验证 phase 1443 落地的 DP 全栈 |
| Module Logic | SRP / 单向依赖 / 资源唯一归属 | ✅ tests/ 层、不动 src 依赖图 |
| Path | 实然 vs 应然登记 / 原子变更 / 复盘 | ✅ 本 phase = phase 1443 §6 后续 F-NEXT.3 真闭、Path #2 实证 |

self-audit clean 预期。如发现违反、Step C 前 commit 治理或登记 §9 后续。

## 9. 后续

- ~~F-NEXT.1 `clawforum claw inspect read-state` CLI~~ ✅ 同 phase 内扩展实施、见 §11
- ~~F-NEXT.2 v2 format migration~~ ✅ 同 phase 内政策文档化、见 §12（actionable scope = 现有 unknown-version 分支 + JSDoc 显式登记 strategy）
- ~~F-NEXT.4 regime switch + persist 联动 e2e~~ ✅ 同 phase 内扩展实施、见 §10

---

## 10. F-NEXT.4 扩展（user 「继续在 1452 实施」 → 同 worktree 续做）

phase 1452 F-NEXT.3 落地后 user 指示同 phase 续做 F-NEXT.4（mirror phase 1439 V2+V3 同 phase extension 模式）。

### 10.1 当前状态（F-NEXT.3 完成后）

phase 1443 已落 `performRegimeSwitch` 的 `onSwitchComplete?` callback + Runtime 注入 `() => clearReadFileState(this.execContext)`。**真 wired hook 运行时被触发 + 真清 + 跨 regime switch 的 gate 决策连续性未 e2e 覆盖**。

phase 1452 F-NEXT.3 已 6 case 覆盖 persist→load→gate 链、但 **regime switch 的 clear hook 链**与之正交、独立场景。

### 10.2 目标

NEW 1 个 e2e test file 验证 3 行为契约：

| 契约 | 验证 |
|---|---|
| 成功 regime switch → onSwitchComplete 被调用 + clear Map + del disk | callback flag 真 + map size 0 + disk file 0 |
| 跨 regime switch 的 gate 决策连续性：清后 overwrite 必拒 | reason=not-read audit + 磁盘文件内容未变（写被拒） |
| 失败 regime switch (archive throw)：onSwitchComplete **不**被调用 | callback flag 假 + map 未动 + disk file 未动 |

### 10.3 修改文件

| 类型 | 路径 | 改什么 |
|---|---|---|
| NEW | `tests/foundation/file-tool/regime-switch-readfilestate-clear-e2e.test.ts` | 3 case 覆盖契约表 + 直接调 performRegimeSwitch（不构造 Runtime 整体）+ 最小 mock DialogStore |

不动 src 代码（行为契约已 phase 1443 落、本扩展仅补测试）。

### 10.4 设计细节

- **fixture**：复用 F-NEXT.3 的 `makeCtx(clawDir, persist=true)` 模式
- **mock DialogStore**：用 vi.fn 构造 minimum viable (load/save/archive resolves)
- **case 3 archive throw**：用 `mockRejectedValueOnce` 模拟、验证 `performRegimeSwitch` reject path 不触 onSwitchComplete

### 10.5 不做

- ❌ 不构造完整 Runtime fixture（性能开销 + 不必要 — 直接 performRegimeSwitch + 最小 mock 已等价测试 wire）
- ❌ 不测 Runtime 整体的 `_performRegimeSwitch` 调用链（既有 `regime-switch-archive-fail.test.ts` 已覆盖 wire 是否正确注入）
- ❌ 不测 concurrent regime switches（JS 单线程 + sequenced calls）
- ❌ 不测 user override of cleanup hook（非 Runtime 入口、超 scope）

### 10.6 验收

```bash
CI=1 npx vitest run --config .config/vitest.config.ts --reporter=dot tests/foundation/file-tool/regime-switch-readfilestate-clear-e2e.test.ts
# 预期：1 file passed、3 test passed

CI=1 npx vitest run --config .config/vitest.config.ts --reporter=dot
# 预期：≥ 546 file passed、≥ 3156 test passed、0 fail（既有 3153 + NEW 3）
```

### 10.7 风险

- **R10（mock DialogStore 表面方法可能漂移）**：phase 1443 后若 DialogStore 接口扩、本 mock 缺方法 → ts type-check fail（保护机制）。**缓解**：实施时 `as unknown as DialogStore` 兜底、保 minimum viable + tsc 校验。
- **R11（async callback 顺序）**：performRegimeSwitch 末尾 `await onSwitchComplete?.()`、async 顺序保证。但若未来改 sync emit、本 case 1 callback flag 验证 仍 OK（同步 set→async check）。

---

## Meta

- **本 phase 工艺**：anchor commit early（per NEW Tier 3 B、phase 1443 retrospective 立 SOP）、pre-merge rebase（per NEW Tier 3 C）、Step C 收官 self-audit（per NEW Tier 3 A）三 SOP 首次 phase 内实践
- **不做段 8 项 firewall**：明示 v2/CLI/regime+restart 联动/concurrent multi-Runtime/mock Runtime/audit snapshot/description/src 不在 phase（V2 起逐项扩展放）
- **验收段 4 条 bash + 全量 vitest**：满足 Tier 2 `feedback_closure_ratify_full_vitest_required` mandatory
- **风险段 7 项**：含 cross-platform mtime + fixture cost + worktree/rebase 两 NEW Tier 3 SOP 实施提醒

---

## 11. F-NEXT.1 扩展（user 「继续完成这两个」 → 同 worktree 续做 CLI）

user 继续指示同 phase 续做 F-NEXT.1 + F-NEXT.2。

### 11.1 当前状态

phase 1443 落 `<clawDir>/read-state.json` 持久化、user-facing 观察靠 user `cat <clawDir>/read-state.json` 手 cat。当 entries 多 / hash 长（64 字符）/ user 想看 「哪些可 overwrite」 时 raw JSON 难读。缺**结构化 inspect CLI**。

### 11.2 目标

NEW `clawforum claw read-state <name>` subcommand：
- text 默认输出：path + hash short (12 字符) + mtime ISO + overwritable yes/no 表格
- `--json` flag：machine-readable report（含 notes 段）
- 缺失文件 → ABSENT + 解释（first-run / cleared / never read）
- corrupt 文件 → 0 entries + parse-failed note
- 未知 version → 0 entries + skipped note

### 11.3 修改文件

| 类型 | 路径 | 改什么 |
|---|---|---|
| NEW | `src/cli/commands/claw-read-state.ts` | `readStateCommand({fsFactory}, name, opts?)` + `buildReport` 内部 helper + `renderText` 内部 helper |
| MODIFY | `src/cli/commands/claw.ts` | barrel re-export `readStateCommand` + docstring "11 command" |
| MODIFY | `src/cli/index.ts` | import + register `claw read-state <name> [--json]` subcommand |
| NEW | `tests/cli/commands/claw-read-state.test.ts` | 5 case：missing + valid text + valid JSON + corrupt + unknown version |

### 11.4 设计细节

```ts
interface ReadStateReport {
  claw: string;
  exists: boolean;
  version?: number;
  updated_at?: string;
  entry_count: number;
  entries: Array<{
    path: string;
    hash_short: string;       // 前 12 字符
    timestamp_ms: number;
    timestamp_iso: string;    // ISO 8601
    is_full_read: boolean;
    overwritable: boolean;    // is_full_read 的 end-user 语义别名
  }>;
  notes?: string[];
}
```

文本输出：

```
Claw: my-claw
Read state file: read-state.json
Version: 1
Updated at: 2026-05-30T14:30:12.345Z
Entries: 2

  path                                                  hash         mtime                    overwritable
  ----                                                  ----         -----                    ------------
  clawspace/notes.md                                    aaaaaaaaaaaa  2026-05-30T01:00:00.000Z  yes
  clawspace/partial.md                                  bbbbbbbbbbbb  2026-05-30T01:00:01.000Z  no (not full-read)
```

JSON 输出：用上方 ReadStateReport 结构 stringify + 2 space indent。

### 11.5 不做

- ❌ 不加 `--all` flag 跨多 claw 同时 inspect（YAGNI、按需扩展）
- ❌ 不加 hash full 显示（gravy、JSON 已含）
- ❌ 不加 write-side ops（read-state 是只读视角、不在 CLI 写）
- ❌ 不加 RESTful HTTP 接口（CLI sufficient）
- ❌ 不集成到 `clawforum claw health <name>` 主 health 报告（独立 inspect、避免 health 膨胀）

### 11.6 验收

```bash
# CLI 命令注册
node dist/cli.js claw read-state --help
# 预期：显示 description + --json option

# 真 claw e2e（演示）
node dist/cli.js claw read-state existing-claw --json
# 预期：JSON 输出 stable shape

# 单元测试
CI=1 npx vitest run --config .config/vitest.config.ts --reporter=dot tests/cli/commands/claw-read-state.test.ts
# 预期：1 file passed、5 test passed
```

### 11.7 风险

- **R12（path 长度截断展示）**：path 太长 (>50 chars) 用 `...` + 后 47 字符。可能造成混淆（识别错文件）。**缓解**：JSON 输出含完整 path、user 可 `--json | jq` filter。
- **R13（hash 短 12 字符 collision）**：SHA-256 前 12 字符 collision 概率 (2^-48) 极低、但非零。**缓解**：JSON 输出含 full hash；text 是给 user 快读的、collision 不影响 gate 决策。

---

## 12. F-NEXT.2 扩展（v2 format migration 策略文档化）

### 12.1 当前状态

phase 1443 落盘格式 v1：`{ version: 1, updated_at, entries: Record<path, FileState> }`。
phase 1443 §5 disclaim 「不动落盘格式版本（v1 一次定型、未来变更走 migration）」。

**实然实施已具备 v2 兼容路径**：`loadReadFileState` 检查 `parsed.version !== 1` → 写 audit `result=skipped_unknown_version` + 返空 Map。这本身就是「discard + rebuild on next read」迁移策略。

**应然 gap**：策略未在代码层显式登记、未来 v2 设计者可能不知道这一兜底已存在、可能误以为需要新建复杂 migration table。

### 12.2 目标

`loadReadFileState` 上 JSDoc 加 **Version migration policy 段**、显式登记：
1. v1↔v2 都走 discard + rebuild
2. 这是 by-design（readFileState 是 gate 加速器、非 primary data source）
3. 未来 v2 binary 想兼容 v1 数据：MAY 加 sister branch（`if version === 1 loadV1; if version === 2 loadV2`）
4. 一行 reframe：「losing it costs at most one re-read per file」

### 12.3 修改文件

| 类型 | 路径 | 改什么 |
|---|---|---|
| MODIFY | `src/foundation/file-tool/file-state-persist.ts` `loadReadFileState` JSDoc | 加 "Version migration policy (phase 1452 / F-NEXT.2)" 段 |

### 12.4 设计细节

JSDoc 段加在 `loadReadFileState` 既有「Failure modes」段之后、function 头之前。

### 12.5 不做

- ❌ 不实现 v2 schema（无 spec、premature）
- ❌ 不抽 migration registry 模式（YAGNI、单 caller）
- ❌ 不写 migration test（无 v2 to migrate to）

### 12.6 验收

```bash
grep -n "Version migration policy" src/foundation/file-tool/file-state-persist.ts
# 预期：1 line 匹配
```

### 12.7 风险

- **R14（未来 v2 设计者忽略本 JSDoc）**：纯 documentation 风险、唯一缓解是 sister phase 加 design row in `l2_file_tool.md`。本 phase **不加**（防 scope creep、F-NEXT.2 真治 = 写 v2 时同步加 row）。
