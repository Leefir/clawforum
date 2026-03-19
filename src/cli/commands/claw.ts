/**
 * claw command - Create and chat with Claws
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

import { 
  loadGlobalConfig, 
  loadClawConfig, 
  saveClawConfig, 
  clawExists,
  getClawDir,
  buildLLMConfig,
  getGlobalConfigPath,
  CLAW_SUBDIRS,
} from '../config.js';

import { runChatViewport } from './chat-viewport.js';

/**
 * 格式化相对时间（毫秒转为可读字符串）
 */
function formatRelativeTime(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h`;
}

import { ProcessManager } from '../../foundation/process/manager.js';
import { NodeFileSystem } from '../../foundation/fs/node-fs.js';
import { LocalTransport } from '../../foundation/transport/local.js';
import { randomUUID } from 'crypto';
import { PROCESS_SPAWN_CONFIRM_MS } from '../../constants.js';

export async function createCommand(name: string): Promise<void> {
  // Load global config (ensures initialized)
  loadGlobalConfig();
  
  // Check if claw already exists
  if (clawExists(name)) {
    console.error(`Error: Claw "${name}" already exists`);
    process.exit(1);
  }
  
  const clawDir = getClawDir(name);
  
  // Create directory structure (使用共享常量)
  for (const dir of CLAW_SUBDIRS) {
    fs.mkdirSync(path.join(clawDir, dir), { recursive: true });
  }
  
  // Create claw config (inherits from global)
  const config = {
    name,
    max_steps: 100,
    tool_profile: 'full' as const,
    subagent_max_steps: 20,
    max_concurrent_tasks: 3,
  };
  
  saveClawConfig(name, config);
  
  // Create AGENTS.md template
  const agentsMdPath = path.join(clawDir, 'AGENTS.md');
  const agentsTemplate = `你是 ${name}，一个 AI 助手。

## 契约工作流

当你收到契约任务时，系统会在 prompt 中注入契约详情（标题、目标、子任务列表）。

### 完成子任务

每完成一个子任务，**必须调用 done tool**：

\`\`\`
done: { "subtask": "<subtask-id>", "evidence": "完成说明" }
\`\`\`

**警告：禁止直接修改 progress.json**——直接写文件会绕过验收和通知机制，Motion 不会收到完成通知。

### 工作目录

你的工作目录是 claw 根目录。输出文件写到 \`clawspace/\` 下。

## 文件操作规范

- **写文件**：始终使用 \`write\` 工具，不要用 \`exec: cat/echo/tee\` 写文件
  - \`write\` 自动备份到 .versions/，exec 不会
  - \`write\` 有大小限制保护，exec 没有
- **读文件**：使用 \`read\` 工具，不要用 \`exec: cat\`
  - \`read\` 有路径白名单、行数上限（200行）、字符上限（8000字符）三层保护
  - \`exec: cat\` 绕过所有保护，可能把超大文件整个灌进 context
- \`exec\` 仅用于：shell 命令执行、进程管理

## 与 Motion 通信

使用 \`send\` 工具向 Motion 发送消息，消息写入 \`outbox/pending/\`，Motion 会定期查收。

类型：\`report\`（进展汇报）、\`question\`（请求帮助）、\`result\`（任务结果）、\`error\`（错误报告）

示例：
\`\`\`
send: { "type": "report", "content": "子任务 create-script 已完成" }
send: { "type": "question", "content": "找不到目标文件，请确认路径", "priority": "high" }
\`\`\`

请高效、准确地完成任务。
`;
  fs.writeFileSync(agentsMdPath, agentsTemplate);
  
  console.log(`✓ Created Claw "${name}"`);
  console.log(`  Location: ${clawDir}`);
  console.log(`\nNext step: clawforum claw chat ${name}`);
}

export async function chatCommand(name: string): Promise<void> {
  loadGlobalConfig();

  if (!clawExists(name)) {
    console.error(`Error: Claw "${name}" does not exist`);
    process.exit(1);
  }

  const clawDir = getClawDir(name);
  const globalConfigPath = getGlobalConfigPath();
  const baseDir = path.dirname(globalConfigPath);

  await runChatViewport({
    agentDir: clawDir,
    label: name,
    ensureDaemon: async () => {
      const nodeFs = new NodeFileSystem({ baseDir, enforcePermissions: false });
      const pm = new ProcessManager(nodeFs, baseDir);
      if (!pm.isAlive(name)) {
        console.log(`Starting Claw "${name}" daemon...`);
        const pid = await pm.spawn(name, clawDir);
        console.log(`Started (PID: ${pid})`);
        // 等待 daemon 初始化
        await new Promise(resolve => setTimeout(resolve, PROCESS_SPAWN_CONFIRM_MS));
      }
    },
  });
}

// ============================================================================
// Daemon Management Commands
// ============================================================================

/**
 * 停止 Claw 守护进程
 */
