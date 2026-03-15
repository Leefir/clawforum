# AGENTS.md - 核心规范

> **必读**: 本文件只包含最关键的 7 条规范。详细说明、历史记录、技术债务见 [AGENTS-REFERENCE.md](./AGENTS-REFERENCE.md)

---

## 🔴 执行前必读（7 条核心规范）

### 1. 编码前必读依赖接口（包括测试）

**写任何代码前，包括测试**，必须 ReadFile 被调用模块的接口定义。

**显式规则**：
```
修改已有文件 → ReadFile 目标文件
创建新文件   → ReadFile 所有依赖模块的接口（新文件也依赖已有接口！）
```

**业务代码预读清单**：
- `src/foundation/fs/types.ts` - IFileSystem
- `src/foundation/llm/index.ts` - ILLMService  
- `src/core/tools/executor.ts` - ExecContext
- `src/types/message.ts` - Message, LLMResponse

**测试代码预读清单（必须做）**：
1. **被测类构造函数**：参数顺序、类型
2. **被测类公共方法**：方法名、async/sync、返回值
3. **依赖服务接口**：IFileSystem 有哪些方法？

**正确流程示例**：
```typescript
// ✅ 正确：先读后写
ReadFile src/core/contract/manager.ts   // constructor(clawDir, fs, monitor?)
ReadFile src/foundation/fs/types.ts      // IFileSystem 接口
ReadFile src/foundation/fs/node-fs.ts    // NodeFileSystem 构造函数

// 现在写测试，参数不会错
new ContractManager(CLAW_DIR, nodeFs, undefined)
```

**错误流程示例（Step9 模式）**：
```typescript
// ❌ 错误：凭记忆写
new ContractManager(mockFs, baseDir)  // 错！参数顺序反了，且方法名也不对
// 然后 6 轮试错...
```

**历史教训**：
- skill/轮遵循本规范: 操作 12次 vs 45次 (↓73%)
- Phase 2 质量关卡测试编写: 6 轮试错，全部源于没预读接口

**禁止**：
- ❌ 假设构造函数参数顺序
- ❌ 假设方法存在（如 isPathAllowed）
- ❌ 假设 mock 只需要部分方法
- ❌ "先写个大概再调试"
- ❌ 把失败归因于"mock 限制"而不承认是没读接口

### 2. 类型定义优先

写代码前确认类型定义中的**确切字段名**：
- `fs.read()` / `writeAtomic()` — 不是 `readFile()` / `writeFile()`
- `ReactResult.finalText` — 不是 `text`
- `JsonlMonitor({ logsDir })` — 不是 3 个参数

### 3. 预读时检查作用域遮蔽

重命名/删除 import 前，搜索**同名标识符**在不同作用域的定义：
```typescript
// 模块级
import * as fs from 'fs';
// 函数内 - 遮蔽了模块级 fs！
const fs = new NodeFileSystem(...);
```

### 4. 修改接口时同步更新所有调用点

```bash
# 修改前搜索所有调用
grep -r "new Xxx(" tests/ src/
```

**补充：修改用户可见的输出字符串后，立即 grep 测试文件中的旧字符串**
```bash
# 示例：修改了 write 工具的输出格式
# 从 "写入成功" 改为 "成功写入 xxx（N 字符）"
# 必须同步更新测试断言：
grep -r "写入成功" tests/
# → tests/core/builtins.test.ts: expect(result.content).toContain('写入成功')
# 修改为: expect(result.content).toContain('成功写入')
```
**历史教训**：Step 31.4 (claw list) 和 Step 32 (write tool) 两次因修改输出未更新测试而失败。

### 5. 测试必须覆盖真实用户路径

新增 CLI 命令必须**实际执行一次**，不能仅验证 `--help`：
```bash
# ❌ 不充分
node dist/cli.js claw --help
# ✅ 正确
node dist/cli.js claw list  # 验证功能
```

### 6. 禁止同步方法中的异步副作用

```typescript
// ❌ 错误：fire-and-forget 导致竞态条件
isAlive(): boolean {
  this.removePid(id).catch(() => {});  // 异步！
  return false;
}
// ✅ 正确：返回状态让调用者清理，或改为 async
```

### 7. 每个 catch 必须做以下之一

- 重新抛出 `throw error`
- 记录日志 `monitor.log('error', ...)`
- 执行回退逻辑
- 明确注释为何可忽略

**禁止**: 空 catch `} catch {}`

---

## 📋 快速参考

### 核心文件路径
```
Builtins:   src/core/tools/builtins/{read,write,exec,search,ls,status,send,spawn,skill,done}.ts
Runtime:    src/core/runtime.ts
React:      src/core/react/loop.ts
CLI:        src/cli/commands/
```

### 技术债务（高优先级）
| 问题 | 位置 | 影响 |
|------|------|------|
| isAlive() 同步方法中的异步副作用 | `foundation/process/manager.ts` | stop() 行为不可预测 |
| CLI 命令直接 process.exit | `cli/commands/claw.ts:176,209` | Motion 调用无法获取错误信息 |

**完整债务清单**: 见 [AGENTS-REFERENCE.md](./AGENTS-REFERENCE.md#技术债务)

---

*详细规范、历史记录、步骤总结 → [AGENTS-REFERENCE.md](./AGENTS-REFERENCE.md)*

---

## 调试约束补充（2026-03-15）

### 禁止 Level 0 调试
```
❌ 错误：看到错误 → 猜测原因 → 改代码 → 无效 → 再猜测
✅ 正确：验证证据 → 定位根因 → 修复 → 验证修复
```

### 证据链检查清单
调试任何流程问题前，必须按顺序验证：
- [ ] 组件是否在运行？
- [ ] 配置是否正确加载？
- [ ] 输入是否到达？
- [ ] 处理逻辑是否执行？
- [ ] 输出是否正确产生？
- [ ] 下游是否收到？

### Shell 命令前置检查
```bash
[ -d <path> ] || echo "目录不存在"
[ -f <file> ] || echo "文件不存在"
which <cmd> || echo "命令不存在"
```

### 用户中断处理
- 1 次：重新评估假设
- 2 次：停止并询问
- 3 次：强制复盘

### ls 解读规范
- `total 0` = 磁盘块计数，忽略
- 看 `drwxr-xr-x` 行 = 子目录存在

### 路径确认
发现多个可能路径时，列出请用户确认，禁止 AI 自行判定。

## 历史教训

### 2026-03-15: Crash 恢复调试灾难
- **问题**：kill claw1 后不自动重启
- **根因**：AI 连续犯下 5 个核心错误
  1. 误读 `ls total 0` 为"空目录"
  2. 路径混乱，两次无视用户纠正
  3. 40% Shell 命令失败
  4. 未检查任何证据链环节
  5. 7 次用户中断，信任破产

## 2.8 文件修改安全规范（Step 30.2 教训）

### 2.8.1 禁止 WriteFile 覆盖已有文件
- 修改已有文件必须使用 `StrReplaceFile` 或追加模式
- `WriteFile` 仅用于创建新文件
- 修改前必须 `ReadFile` 确认当前内容

### 2.8.2 AGENTS.md 是受保护文件
- 任何修改必须使用追加模式 (`>>`)
- 禁止全量覆盖
- 修改后必须 `git diff` 验证

**历史**：Step 30.2 中，AI 在写入"不要覆盖文件"的约束时，用 `WriteFile` 覆盖了完整的 AGENTS.md（29 轮开发记录），幸被用户 `git status` 发现。
