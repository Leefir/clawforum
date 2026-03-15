# 技术债务追踪

## 已修复

### ~~1. ILLMService 空接口问题~~
**位置**: `src/foundation/llm/index.ts`
**修复**: 补全接口方法声明
**提交**: `572a525` (Step 10)

### ~~2. fs.list 路径语义问题~~
**位置**: `src/foundation/fs/node-fs.ts`
**问题**: `list()` 返回的 `entry.path` 相对于被列举目录而非 fs 根目录
**修复**: 改为相对于 `this.options.baseDir`（fs 根目录）
**提交**: 本轮 (Step 11)
**影响**: 移除了 search 工具中的路径拼接 workaround
**位置**: `src/foundation/llm/index.ts`
**修复**: 补全接口方法声明，`LLMService implements ILLMService`
**提交**: `c1f8e5b` (合并入 Step 10)

## 待修复
**位置**: `src/foundation/llm/index.ts`
**问题**: 
```typescript
export interface ILLMService {}  // 空接口，无方法声明
```
实际方法全在 `LLMService` 类上，导致：
- `core/react/loop.ts` 直接依赖具体类而非接口
- 违反依赖倒置原则
- 未来替换 LLM 提供者时需要修改调用方

**修复方案**:
```typescript
export interface ILLMService {
  call(options: LLMCallOptions): Promise<LLMResponse>;
  stream(options: LLMCallOptions): AsyncIterableIterator<StreamChunk>;
  close(): Promise<void>;
  healthCheck(): Promise<boolean>;
  getProviderInfo(): { name: string; model: string; isFallback: boolean };
}
```

**影响范围**: `core/react/loop.ts` 需改为 `llm: ILLMService`

**优先级**: 中（在 Phase 2 开始前修复）

---

## 已修复

### ~~1. 指数退避无上限~~
**修复**: 添加 `Math.min(..., 30_000)` 上限
**提交**: `ef1573b`

### ~~2. usingFallback 永不重置~~
**修复**: primary 成功后重置 `usingFallback = false`
**提交**: `ef1573b`

### ~~3. 未使用变量反复出现~~
**修复**: 关闭 `tsconfig.noUnusedLocals`，制定 CONVENTIONS.md
**提交**: `6842ede`

---

## 记录规范

新增技术债格式：
```markdown
### N. 标题
**位置**: 文件路径
**问题**: 描述
**修复方案**: 具体步骤
**优先级**: 高/中/低
**预计修复时间**: X 小时
```

修复后移动到"已修复"章节，标注提交哈希。
