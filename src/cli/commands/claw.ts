/**
 * claw command - Create and chat with Claws
 */

import * as fs from 'fs';
import * as fsNative from 'fs';
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

function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.message === 'Execution aborted';
  }
  return false;
}
import { ProcessManager } from '../../foundation/process/manager.js';
import { NodeFileSystem } from '../../foundation/fs/node-fs.js';
import { LocalTransport } from '../../foundation/transport/local.js';
import { randomUUID } from 'crypto';

export async function createCommand(name: string): Promise<void> {
  // Load global config (ensures initialized)
  loadGlobalConfig();
  
  // Check if claw already exists
  if (clawExists(name)) {
    console.error(`❌ Claw "${name}" already exists`);
    process.exit(1);
  }
  
  const clawDir = getClawDir(name);
  
  // Create directory structure (使用共享常量)
  for (const dir of CLAW_SUBDIRS) {
    fsNative.mkdirSync(path.join(clawDir, dir), { recursive: true });
  }
  
  // Create claw config (inherits from global)
  const config = {
    name,
    max_steps: 100,
    tool_profile: 'full' as const,
  };
  
  saveClawConfig(name, config);
  
  // Create AGENTS.md template
  const agentsMdPath = path.join(clawDir, 'AGENTS.md');
  const agentsTemplate = `你是 ${name}，一个 AI 助手。

你可以使用以下工具：
- read: 读取文件内容
- write: 写入文件内容
- ls: 列出目录内容
- search: 搜索文件
- exec: 执行命令
- skill: 加载技能
- done: 标记子任务完成（触发验收）

## 契约工作流

当你收到契约任务时，系统会在 prompt 中注入契约详情（标题、目标、子任务列表）。

### 完成子任务

每完成一个子任务，**必须调用 done tool**：

\`\`\`
done: { "subtask": "<subtask-id>", "evidence": "完成说明" }
\`\`\`

⚠️ **禁止直接修改 progress.json**——直接写文件会绕过验收和通知机制，Motion 不会收到完成通知。

### 工作目录

你的工作目录是 claw 根目录。输出文件写到 \`clawspace/\` 下。

请高效、准确地完成用户的任务。
`;
  fs.writeFileSync(agentsMdPath, agentsTemplate);
  
  console.log(`✓ Created Claw "${name}"`);
  console.log(`  Location: ${clawDir}`);
  console.log(`\nNext step: clawforum claw chat ${name}`);
}

export async function chatCommand(name: string): Promise<void> {
  loadGlobalConfig();

  if (!clawExists(name)) {
    console.error(`❌ Claw "${name}" does not exist`);
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
        console.log(`✅ Started (PID: ${pid})`);
        // 等待 daemon 初始化
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    },
  });
}

// ============================================================================
// Daemon Management Commands
// ============================================================================

/**
 * 启动 Claw 守护进程
 */
