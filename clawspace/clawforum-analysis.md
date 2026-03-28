# Clawforum 项目分析报告

## 1. 项目概览

**Clawforum** 是一个 **AI Agent 编排系统**，用于管理和编排多个 AI Agents（称为 "Claws"）协同工作。该系统采用模块化架构，支持任务调度、契约管理、对话交互等核心功能。

- **版本**: 0.1.0
- **技术栈**: TypeScript + Node.js (>=22.0.0)
- **构建工具**: tsup
- **主要依赖**: commander, js-yaml, zod, chokidar, ink, react

---

## 2. 项目结构分析

```
clawforum/
├── src/
│   ├── index.ts              # 主入口 - 导出库
│   ├── daemon-entry.ts       # Daemon 进程入口
│   ├── watchdog-entry.ts    # Watchdog 进程入口
│   ├── constants.ts          # 全局常量定义
│   │
│   ├── cli/                  # CLI 命令模块
│   │   ├── index.ts          # CLI 主入口 (使用 commander)
│   │   ├── config.ts         # 配置管理
│   │   ├── commands/        # CLI 命令实现
│   │   │   ├── init.ts      # 初始化命令
│   │   │   ├── start.ts     # 启动系统命令
│   │   │   ├── stop.ts     # 停止所有进程
│   │   │   ├── status.ts   # 状态查看
│   │   │   ├── claw.ts     # Claw 管理 (create/chat/stop/list)
│   │   │   ├── motion.ts   # Motion 管理
│   │   │   ├── contract.ts # 契约命令
│   │   │   ├── skill.ts    # Skill 安装
│   │   │   ├── config.ts   # 配置命令
│   │   │   ├── daemon.ts   # Daemon 命令
│   │   │   ├── watchdog.ts # Watchdog 命令
│   │   │   └── ...
│   │   ├── utils/           # CLI 工具函数
│   │   ├── ink/            # Ink React 组件
│   │   └── pi-tui/         # Pi-TUI 组件
│   │
│   ├── core/                # 核心运行时模块
│   │   ├── index.ts        # 核心模块导出
│   │   ├── runtime.ts      # ClawRuntime (主运行时 - 30KB+)
│   │   ├── heartbeat.ts    # 心跳模块
│   │   ├── outbox-scanner.ts # 出件箱扫描
│   │   │
│   │   ├── contract/       # 契约系统
│   │   │   ├── manager.ts  # ContractManager (45KB+)
│   │   │   └── index.ts
│   │   │
│   │   ├── dialog/         # 对话管理
│   │   │   ├── session.ts  # 会话管理
│   │   │   ├── injector.ts # 上下文注入
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── communication/  # 通信模块
│   │   │   ├── inbox.ts    # 收件箱 (InboxWatcher)
│   │   │   ├── outbox.ts   # 出件箱 (OutboxWriter)
│   │   │   └── index.ts
│   │   │
│   │   ├── task/           # 任务系统
│   │   │   ├── system.ts   # TaskSystem (36KB+)
│   │   │   └── index.ts
│   │   │
│   │   ├── tools/          # 工具系统
│   │   │   ├── executor.ts # 工具执行器
│   │   │   ├── registry.ts # 工具注册表
│   │   │   ├── context.ts  # 执行上下文
│   │   │   ├── profiles.ts # 工具配置
│   │   │   ├── builtins/   # 内置工具 (read, ls, search, exec, dispatch...)
│   │   │   └── index.ts
│   │   │
│   │   ├── skill/         # Skill 注册表
│   │   ├── subagent/      # 子代理 (SubAgent)
│   │   ├── motion/        # Motion 运行时
│   │   ├── react/         # ReAct 循环
│   │   ├── cron/          # 定时任务
│   │   └── index.ts
│   │
│   ├── foundation/         # 基础层 (底层服务)
│   │   ├── fs/            # 文件系统抽象
│   │   ├── llm/           # LLM 服务封装
│   │   ├── monitor/       # 事件监控/日志
│   │   ├── process/       # 进程管理
│   │   └── transport/     # 传输层 (LocalTransport)
│   │
│   ├── types/              # 类型定义
│   │   ├── contract.ts    # 契约类型
│   │   ├── errors.ts      # 错误类型
│   │   ├── message.ts    # 消息类型
│   │   └── config.ts     # 配置类型
│   │
│   ├── prompts/           # 提示词模板
│   └── utils/             # 工具函数
│
├── dist/                  # 构建输出
├── tests/                 # 测试
├── skills/                # Skill 定义
├── package.json
└── tsup.config.ts
```

---

