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
import * as fsNative from 'fs';
import { spawn } from 'child_process';
import { startRepl } from '../repl.js';
import { fileURLToPath } from 'url';
import { MotionRuntime } from '../../core/motion/runtime.js';
import { loadGlobalConfig, getMotionDir, buildLLMConfig } from '../config.js';
import { NodeFileSystem } from '../../foundation/fs/node-fs.js';
import { ProcessManager } from '../../foundation/process/manager.js';
import { Heartbeat } from '../../core/heartbeat.js';

// 获取当前文件目录（ESM 兼容）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 模板文件路径（支持构建产物和源码双模式）
const TEMPLATE_FILES = ['AGENTS.md', 'SOUL.md', 'AUTH_POLICY.md', 'HEARTBEAT.md', 'REVIEW.md'];

/**
 * 读取模板文件内容（支持构建产物或源码目录回退）
 */
async function readTemplate(name: string): Promise<string> {
  // 优先尝试 dist 路径
  const distPath = path.join(__dirname, 'templates', 'motion', name);
  try {
    return await fs.readFile(distPath, 'utf-8');
  } catch {
    // 回退到 src 路径（开发时）
    const srcPath = path.join(__dirname, '..', '..', '..', '..', 'src', 'cli', 'commands', 'templates', 'motion', name);
    return await fs.readFile(srcPath, 'utf-8');
  }
}

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
  
  // 读取并写入模板文件
  const created: string[] = [];
  const existed: string[] = [];
  const failed: string[] = [];
  
  for (const name of TEMPLATE_FILES) {
    try {
      const content = await readTemplate(name);
      const filePath = path.join(motionDir, name);
      const isNew = await writeTemplate(filePath, content);
      if (isNew) {
        created.push(name);
      } else {
        existed.push(name);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`❌ 无法读取模板 ${name}: ${errorMsg}`);
      failed.push(name);
    }
  }
  
  if (failed.length > 0) {
    console.error(`\n❌ Failed to process templates: ${failed.join(', ')}`);
    process.exit(1);
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
  const llmConfig = buildLLMConfig(globalConfig);
  
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

  await startRepl({
    prompt: 'motion> ',
    header: '╔══════════════════════════════════════╗\n║   Clawforum Motion (Manager Mode)    ║\n╚══════════════════════════════════════╝',
    onMessage: async (message, callbacks) => {
      try {
        return await runtime.chat(message, callbacks);
      } catch (error) {
        if (error instanceof Error && (error.name === 'AbortError' || error.message === 'Execution aborted')) {
          // 用户主动中断，静默处理
        } else {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error('\x1b[31mError:\x1b[0m', errorMsg);
        }
        return '';
      }
    },
    onClose: () => runtime.stop(),
    onInterrupt: () => runtime.abort(),
  });
}

// ============================================================================
// Motion Daemon Commands
// ============================================================================

/**
 * 获取 Motion PID 文件路径
 */
function getMotionPidFile(): string {
  return path.join(getMotionDir(), 'status', 'pid');
}

/**
 * 检查 Motion 是否正在运行
 */
