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
import { fileURLToPath } from 'url';
import { MotionRuntime } from '../../core/motion/runtime.js';
import { loadGlobalConfig, getMotionDir, buildLLMConfig } from '../config.js';

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
  
  for (const name of TEMPLATE_FILES) {
    const content = await readTemplate(name);
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
