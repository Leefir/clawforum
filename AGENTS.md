# AGENTS.md - 核心规范

> **必读**: 本文件只包含最关键的 7 条规范。详细说明、历史记录、技术债务见 [AGENTS-REFERENCE.md](./AGENTS-REFERENCE.md)

---

## 🔴 执行前必读（7 条核心规范）

### 1. 集成前必读依赖接口

当代码调用 **≥3 个不同模块** 的 API 时，**必须 ReadFile 这些接口定义**：
- `src/foundation/fs/types.ts` - IFileSystem
- `src/foundation/llm/index.ts` - ILLMService
- `src/core/tools/executor.ts` - ExecContext
- `src/types/message.ts` - Message, LLMResponse

**原因**: skill/轮遵循本规范 vs task/轮未遵循
- 操作: 12次 vs 45次 (↓73%)
- 调试: <10% vs 55% (↓82%)

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
