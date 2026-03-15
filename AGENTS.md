# AGENTS.md - Clawforum Agent Guidelines

> 本文件记录项目特定的编码规范、常见陷阱和效率优化建议，供 AI Agent 参考。

---

## 🔴 关键原则（按优先级排序）

### 1. 集成前必读原则（已验证有效 ✨）

**问题**: 跨模块集成时"凭记忆写代码"导致类型不匹配（task/轮 8处错误，45次操作，55%调试时间）

**规则**: 
- 当代码需要调用 **≥3个不同模块** 的 API 时，**必须先 ReadFile 所有依赖模块的接口定义**
- 特别是这些文件：
  - `src/foundation/fs/types.ts` - IFileSystem 接口
  - `src/foundation/llm/index.ts` - ILLMService 接口  
  - `src/foundation/monitor/types.ts` - IMonitor 接口
  - `src/foundation/transport/index.ts` - ITransport 接口
  - `src/core/tools/executor.ts` - ITool, ExecContext 接口
  - `src/types/message.ts` - Message, LLMResponse 类型

**投入产出比**: 5分钟阅读 → 节省 20+ 次修复操作

**验证数据**: skill/轮（遵循本规范）vs task/轮（未遵循）
- 操作次数：12次 vs 45次（↓73%）
- 类型检查失败：0次 vs 4次（↓100%）
- 调试占比：<10% vs 55%（↓82%）

### 2. 类型定义优先原则

**问题**: 频繁出现 "实际值 vs 写成值" 的类型错误

**规则**:
- 写代码前，先确认类型定义文件中的 **确切字段名**
- 常用类型快速参考：
  - `IFileSystem.read()` / `writeAtomic()` / `exists()` - **不是** `readFile()` / `writeFile()`
  - `ReactResult.finalText` - **不是** `text`
  - `JsonlMonitor` 构造函数接收 `{ logsDir }` - **不是** 3个参数
  - `MonitorEventType` 有限枚举值 - **不能**随意添加新值

### 3. 目录创建检查

**问题**: 多次 WriteFile 失败后才创建目录

**规则**:
```typescript
// ✅ 正确：先创建目录
await fs.ensureDir('path/to/dir');
await fs.writeAtomic('path/to/dir/file.txt', content);

// ❌ 错误：目录可能不存在
await fs.writeAtomic('path/to/dir/file.txt', content); // 可能失败
```

**新模块 checklist**:
- [ ] 目录已创建 (`mkdir -p`)
- [ ] 入口文件 `index.ts`
- [ ] 类型定义已确认

### 4. AbortSignal 传递链

**问题**: 两次（tools/ 和 task/）遇到 signal 未被传递的问题

**规则**:
- 任何支持超时/取消的异步操作，必须传递 `signal`
- 调用链路：
  ```typescript
  SubAgent(AbortController) 
    → runReact(ctx.signal) 
    → llm.call({ signal }) 
    → 底层 API
  ```
- Mock 测试时，mock 函数必须检查 `options.signal?.aborted`

---

## 📋 模块集成 Checklist

当实现需要跨模块调用的功能时，使用此 checklist：

### Phase 0: 阅读依赖 (5-10分钟)
- [ ] 阅读所有依赖模块的接口定义文件
- [ ] 确认函数签名（参数名、返回值类型）
- [ ] 确认错误处理方式

**高复杂度集成（≥3个外部模块）额外步骤**：
- [ ] 创建 `_imports.md` 临时文件，列出所有关键接口签名
- [ ] 对照接口定义编写代码，不写任何凭记忆的字段名

### Phase 1: 实现 (编码)
- [ ] 创建目录结构
- [ ] 先写类型定义/接口
- [ ] 实现代码（对照接口定义）

### Phase 2: 验证
- [ ] `pnpm tsc --noEmit` 零错误
- [ ] `pnpm test` 全部通过
- [ ] 检查是否有未使用的导入

---

## ⚠️ 已知技术债务

| 债务 | 状态 | 影响 | 计划 |
|------|------|------|------|
| retryAttempts 命名歧义 | ⚠️ 未修复 | 中 | 延后到 CLI 阶段 |
| noUnusedLocals tsconfig | ⚠️ 未修复 | 低 | 延后 |
| ToolExecutorImpl 接口不完整 | 🟡 已打补丁 | 低 | 当前通过 ToolExecutor 子类解决 |

---

## 📊 效率参考数据

| 模块 | 操作次数 | 类型检查失败 | 调试占比 | 关键教训 |
|------|----------|--------------|----------|----------|
| fs/ | 25 | 3 | 高 | 路径语义复杂 |
| react/ | 10 | 1 | 15% | ✅ 接口简单 |
| builtins/ | 22 | 1 | 25% | 工具数量多 |
| task+sub/ | **45** | **4** | **55%** | 🔴 最差：跨模块集成（6个依赖） |
| skill/ | **12** | **0** | **<10%** | ✨ **最优：AGENTS.md 规范生效** |

**结论**: 
1. 跨模块集成复杂度对效率的影响远大于经验积累
2. **AGENTS.md 规范可将高复杂度模块的效率提升到简单模块水平**（skill/ 12次 vs react/ 10次）

---

## 🛠️ 常见错误速查表

### 类型/接口错误
```typescript
// ❌ 错误：凭记忆写
const content = await fs.readFile(path);
monitor.logEvent('task_completed', data);
const monitor = new JsonlMonitor(clawDir, fs, options);

// ✅ 正确：查类型定义
const content = await fs.read(path);
monitor.log('task_completed', data);
const monitor = new JsonlMonitor({ logsDir: path.join(clawDir, 'logs') });
```

### Signal 传递错误
```typescript
// ❌ 错误：signal 丢失
const result = await runReact({ messages, llm, executor, ctx });

// ✅ 正确：传递 signal
const result = await runReact({ 
  messages, llm, executor, 
  ctx: { ...ctx, signal: abortController.signal }
});
```

### 目录创建错误
```typescript
// ❌ 错误：目录不存在
await WriteFile('src/core/new/module.ts', content);

// ✅ 正确：先创建目录
await Shell('mkdir -p src/core/new');
await WriteFile('src/core/new/module.ts', content);
```

---

## 📝 开发日志位置

项目开发日志位于：**`/Users/lleefir/code/mess/260315/development log/development_log.md`**

每轮开发结束后，在此文件追加本轮总结。

---

*最后更新: 2026-03-15 - skill/轮验证 AGENTS.md 规范有效性，新增高复杂度集成规则*
