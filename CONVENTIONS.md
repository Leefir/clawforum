# Clawforum 开发规范

## TypeScript 配置

### 未使用变量处理
```json
// tsconfig.json
{
  "compilerOptions": {
    "noUnusedLocals": false,      // 关闭 TS 严格检查
    "noUnusedParameters": false   // 允许未使用参数（用 _ 前缀标记）
  }
}
```

**原则：**
- 未使用的变量/参数用 `_` 前缀标记（如 `_unusedVar`）
- ESLint 会提示警告但不会阻塞编译
- 不要为消除编译器警告而删除可能需要的变量

## 文件组织规范

### 类型/接口文件位置决策

| 场景 | 规则 | 示例 |
|------|------|------|
| 模块内 **≤2 个实现文件** | 接口和实现同文件 | `executor.ts` 含 `ITool` + `ToolExecutorImpl` |
| 模块内 **≥3 个实现文件共享接口** | 单独 `types.ts` | `foundation/monitor/types.ts` |
| 跨模块共享的类型 | 放 `src/types/` | `src/types/message.ts` |
| 仅本模块使用的类型 | 放同目录 `types.ts` 或 `index.ts` | - |

**禁止在编码过程中临时决定文件位置**——先查此表再创建文件。

### 目录结构示例

```
src/
├── types/                 # 跨模块共享类型
│   ├── message.ts
│   ├── contract.ts
│   ├── config.ts
│   └── errors.ts
├── foundation/
│   ├── fs/               # 多文件 → 有 types.ts
│   │   ├── types.ts
│   │   ├── atomic.ts
│   │   └── node-fs.ts
│   ├── monitor/          # 多文件 → 有 types.ts
│   │   ├── types.ts
│   │   ├── jsonl.ts
│   │   └── monitor.ts
│   └── transport/        # 少文件 → 无 types.ts
│       ├── index.ts      # 接口定义在此
│       └── local.ts
└── core/
    ├── dialog/           # 少文件 → 有 types.ts（复杂数据结构）
    │   ├── types.ts
    │   ├── session.ts
    │   └── injector.ts
    └── tools/            # 接口实现同文件
        ├── executor.ts   # ITool + ToolExecutorImpl
        ├── registry.ts
        └── context.ts
```

## 异步超时处理

### 模式选择

| 场景 | 推荐方案 | 示例 |
|------|----------|------|
| 原生支持 AbortSignal（fetch, streams）| `AbortController` | `fetch(url, { signal })` |
| 自定义 async 函数 | `Promise.race` | 见下方 |

### Promise.race 超时模板

```typescript
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });
  
  return Promise.race([promise, timeoutPromise]);
}
```

## 编码检查清单

提交前自查：
- [ ] 类型检查通过 (`pnpm tsc --noEmit`)
- [ ] 测试通过 (`pnpm test`)
- [ ] 未使用的变量用 `_` 前缀标记
- [ ] 文件位置符合本规范
- [ ] 无 `void Promise` 模式

## 修订历史

- 2026-03-15: 制定初版规范（基于 Phase 0-1 经验总结）