## 3. 核心模块详解

### 3.1 Claw 管理模块 (cli/commands/claw.ts)

**功能**: 管理和操作名为 "Claw" 的 AI Agent 实例

```
claw create <name>     - 创建新 Claw
claw chat <name>       - 与 Claw 交互
claw stop <name>       - 停止 Claw
claw list              - 列出所有 Claws
claw health <name>     - 检查健康状态
claw send <name>      - 发送消息
claw outbox <name>    - 查看出件箱
```

### 3.2 契约系统 (core/contract/manager.ts)

**功能**: 管理任务契约的生命周期，包括:
- 契约加载和解析 (YAML)
- 进度跟踪 (ProgressData)
- 验收机制 (AcceptanceResult)
- 状态转换 (ContractStatus)

**核心概念**:
```typescript
interface ContractYaml {
  schema_version?: number;
  id?: string;
  title: string;
  goal: string;
  deliverables?: string[];
  subtasks: Array<{
    id: string;
    description: string;
  }>;
  acceptance?: Array<...>;
  auth_level?: 'auto' | 'notify' | 'confirm';
  escalation?: { max_retries?: number; };  // 重试配置
}
```

### 3.3 契约命令列表 (cli/commands/contract.ts)

```
contract create <file>           - 创建契约
contract create-from-dir <dir>    - 从目录创建契约
contract log <claw>               - 查看契约日志
```

### 3.4 日志/监控模块 (foundation/monitor/)

**组件**:
- `JsonlMonitor` - JSONL 格式的日志写入
- `MonitorEvent` - 监控事件类型
- `LLMCallEvent`, `ToolCallEvent` - 事件追踪

**日志位置**: `{clawDir}/dialog/stream.jsonl`

### 3.5 对话系统 (core/dialog/)

**组件**:
- `SessionManager` - 会话管理
- `ContextInjector` - 上下文注入
- 维护对话历史和状态

### 3.6 工具系统 (core/tools/)

**内置工具**:
- `read` - 读取文件
- `ls` - 列出目录
- `search` - 搜索文件
- `exec` - 执行命令
- `dispatch` - 分发任务
- `ReportResultTool` - 报告结果

**工具执行器**: `ToolExecutorImpl` + `ExecContextImpl`

### 3.7 Motion 模块

**功能**: 主控 Agent，管理所有 Claws

```
motion init                - 初始化 Motion
motion chat               - 与 Motion 对话
motion stop               - 停止 Motion
```

### 3.8 Watchdog 模块

**功能**: 系统守护进程，管理整个系统的生命周期

```
watchdog start            - 启动 Watchdog
watchdog stop             - 停止 Watchdog
watchdog daemon           - 运行守护进程
```

### 3.9 Skill 系统 (core/skill/)

**功能**: 安装和管理 Skills (扩展能力)

```
skill install-user <path> - 安装用户 Skill
skill install-claw <name> - 安装 Claw Skill
```

---

## 4. CLI 命令完整列表

### 4.1 顶级命令

```bash
clawforum --version        # 显示版本
clawforum --help           # 帮助

clawforum config           # 配置管理
clawforum stop             # 停止所有进程
clawforum status           # 查看状态
clawforum start            # 启动系统 + ��开 Motion
clawforum init             # 初始化工作区
```

### 4.2 Claw 子命令

```bash
clawforum claw create <name>     # 创建 Claw
clawforum claw chat <name>       # 对话
clawforum claw stop <name>      # 停止
clawforum claw list             # 列表
clawforum claw health <name>    # 健康检查
clawforum claw send <name>      # 发送消息
clawforum claw outbox <name>    # 出件箱
```

### 4.3 Motion 子命令

```bash
clawforum motion init            # 初始化 Motion
clawforum motion chat            # 与 Motion 对话
clawforum motion stop            # 停止 Motion
```

### 4.4 Contract 子命令

```bash
clawforum contract create <file>         # 创建契约
clawforum contract create-from-dir <dir> # 目录创建
clawforum contract log <claw>           # 查看日志
```

### 4.5 Skill 子命令

```bash
clawforum skill install-user <path>     # 安装用户 Skill
clawforum skill install-claw <name>     # 安装 Claw Skill
```

### 4.6 Watchdog 子命令

```bash
clawforum watchdog start                 # 启动
clawforum watchdog stop                  # 停止
clawforum watchdog daemon                # 守护进程
```

---

## 5. 主要入口文件

### 5.1 CLI 主入口

**文件**: `src/cli/index.ts`

- 使用 `commander` 定义所有命令
- 导入各子命令模块
- 默认 `bin` 入口: `./dist/cli.js`