function isMotionAlive(): boolean {
  try {
    const pidFile = getMotionPidFile();
    if (!fsNative.existsSync(pidFile)) {
      return false;
    }
    const content = fsNative.readFileSync(pidFile, 'utf-8');
    const pid = parseInt(content.trim(), 10);
    if (isNaN(pid)) return false;
    
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * 写入 Motion PID 文件
 */
function writeMotionPid(pid: number): void {
  const pidFile = getMotionPidFile();
  fsNative.mkdirSync(path.dirname(pidFile), { recursive: true });
  fsNative.writeFileSync(pidFile, String(pid));
}

/**
 * 删除 Motion PID 文件
 */
function removeMotionPid(): void {
  try {
    const pidFile = getMotionPidFile();
    fsNative.unlinkSync(pidFile);
  } catch {
    // 忽略删除失败
  }
}

/**
 * motion start - 启动 Motion 守护进程
 */
export async function startCommand(): Promise<void> {
  loadGlobalConfig();
  
  // 检查是否已运行
  if (isMotionAlive()) {
    console.log('ℹ️  Motion is already running');
    return;
  }
  
  // 检查 Motion 是否已初始化
  const motionDir = getMotionDir();
  try {
    await fs.access(path.join(motionDir, 'AGENTS.md'));
  } catch {
    console.error('❌ Motion not initialized. Run: clawforum motion init');
    process.exit(1);
  }
  
  // 启动守护进程
  const cliPath = path.resolve(process.cwd(), 'dist', 'cli.js');
  
  const proc = spawn('node', [cliPath, 'motion', 'daemon'], {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
  });
  
  const pid = proc.pid;
  if (!pid) {
    console.error('❌ Failed to spawn Motion daemon');
    process.exit(1);
  }
  
  // 写入 PID 文件
  writeMotionPid(pid);
  
  // 等待启动确认
  await new Promise(resolve => setTimeout(resolve, 500));
  
  console.log(`✅ Started Motion daemon (PID: ${pid})`);
}

/**
 * motion stop - 停止 Motion 守护进程
 */
export async function stopCommand(): Promise<void> {
  loadGlobalConfig();
  
  // 检查是否运行
  if (!isMotionAlive()) {
    console.log('ℹ️  Motion is not running');
    return;
  }
  
  // 读取 PID
  const pidFile = getMotionPidFile();
  let pid: number;
  try {
    const content = fsNative.readFileSync(pidFile, 'utf-8');
    pid = parseInt(content.trim(), 10);
    if (isNaN(pid)) {
      throw new Error('Invalid PID');
    }
  } catch {
    console.error('❌ Failed to read Motion PID');
    process.exit(1);
  }
  
  console.log('🛑 Stopping Motion daemon...');
  
  try {
    // 发送 SIGTERM
    process.kill(pid, 'SIGTERM');
    
    // 等待 5 秒
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // 检查是否还在运行
    if (isMotionAlive()) {
      // 强制终止
      process.kill(pid, 'SIGKILL');
    }
    
    // 清理 PID 文件
    removeMotionPid();
    
    console.log('✅ Stopped Motion daemon');
  } catch (err: any) {
    if (err.code === 'ESRCH') {
      // 进程已经不存在
      removeMotionPid();
      console.log('✅ Stopped Motion daemon');
    } else {
      console.error('❌ Failed to stop Motion:', err.message);
      process.exit(1);
    }
  }
}

/**
 * 写入 Motion STATUS.md
 */
async function writeMotionStatus(motionDir: string, state: string): Promise<void> {
  try {
    const statusDir = path.join(motionDir, 'status');
    await fs.mkdir(statusDir, { recursive: true });
    const statusPath = path.join(statusDir, 'STATUS.md');
    
    const now = new Date().toISOString();
    
    // 收集 claws 统计
    const baseDir = path.join(motionDir, '..');
    const clawsDir = path.join(baseDir, 'claws');
    let runningCount = 0;
    let totalCount = 0;
    
    try {
      const fs = new NodeFileSystem({ baseDir: motionDir, enforcePermissions: false });
      const pm = new ProcessManager(fs, baseDir);
      const entries = fsNative.readdirSync(clawsDir);
      for (const entry of entries) {
        if (entry === 'motion') continue;
        const entryPath = path.join(clawsDir, entry);
        const stat = fsNative.statSync(entryPath);
        if (stat.isDirectory()) {
          totalCount++;
          if (pm.isAlive(entry)) {
            runningCount++;
          }
        }
      }
    } catch {
      // 忽略统计错误
    }
    
    const statusContent = `updated_at: ${now}
state: ${state}
claws_total: ${totalCount}
claws_running: ${runningCount}
`;
    await fs.writeFile(statusPath, statusContent);
  } catch (err) {
    console.error('[motion daemon] Failed to write status:', err);
  }
}

/**
 * motion daemon - 内部命令（由 startCommand 调用）
 */
export async function daemonCommand(): Promise<void> {
  const globalConfig = loadGlobalConfig();
  const motionDir = getMotionDir();
  const llmConfig = buildLLMConfig(globalConfig);
  
  // 创建 MotionRuntime
  const runtime = new MotionRuntime({
    clawId: 'motion',
    clawDir: motionDir,
    llmConfig,
    maxSteps: 100,
    toolProfile: 'full',
  });
  
  // MVP 对齐：初始化 + 恢复契约（替代 start() 的 InboxWatcher）
  await runtime.initialize();
  await runtime.resumeContractIfPaused();
  
  // 创建 Heartbeat
  const baseDir = path.join(motionDir, '..');
  const fs = new NodeFileSystem({ baseDir: motionDir, enforcePermissions: false });
  const pm = new ProcessManager(fs, baseDir);
  const heartbeat = new Heartbeat(baseDir, pm, {
    interval: 60,
    stallThreshold: 300,
  });
  
  // 初始状态写入
  await writeMotionStatus(motionDir, 'running');
  
  // 状态更新定时器（每 30s）
  const statusInterval = setInterval(async () => {
    await writeMotionStatus(motionDir, 'running');
  }, 30000);
  
  // 心跳检查定时器（每 5s 检查是否到期）
  const heartbeatInterval = setInterval(() => {
    if (heartbeat.isDue()) {
      const results = heartbeat.checkAll();
      if (results.length > 0) {
        console.log('[heartbeat]', results.join(', '));
      }
    }
  }, 5000);
  
  // MVP 对齐：轮询循环（批处理代替事件驱动）
  let motionStopped = false;
  const POLL_INTERVAL = 2000;
  
  // SIGTERM 处理
  process.on('SIGTERM', async () => {
    console.log('[motion daemon] Received SIGTERM, shutting down...');
    motionStopped = true;
    clearInterval(statusInterval);
    clearInterval(heartbeatInterval);
    await writeMotionStatus(motionDir, 'stopped');
    await runtime.stop();
    process.exit(0);
  });

  // 确保 exit 时清理 intervals
  process.on('exit', () => {
    clearInterval(statusInterval);
    clearInterval(heartbeatInterval);
  });
  
  // 保持进程运行
  console.log('[motion daemon] Started');
  
  // MVP 对齐：批处理轮询循环
  while (!motionStopped) {
    try {
      const injected = await runtime.processBatch();
      if (injected > 0) {
        // 链式反应：处理到无积压为止
        let more = injected;
        while (more > 0 && !motionStopped) {
          more = await runtime.processBatch();
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
      }
    } catch (err) {
      console.error('[motion daemon] processBatch error:', err);
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
  }
}
