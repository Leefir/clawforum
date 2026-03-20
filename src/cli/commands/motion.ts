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
import { fileURLToPath } from 'url';
import { loadGlobalConfig, getMotionDir, getGlobalConfigPath } from '../config.js';
import { NodeFileSystem } from '../../foundation/fs/node-fs.js';
import { ProcessManager } from '../../foundation/process/manager.js';
import { PROCESS_SPAWN_CONFIRM_MS } from '../../constants.js';

import { runChatViewport } from './chat-viewport.js';

/**
 * 创建 Motion 专用的 ProcessManager
 */
export function createMotionPM(): ProcessManager {
  const baseDir = path.dirname(getMotionDir()); // .clawforum
  const nodeFs = new NodeFileSystem({ baseDir, enforcePermissions: false });
  return new ProcessManager(nodeFs, baseDir, (id) => {
    if (id === 'motion') return path.join(baseDir, 'motion');
    return path.join(baseDir, 'claws', id);
  });
}

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
      console.error(`无法读取模板 ${name}: ${errorMsg}`);
      failed.push(name);
    }
  }
  
  if (failed.length > 0) {
    console.error(`\nFailed to process templates: ${failed.join(', ')}`);
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
 * motion chat - 启动交互式对话（viewport 模式）
 */
export async function chatCommand(): Promise<void> {
  loadGlobalConfig();
  const motionDir = getMotionDir();

  // 检查 Motion 是否已初始化
  try {
    await fs.access(path.join(motionDir, 'AGENTS.md'));
  } catch {
    console.error('Motion not initialized. Run: clawforum motion init');
    process.exit(1);
  }

  await runChatViewport({
    agentDir: motionDir,
    label: 'motion',
    ensureDaemon: async () => {
      const pm = createMotionPM();
      if (!pm.isAlive('motion')) {
        console.log('Starting Motion daemon...');
        const pid = await pm.spawn('motion', motionDir);
        console.log(`Started (PID: ${pid})`);
        await new Promise(resolve => setTimeout(resolve, PROCESS_SPAWN_CONFIRM_MS));
      }
      // 确保 watchdog 在运行（idempotent）
      const { startCommand: startWatchdog } = await import('./watchdog.js');
      await startWatchdog();
    },
  });
}

/**
 * motion stop - 停止 Motion 守护进程
 */
export async function stopCommand(): Promise<void> {
  loadGlobalConfig();
  const pm = createMotionPM();

  if (!pm.isAlive('motion')) {
    console.log('Motion is not running');
    return;
  }

  console.log('Stopping Motion daemon...');
  const stopped = await pm.stop('motion');
  console.log(stopped ? 'Stopped Motion daemon' : 'Failed to stop Motion');
}