export async function stopCommand(name: string): Promise<void> {
  loadGlobalConfig();
  
  if (!clawExists(name)) {
    console.error(`Error: Claw "${name}" does not exist`);
    process.exit(1);
  }

  const globalConfigPath = getGlobalConfigPath();
  const baseDir = path.dirname(globalConfigPath);
  
  const nodeFs = new NodeFileSystem({ baseDir, enforcePermissions: false });
  const processManager = new ProcessManager(nodeFs, baseDir);

  // 检查是否运行
  if (!processManager.isAlive(name)) {
    console.log(`Claw "${name}" is not running`);
    return;
  }

  console.log(`Stopping Claw "${name}"...`);
  
  const success = await processManager.stop(name);
  if (success) {
    console.log(`Stopped Claw "${name}"`);
  } else {
    console.error(`Failed to stop Claw "${name}"`);
    process.exit(1);
  }
}

/**
 * 列出所有 Claw 及其状态
 */
export async function listCommand(): Promise<void> {
  loadGlobalConfig();

  const globalConfigPath = getGlobalConfigPath();
  const baseDir = path.dirname(globalConfigPath);
  const clawsDir = path.join(baseDir, 'claws');

  const nodeFs = new NodeFileSystem({ baseDir, enforcePermissions: false });
  const processManager = new ProcessManager(nodeFs, baseDir);

  // 辅助：检查契约状态
  function getContractStatus(clawPath: string): string {
    for (const sub of ['active', 'paused']) {
      try {
        const entries = fs.readdirSync(path.join(clawPath, 'contract', sub), { withFileTypes: true });
        if (entries.some(e => e.isDirectory())) return sub;
      } catch { /* skip */ }
    }
    return '-';
  }

  // 辅助：统计 outbox 未读
  function getOutboxCount(clawPath: string): number {
    try {
      return fs.readdirSync(path.join(clawPath, 'outbox', 'pending')).length;
    } catch { return 0; }
  }

  // 辅助：格式化相对时间
  function formatLastActive(clawPath: string): string {
    try {
      const stat = fs.statSync(path.join(clawPath, 'dialog', 'current.json'));
      const ms = Date.now() - stat.mtimeMs;
      const mins = Math.floor(ms / 60000);
      if (mins < 1) return '<1m';
      if (mins < 60) return `${mins}m`;
      const hours = Math.floor(mins / 60);
      return `${hours}h`;
    } catch { return '-'; }
  }

  try {
    // 确保 claws 目录存在
    if (!fs.existsSync(clawsDir)) {
      fs.mkdirSync(clawsDir, { recursive: true });
    }
    const entries = fs.readdirSync(clawsDir);
    const claws: Array<{
      name: string;
      status: string;
      pid?: string;
      contract: string;
      outbox: number;
      lastActive: string;
    }> = [];

    for (const entry of entries) {
      const clawPath = path.join(clawsDir, entry);
      const configPath = path.join(clawPath, 'config.yaml');
      if (fs.existsSync(configPath)) {
        const isRunning = processManager.isAlive(entry);
        let pid: string | undefined;

        if (isRunning) {
          try {
            const pidFile = path.join(clawPath, 'status', 'pid');
            pid = fs.readFileSync(pidFile, 'utf-8').trim();
          } catch { /* 忽略读取错误 */ }
        }

        claws.push({
          name: entry,
          status: isRunning ? 'running' : 'stopped',
          pid,
          contract: getContractStatus(clawPath),
          outbox: getOutboxCount(clawPath),
          lastActive: formatLastActive(clawPath),
        });
      }
    }

    if (claws.length === 0) {
      console.log('No claws found. Create one with: clawforum claw create <name>');
      return;
    }

    // 打印表格
    console.log('\nClaw List:');
    console.log('─'.repeat(80));
    console.log(`${'Name'.padEnd(20)} ${'Status'.padEnd(12)} ${'PID'.padEnd(10)} ${'Contract'.padEnd(10)} ${'Outbox'.padEnd(8)} ${'LastActive'.padEnd(10)}`);
    console.log('─'.repeat(80));

    for (const claw of claws) {
      const statusIcon = claw.status === 'running' ? '[running]' : '[stopped]';
      const pidStr = claw.pid || '-';
      console.log(`${claw.name.padEnd(20)} ${statusIcon.padEnd(12)} ${pidStr.padEnd(10)} ${claw.contract.padEnd(10)} ${String(claw.outbox).padEnd(8)} ${claw.lastActive.padEnd(10)}`);
    }

    console.log('─'.repeat(80));
    console.log(`\nTotal: ${claws.length} claws (${claws.filter(c => c.status === 'running').length} running)\n`);
  } catch (error) {
    console.error('Failed to list claws:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * 显示 Claw 健康状态（实时读取目录）
 */
export async function healthCommand(name: string): Promise<void> {
  loadGlobalConfig();

  if (!clawExists(name)) {
    console.error(`Error: Claw "${name}" does not exist`);
    process.exit(1);
  }

  const clawDir = getClawDir(name);
  const globalConfigPath = getGlobalConfigPath();
  const baseDir = path.dirname(globalConfigPath);

  const nodeFs = new NodeFileSystem({ baseDir, enforcePermissions: false });
  const processManager = new ProcessManager(nodeFs, baseDir);

  const isRunning = processManager.isAlive(name);

  // 实时读 inbox/outbox pending
  let inboxPending = 0;
  let outboxPending = 0;
  try {
    const entries = fs.readdirSync(path.join(clawDir, 'inbox', 'pending'));
    inboxPending = entries.length;
  } catch { /* 目录不存在 */ }
  try {
    const entries = fs.readdirSync(path.join(clawDir, 'outbox', 'pending'));
    outboxPending = entries.length;
  } catch { /* 目录不存在 */ }

  // 检查契约状态
  let contractStatus = 'none';
  for (const sub of ['active', 'paused']) {
    try {
      const entries = fs.readdirSync(
        path.join(clawDir, 'contract', sub), { withFileTypes: true }
      );
      if (entries.some(e => e.isDirectory())) {
        contractStatus = sub;
        break;
      }
    } catch { /* skip */ }
  }

  // 最后活跃时间
  let lastActive = '-';
  try {
    const stat = fs.statSync(path.join(clawDir, 'dialog', 'current.json'));
    const age = Date.now() - stat.mtimeMs;
    lastActive = formatRelativeTime(age);
  } catch { /* skip */ }

  console.log(`\nHealth Check: ${name}`);
  console.log('─'.repeat(40));
  console.log(`status: ${isRunning ? 'running' : 'stopped'}`);
  console.log(`inbox_pending: ${inboxPending}`);
  console.log(`outbox_pending: ${outboxPending}`);
  console.log(`contract: ${contractStatus}`);
  console.log(`last_active: ${lastActive}`);
}

// ============================================================================
// Send Message Command
// ============================================================================

/**
 * 向 Claw 发送 inbox 消息
 */
export async function sendCommand(
  name: string, 
  message: string, 
  options?: { priority?: 'critical' | 'high' | 'normal' | 'low' }
): Promise<void> {
  loadGlobalConfig();
  
  if (!clawExists(name)) {
    console.error(`Error: Claw "${name}" does not exist`);
    process.exit(1);
  }

  const globalConfigPath = getGlobalConfigPath();
  const baseDir = path.dirname(globalConfigPath);
  
  // 创建 transport（workspaceDir = baseDir，即 ~/.clawforum）
  const transport = new LocalTransport({ workspaceDir: baseDir });
  await transport.initialize();

  try {
    await transport.sendInboxMessage(name, {
      id: randomUUID(),
      type: 'user_inbox_message',
      from: 'motion',
      to: name,
      content: message,
      priority: options?.priority ?? 'normal',
      timestamp: new Date().toISOString(),
    });

    console.log(`Message sent to "${name}"`);
  } finally {
    await transport.close();
  }
}

// ============================================================================
// Outbox Command
// ============================================================================

/**
 * 读取并消费 Claw outbox 消息
 */
export async function outboxCommand(
  name: string,
  options?: { limit?: number }
): Promise<void> {
  loadGlobalConfig();

  if (!clawExists(name)) {
    console.error(`Error: Claw "${name}" does not exist`);
    process.exit(1);
  }

  const clawDir = getClawDir(name);
  const pendingDir = path.join(clawDir, 'outbox', 'pending');
  const doneDir = path.join(clawDir, 'outbox', 'done');

  // 读取 pending 文件
  let files: string[] = [];
  try {
    const allFiles = await fs.promises.readdir(pendingDir);
    files = allFiles.filter(f => f.endsWith('.md')).sort();
  } catch {
    console.log('outbox 为空');
    return;
  }

  if (files.length === 0) {
    console.log('outbox 为空');
    return;
  }

  // 限制读取数量（默认 1）
  const limit = options?.limit ?? 1;
  const toRead = files.slice(0, limit);
  const remaining = files.length - toRead.length;

  // 读取并输出
  const results: string[] = [];
  for (const fileName of toRead) {
    const filePath = path.join(pendingDir, fileName);
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      results.push(content);

      // 移入 done/
      try {
        await fs.promises.mkdir(doneDir, { recursive: true });
        await fs.promises.rename(filePath, path.join(doneDir, `${Date.now()}_${fileName}`));
      } catch {
        // 移动失败不阻止
      }
    } catch {
      // 读取失败跳过
    }
  }

  // 输出
  for (const content of results) {
    console.log(content);
    console.log('---');
  }

  if (remaining > 0) {
    console.log(`（还有 ${remaining} 条未读消息）`);
  }
}