export async function startCommand(name: string): Promise<void> {
  loadGlobalConfig();
  
  if (!clawExists(name)) {
    console.error(`❌ Claw "${name}" does not exist`);
    process.exit(1);
  }

  const clawDir = getClawDir(name);
  const globalConfigPath = getGlobalConfigPath();
  const baseDir = path.dirname(globalConfigPath);
  
  const fs = new NodeFileSystem({ baseDir, enforcePermissions: false });
  const processManager = new ProcessManager(fs, baseDir);

  // 检查是否已运行
  if (processManager.isAlive(name)) {
    console.log(`ℹ️  Claw "${name}" is already running`);
    return;
  }

  try {
    const pid = await processManager.spawn(name, clawDir);
    console.log(`✅ Started Claw "${name}" (PID: ${pid})`);
  } catch (error) {
    console.error('❌ Failed to start:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * 停止 Claw 守护进程
 */
export async function stopCommand(name: string): Promise<void> {
  loadGlobalConfig();
  
  if (!clawExists(name)) {
    console.error(`❌ Claw "${name}" does not exist`);
    process.exit(1);
  }

  const globalConfigPath = getGlobalConfigPath();
  const baseDir = path.dirname(globalConfigPath);
  
  const fs = new NodeFileSystem({ baseDir, enforcePermissions: false });
  const processManager = new ProcessManager(fs, baseDir);

  // 检查是否运行
  if (!processManager.isAlive(name)) {
    console.log(`ℹ️  Claw "${name}" is not running`);
    return;
  }

  console.log(`🛑 Stopping Claw "${name}"...`);
  
  const success = await processManager.stop(name);
  if (success) {
    console.log(`✅ Stopped Claw "${name}"`);
  } else {
    console.error(`❌ Failed to stop Claw "${name}"`);
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

  const fs = new NodeFileSystem({ baseDir, enforcePermissions: false });
  const processManager = new ProcessManager(fs, baseDir);

  try {
    // 确保 claws 目录存在
    if (!fsNative.existsSync(clawsDir)) {
      fsNative.mkdirSync(clawsDir, { recursive: true });
    }
    const entries = fsNative.readdirSync(clawsDir);
    const claws: Array<{ name: string; status: string; pid?: string }> = [];

    for (const entry of entries) {
      const configPath = path.join(clawsDir, entry, 'config.yaml');
      if (fsNative.existsSync(configPath)) {
        const isRunning = processManager.isAlive(entry);
        let pid: string | undefined;
        
        if (isRunning) {
          try {
            const pidFile = path.join(clawsDir, entry, 'status', 'pid');
            pid = fsNative.readFileSync(pidFile, 'utf-8').trim();
          } catch {
            // 忽略读取错误
          }
        }

        claws.push({
          name: entry,
          status: isRunning ? 'running' : 'stopped',
          pid,
        });
      }
    }

    if (claws.length === 0) {
      console.log('No claws found. Create one with: clawforum claw create <name>');
      return;
    }

    // 打印表格
    console.log('\n📋 Claw List:');
    console.log('─'.repeat(60));
    console.log(`${'Name'.padEnd(20)} ${'Status'.padEnd(12)} ${'PID'.padEnd(10)}`);
    console.log('─'.repeat(60));
    
    for (const claw of claws) {
      const statusIcon = claw.status === 'running' ? '🟢' : '⚪';
      const pidStr = claw.pid || '-';
      console.log(`${claw.name.padEnd(20)} ${statusIcon} ${claw.status.padEnd(10)} ${pidStr.padEnd(10)}`);
    }
    
    console.log('─'.repeat(60));
    console.log(`\nTotal: ${claws.length} claws (${claws.filter(c => c.status === 'running').length} running)\n`);
  } catch (error) {
    console.error('❌ Failed to list claws:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * 显示 Claw 健康状态
 */
export async function healthCommand(name: string): Promise<void> {
  loadGlobalConfig();
  
  if (!clawExists(name)) {
    console.error(`❌ Claw "${name}" does not exist`);
    process.exit(1);
  }

  const clawDir = getClawDir(name);
  const statusFile = path.join(clawDir, 'status', 'STATUS.md');
  const globalConfigPath = getGlobalConfigPath();
  const baseDir = path.dirname(globalConfigPath);
  
  const fs = new NodeFileSystem({ baseDir, enforcePermissions: false });
  const processManager = new ProcessManager(fs, baseDir);

  // 显示运行状态
  const isRunning = processManager.isAlive(name);
  console.log(`\n🏥 Health Check: ${name}`);
  console.log('─'.repeat(40));
  console.log(`Status: ${isRunning ? '🟢 running' : '⚪ stopped'}`);

  // 读取 STATUS.md
  try {
    const statusContent = fsNative.readFileSync(statusFile, 'utf-8');
    console.log('\n📄 STATUS.md:');
    console.log(statusContent);
  } catch {
    if (isRunning) {
      console.log('\n⏳ STATUS.md not yet created (daemon may be starting)');
    } else {
      console.log('\n⚠️  STATUS.md not found (claw is not running)');
    }
  }
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
    console.error(`❌ Claw "${name}" does not exist`);
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
      type: 'message',
      from: 'motion',
      to: name,
      content: message,
      priority: options?.priority ?? 'normal',
      timestamp: new Date().toISOString(),
    });

    console.log(`✅ Message sent to "${name}"`);
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
    console.error(`❌ Claw "${name}" does not exist`);
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
