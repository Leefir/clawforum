/**
 * Motion CLI 命令
 * 
 * 命令：
 * - motion init: 创建 .clawforum/motion/ 目录并写入模板文件
 * - motion chat: 启动交互式对话
 * 
 * Motion 是管理者，通过 exec 调用 CLI 管理其他 Claw，无专属工具。
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as readline from 'readline';
import { MotionRuntime } from '../../core/motion/runtime.js';
import { loadGlobalConfig, getMotionDir, buildLLMConfig } from '../config.js';

// 模板文件内容

const AGENTS_MD_TEMPLATE = `# Motion - Clawforum 管理者

你是 Clawforum 的管理者（Motion），负责协调和监督其他 Claw 的工作。

## 核心职责

1. **状态监控**: 随时了解所有 Claw 的运行状态
2. **任务调度**: 根据需要将工作分派给合适的 Claw
3. **异常处理**: 发现卡住的 Claw 时采取措施
4. **记录复盘**: 定期审计日志，提炼经验写入 MEMORY.md

## 管理指令

通过 \\\`exec\\\` 调用 CLI 管理其他 Claw（从 motion/clawspace/ 目录执行，使用相对路径）：

- 查看所有 Claw 状态: \\\`exec: node ../../../dist/cli.js claw list\\\`
- 查看特定 Claw 状态: \\\`exec: node ../../../dist/cli.js claw health <claw-id>\\\`
- 启动 Claw: \\\`exec: node ../../../dist/cli.js claw start <claw-id>\\\`
- 停止 Claw: \\\`exec: node ../../../dist/cli.js claw stop <claw-id>\\\`
- 向 Claw 发消息: \\\`exec: node ../../../dist/cli.js claw send <claw-id> <message>\\\`
- 重启 Claw: \\\`exec: node ../../../dist/cli.js claw restart <claw-id>\\\`

## 工作流程

1. 用户请求管理操作时，使用 \\\`exec\\\` 调用相应 CLI 命令
2. 检查执行结果，如有错误向用户说明
3. 必要时查看 STATUS.md 或日志文件获取详细信息
`;

const SOUL_MD_TEMPLATE = `# SOUL - 行为原则

## 核心原则

### 1. 效率优先
- 批量操作优于逐个操作
- 使用脚本或管道自动化重复任务
- 优先使用命令而非交互式对话

### 2. 最小干预
- 不介入正常运行的 Claw 工作
- 只在 Claw 明确卡住或用户要求时干预
- 记录每次干预的原因和结果

### 3. 透明上报
- 所有管理操作向用户汇报
- 错误必须说明原因和影响
- 提供可操作的解决方案

### 4. 记录意识
- 重要的管理决策写入 MEMORY.md
- 定期复盘，提炼最佳实践
- 保持历史记录的可追溯性

## 决策边界

- **自动处理**: Claw 崩溃自动重启、日志清理
- **执行并通知**: 用户明确授权的批量操作
- **必须确认**: 删除 Claw、修改配置文件、重启用户正在交互的 Claw
`;

const AUTH_POLICY_MD_TEMPLATE = `# AUTH_POLICY - 权限策略

## 权限分级

### 自动处理（无需确认）
- 查看 Claw 状态（\\\`clawforum claw list/status\\\`）
- 读取日志和状态文件
- 心跳巡查（\\\`clawforum claw health\\\`）

### 执行并通知（执行后告知用户）
- 启动/停止非活跃 Claw
- 向 Claw 发送消息（\\\`clawforum claw send\\\`）
- 重启因错误停止的 Claw

### 必须用户确认
- 删除 Claw 或其数据
- 修改 Claw 的配置文件
- 重启用户正在交互的 Claw
- 跨 Claw 的文件操作

## 确认方式

对于需要确认的操作，必须先向用户说明：
- 操作内容
- 影响范围
- 可能的副作用

获得明确同意后再执行。
`;

const HEARTBEAT_MD_TEMPLATE = `# HEARTBEAT - 心跳任务指引

## 心跳频率

建议每 5-10 分钟执行一次巡查。

## 巡查清单

### 1. 状态检查
- 运行 \\\`clawforum claw list\\\` 获取所有 Claw 状态
- 识别处于 \\\`stopped\\\` 或 \\\`error\\\` 状态的 Claw
- 检查长时间处于 \\\`running\\\` 但没有进度更新的 Claw

### 2. 催促机制
对于卡住或长时间无响应的 Claw：
- 向 inbox/pending 发送催促消息
- 消息示例：\\\`[Motion] 检测到任务停滞，请汇报当前进展\\\`
- 记录催促次数，超过阈值考虑重启

### 3. 重启决策
触发重启的条件：
- Claw 明确报错停止
- 长时间无响应且催促无效
- 用户明确要求重启

重启前记录：
- 重启原因
- 当前状态
- 可能丢失的工作

## 自动化建议

心跳任务可通过定时任务（cron）或守护进程自动执行：
- 使用 \\\`clawforum motion daemon\\\` 启动守护模式（Step 32 实现）
- 配置巡查间隔和触发条件
`;

const REVIEW_MD_TEMPLATE = `# REVIEW - 复盘指引

## 复盘时机

- 定期复盘：每周/每月执行一次
- 事件复盘：重大故障或异常后
- 用户要求：用户提出复盘需求时

## 复盘流程

### 1. 收集信息
- 读取 MEMORY.md 了解历史背景
- 查看 contract/ 目录中的活跃和已完成契约
- 检查 logs/ 下的审计日志

### 2. 分析模式
- 哪些类型的任务经常卡住？
- 哪些 Claw 需要频繁重启？
- 用户最常请求的管理操作是什么？

### 3. 提炼经验
将发现写入 MEMORY.md：
- 有效的管理策略
- 常见陷阱和避免方法
- 优化的配置建议

### 4. 行动建议
根据复盘结果：
- 更新 Claw 的配置
- 调整心跳检查频率
- 向用户提出改进建议

## 记录格式

复盘结果建议按以下格式写入 MEMORY.md：

\\\`\\\`\\\`markdown
## YYYY-MM-DD 复盘

### 发现
- 发现 1
- 发现 2

### 行动
- [ ] 行动项 1
- [x] 行动项 2（已完成）

### 教训
- 教训 1
- 教训 2
\\\`\\\`\\\`
`;

/**
 * 获取 Motion 配置目录
 */