### 5.2 库主入口

**文件**: `src/index.ts`

```typescript
export * from './types/index.js';
export * from './core/index.js';
export { NodeFileSystem } from './foundation/fs/node-fs.js';
export { JsonlMonitor } from './foundation/monitor/index.js';
export { LLMService } from './foundation/llm/service.js';
export { LocalTransport } from './foundation/transport/local.js';
export const VERSION = '0.1.0';
```

### 5.3 进程入口

| 入口文件 | 用途 |
|---------|------|
| `src/daemon-entry.ts` | Claw daemon 进程入口 |
| `src/watchdog-entry.ts` | Watchdog 守护进程入口 |
| `src/cli/index.ts` | CLI 主入口 |

### 5.4 核心运行时

**文件**: `src/core/runtime.ts` (ClawRuntime)

负责组装以下模块:
- Foundation: `NodeFileSystem`, `LLMService`, `JsonlMonitor`, `LocalTransport`
- Core: `Dialog`, `Tools`, `ReAct`, `Communication`, `Task`, `Skill`, `Contract`

### 5.5 构建配置

- **构建工具**: `tsup` (tsup.config.ts)
- **输出目录**: `dist/`
- **入口点**:
  - `./dist/index.js` (module)
  - `./dist/index.cjs` (main)
  - `./dist/cli.js` (bin)
  - `./dist/index.d.ts` (types)

---

## 6. 目录结构规范

### Claw 工作区结构

```
.clawforum/
├── config.yaml           # 全局配置
├── global.d.ts          # 全局类型定义
└── <claw-name>/
    ├── config.yaml     # Claw 配置
    ├── dialog/
    │   └── stream.jsonl  # 对话日志
    ├── contract/
    │   ├── active/    # 活跃契约
    │   ├── paused/    # 暂停契约
    │   └── archive/   # 归档契约
    ├── inbox/         # 收件箱
    ├── outbox/       # 出件箱
    ├── skills/       # 安装的 Skills
    └── watchdog/    # Watchdog 数据
```

---

## 7. 关键常量 (src/constants.ts)

- `LOCK_MAX_RETRIES` - 锁最大重试次数
- `LOCK_RETRY_DELAY_MS` - 锁重试延迟
- `LOCK_STALE_TIMEOUT_MS` - 锁过期超时
- `CONTRACT_SCRIPT_TIMEOUT_MS` - 契约脚本超时
- `CONTRACT_LLM_IDLE_TIMEOUT_MS` - LLM 空闲超时
- `CONTRACT_VERIFIER_MAX_STEPS` - 验证最大步数
- `DEFAULT_MAX_STEPS` - 默认最大步数
- `DEFAULT_LLM_IDLE_TIMEOUT_MS` - 默认 LLM 空闲超时

---

## 8. 核心组件交互图

```
┌─────────────────────────────────────────────────────────┐
│                    Watchdog                             │
│              (系统守护进程 - 生命周期管理)               │
└─────────────────────┬───────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        │                           │
        ▼                           ▼
┌───────────────┐          ┌───────────────┐
│    Motion     │          │     Claws     │
│  (主控 Agent) │◄────────►│  (工作 Agents)│
└───────┬───────┘          └───────┬───────┘
        │                          │
        ▼                          ▼
┌───────────────┐          ┌───────────────┐
│   Dialog      │          │    Task       │
│   System     │          │    System     │
└───────┬───────┘          └───────┬───────┘
        │                          │
        ▼                          ▼
┌───────────────┐          ┌───────────────┐
│  Contract     │          │    Tools      │
│  Manager     │          │  Executor     │
└───────────────┘          └───────────────┘
        │                          │
        ▼                          ▼
┌───────────────┐          ┌───────────────┐
│  Communication│          │  Foundation  │
│  (inbox/outbox)│          │  (FS/LLM/Monitor)│
└───────────────┘          └───────────────┘
```

---

## 9. 总结

Clawforum 是一个功能完整的 AI Agent 编排系统，具有以下特点:

1. **模块化设计**: 清晰的分层结构 (Foundation → Core → CLI)
2. **多 Agent 协作**: 支持 Motion + 多个 Claws 协同工作
3. **契约驱动任务**: 基于 YAML 契约定义任务和验收标准
4. **完善的生命周期管理**: Watchdog + Daemon 守护进程
5. **灵活的扩展**: Skill 系统支持能力扩展
6. **丰富的 CLI**: 完整的命令行工具集
7. **监控和日志**: 完整的事件追踪和日志系统

---

*报告生成时间: $(date)*