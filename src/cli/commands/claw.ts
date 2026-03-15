/**
 * claw command - Create and chat with Claws
 */

import * as fs from 'fs';
import * as fsNative from 'fs';
import * as path from 'path';
import * as readline from 'readline';
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
import { ClawRuntime } from '../../core/runtime.js';
import { LLMRateLimitError, LLMTimeoutError } from '../../types/errors.js';
import { ProcessManager } from '../../foundation/process/manager.js';
import { NodeFileSystem } from '../../foundation/fs/node-fs.js';

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

请高效、准确地完成用户的任务。
`;
  fs.writeFileSync(agentsMdPath, agentsTemplate);
  
  console.log(`✓ Created Claw "${name}"`);
  console.log(`  Location: ${clawDir}`);
  console.log(`\nNext step: clawforum claw chat ${name}`);
}

export async function chatCommand(name: string): Promise<void> {
  // Load configs
  const globalConfig = loadGlobalConfig();
  const clawConfig = loadClawConfig(name);
  
  const clawDir = getClawDir(name);
  const llmConfig = buildLLMConfig(globalConfig, clawConfig);
  
  console.log(`🤖 Starting chat with "${name}"...\n`);
  
  // Create runtime
  const runtime = new ClawRuntime({
    clawId: name,
    clawDir,
    llmConfig,
    maxSteps: clawConfig.max_steps,
    toolProfile: clawConfig.tool_profile,
  });
  
  // Start runtime
  await runtime.start();
  
  // Setup readline REPL
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  });
  
  console.log('Type your message (or "exit" to quit):\n');
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
    
    // 暂停 readline TTY 管理，防止输出被覆盖
    rl.pause();
    
    try {
      const response = await runtime.chat(trimmed, {
        onBeforeLLMCall: () => {
          console.log('\x1b[2mThinking...\x1b[0m');
        },
        onToolCall: (name) => {
          console.log(`\x1b[2m  → 调用工具: ${name}\x1b[0m`);
        },
        onToolResult: (name, result, step, maxSteps) => {
          const summary = result.content.length > 80
            ? result.content.slice(0, 80) + '...'
            : result.content;
          const status = result.success ? '✓' : '✗';
          // step 是 0-indexed，显示时 +1
          console.log(`\x1b[2m    ${status} [${step + 1}/${maxSteps}] ${summary}\x1b[0m`);
        },
      });
      
      console.log('\n' + response + '\n');
    } catch (error) {
      if (error instanceof LLMRateLimitError) {
        console.error('\n❌ Rate limited. Please wait and try again.\n');
      } else if (error instanceof LLMTimeoutError) {
        console.error('\n❌ Request timed out. Please try again.\n');
      } else {
        console.error('\n❌ Error:', error instanceof Error ? error.message : String(error));
        console.log('');
      }
    } finally {
      // 确保 readline 总是被恢复，即使发生异常
      rl.resume();
    }
    
    rl.prompt();
  });
  
  rl.on('close', async () => {
    console.log('\n👋 Goodbye!');
    await runtime.stop();
    process.exit(0);
  });
  
  // Handle Ctrl+C
  process.on('SIGINT', async () => {
    console.log('\n👋 Goodbye!');
    await runtime.stop();
    process.exit(0);
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