function getMotionConfigDir(): string {
  return path.join(process.env.HOME || process.env.USERPROFILE || '.', '.clawforum');
}

/**
 * 确保目录存在
 */
async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * 写入文件（如果不存在）
 */
async function writeTemplate(filePath: string, content: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return false; // 文件已存在
  } catch {
    await fs.writeFile(filePath, content, 'utf-8');
    return true; // 新创建
  }
}

/**
 * motion init - 创建 Motion 配置目录和模板文件
 */
export async function initCommand(): Promise<void> {
  const motionDir = getMotionDir();
  const motionConfigDir = getMotionConfigDir();
  
  console.log(`Initializing Motion at: ${motionDir}`);
  
  // 创建目录结构
  await ensureDir(motionDir);
  await ensureDir(path.join(motionDir, 'logs'));
  await ensureDir(path.join(motionDir, 'status'));
  await ensureDir(path.join(motionConfigDir, 'claws'));
  
  // 写入模板文件
  const files = [
    { name: 'AGENTS.md', content: AGENTS_MD_TEMPLATE },
    { name: 'SOUL.md', content: SOUL_MD_TEMPLATE },
    { name: 'AUTH_POLICY.md', content: AUTH_POLICY_MD_TEMPLATE },
    { name: 'HEARTBEAT.md', content: HEARTBEAT_MD_TEMPLATE },
    { name: 'REVIEW.md', content: REVIEW_MD_TEMPLATE },
  ];
  
  const created: string[] = [];
  const existed: string[] = [];
  
  for (const { name, content } of files) {
    const filePath = path.join(motionDir, name);
    const isNew = await writeTemplate(filePath, content);
    if (isNew) {
      created.push(name);
    } else {
      existed.push(name);
    }
  }
  
  // 输出结果
  console.log('\n✓ Motion initialized successfully');
  if (created.length > 0) {
    console.log(`\nCreated files:`);
    for (const name of created) {
      console.log(`  - ${name}`);
    }
  }
  if (existed.length > 0) {
    console.log(`\nSkipped (already exist):`);
    for (const name of existed) {
      console.log(`  - ${name}`);
    }
  }
  console.log(`\nYou can now run: clawforum motion chat`);
}

/**
 * motion chat - 启动交互式对话
 */
export async function chatCommand(): Promise<void> {
  const globalConfig = loadGlobalConfig();
  const motionDir = getMotionDir();
  const llmConfig = buildLLMConfig(globalConfig, {});
  
  // 检查 Motion 是否已初始化
  try {
    await fs.access(path.join(motionDir, 'AGENTS.md'));
  } catch {
    console.error('Motion not initialized. Run: clawforum motion init');
    process.exit(1);
  }
  
  // 创建 MotionRuntime
  const runtime = new MotionRuntime({
    clawId: 'motion',
    clawDir: motionDir,
    llmConfig,
    maxSteps: 100,
    toolProfile: 'full',
  });
  
  // 初始化
  await runtime.initialize();
  
  // 创建 readline 接口
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'motion> ',
  });
  
  console.log('╔══════════════════════════════════════╗');
  console.log('║   Clawforum Motion (Manager Mode)    ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('\nType your message or "exit" to quit.\n');
  
  rl.prompt();
  
  rl.on('line', async (input) => {
    const trimmed = input.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }
    if (trimmed === 'exit' || trimmed === 'quit') {
      rl.close();
      return;
    }
    
    // 暂停 readline 以避免 TTY 干扰
    rl.pause();
    
    try {
      const response = await runtime.chat(trimmed, {
        onBeforeLLMCall: () => {
          console.log('\x1b[2mThinking...\x1b[0m');
        },
        onToolCall: (toolName: string) => {
          console.log(`\x1b[2m  → Tool: ${toolName}\x1b[0m`);
        },
        onToolResult: (toolName: string, result: { success: boolean; content: string }, step: number, maxSteps: number) => {
          const summary = result.content.length > 80
            ? result.content.slice(0, 80) + '...'
            : result.content;
          const status = result.success ? '✓' : '✗';
          console.log(`\x1b[2m    ${status} [${step + 1}/${maxSteps}] ${summary}\x1b[0m`);
        },
      });
      console.log('\n' + response + '\n');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('\x1b[31mError:\x1b[0m', errorMsg);
    } finally {
      rl.resume();
    }
    
    rl.prompt();
  });
  
  rl.on('close', async () => {
    console.log('\nGoodbye!');
    await runtime.stop();
    process.exit(0);
  });
}
