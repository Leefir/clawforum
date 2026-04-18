# L3 Gateway 模块契约

## 定位

Gateway 是**外部客户端 ↔ 内部系统**的实时交互门面（L3）。

- 上游消费者：Daemon（注入依赖并管理生命周期）
- 下游依赖：Transport (L1) + Stream (L2)

## 核心接口

### GatewayInput

```ts
interface GatewayInput {
  /** StreamReader 工厂；Gateway 注入 onEvent 回调后构造并启动 reader */
  streamFactory: (onEvent: (event: StreamEvent) => void) => StreamReader;

  /** 已处于 listening 状态的 Transport；undefined = offline 模式 */
  transport?: Transport;

  /** Daemon 注入的 interrupt 回调 */
  interrupt: (reason: 'user') => void;

  /** askUser 超时（Step 3 使用） */
  askUserTimeoutMs?: number;
}
```

**契约缺口 1 决议**：`streamFactory` 采用延迟绑定模型。
- Daemon 传入工厂函数；Gateway 注入 `onEvent = (ev) => broadcast({type:'stream', event:ev})` 后调用，再 `reader.start()`。
- 避免 Gateway 直接持有 FileSystem，保持 L3→L2 依赖方向。

**契约缺口 2 决议**：Transport 在传入 Gateway 之前**已经 listening**。
- Gateway.start() **不**调 `transport.listen()`。
- Gateway.stop() 调 `transport.close()`（所有权随注入转移）。

### Gateway

```ts
interface Gateway {
  start(): Promise<void>;
  stop(): Promise<void>;
  askUser(question: string, ctx: ExecContext): Promise<ToolResult>;
  getActiveConnections(): Connection[];
  isOnline(): boolean;
}
```

## 模式决策

### online / offline 模式

- `transport` 是否传入在构造时一次性决定，运行期不切换（内部模式定型）。
- `isOnline()` 是对外观察点：返回 `transport 已注入 && start() 已调 && stop() 未调`。`stop()` 后返回 false，语义等价"不再接受外部交互"。
- offline 模式：`start()`/`stop()` 均为 no-op；`getActiveConnections()` 始终返回 `[]`；`askUser()` 立即返回 failure。

### 客户端消息路由

| 消息 type | 处理 |
|---|---|
| `interrupt` | debounce 500ms 后调 `interrupt('user')` |
| `ask_user_reply` | Step 2 静默忽略；Step 3 路由到状态机 |
| malformed JSON / 未知 type | 内部 drop 连接 + broadcast `connection_dropped` |

### 连接 drop 语义

Transport 无 `disconnect(connId)` 方法，Gateway 以"内部 Map 删除 + broadcast 通知"实现 drop。若后续需强制清理 fd，反向扩 Transport 接口。

## 生命周期

`stop()` 拆除顺序：
1. 取消所有 pending askUser（reason:'abort'）
2. `streamReader.stop()` — 停止新事件推送
3. 遍历内部 connections，逐一 drop
4. `transport.close()` — 关闭所有 socket

## 状态

- `connections: Map<string, Connection>` — 派生自 transport.onConnect/onDisconnect，不持久化
- `lastInterruptTs: number` — 纯内存 debounce 窗口，重启归零可接受
- `pending: Map<string, AskUserEntry>` — 派生自 askUser 调用流，不持久化

## 失败语义表

| 场景 | 行为 |
|---|---|
| interrupt 回调抛错 | `console.error` 记录（带 `[Gateway]` 前缀），不影响其他消息/连接；Daemon 通过日志观察回调 bug |
| malformed JSON | drop 连接 + broadcast `connection_dropped` |
| 未知 message type | drop 连接 + broadcast `connection_dropped` |
| ask_user_reply 无 pending | 静默忽略，不 drop 连接 |
| ask_user_reply 重复/过期 | 静默忽略，不 drop 连接（first-wins） |
| askUser timeout | resolve `failureResult`，broadcast `ask_user_cancelled{reason:'timeout'}` |
| askUser abort | resolve `failureResult`，broadcast `ask_user_cancelled{reason:'abort'}` |
| offline askUser | 立即返回 `failureResult('未启用实时交互通道，跳过 ask_user')` |
