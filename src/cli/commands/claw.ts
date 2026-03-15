/**
 * claw command - Create and chat with Claws
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { 
  loadGlobalConfig, 
  loadClawConfig, 
  saveClawConfig, 
  clawExists,
  getClawDir,
  buildLLMConfig,
} from '../config.js';
import { ClawRuntime } from '../../core/runtime.js';
import { LLMRateLimitError, LLMTimeoutError } from '../../types/errors.js';

export async function createCommand(name: string): Promise<void> {
  // Load global config (ensures initialized)
  loadGlobalConfig();
  
  // Check if claw already exists
  if (clawExists(name)) {
    console.error(`❌ Claw "${name}" already exists`);
    process.exit(1);
  }
  
  const clawDir = getClawDir(name);
  
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
    
    try {
      // Note: onToolCall callback not supported in current runtime.chat signature
      // Tool calls will be logged by the runtime internally
      const response = await runtime.chat(trimmed);
      
      console.log('\n' + response + '\n');
    } catch (error) {
      if (error instanceof LLMRateLimitError) {
        console.error('\n❌ Rate limited. Please wait and try again.\n');
      } else if (error instanceof LLMTimeoutError) {
        console.error('\n❌ Request timed out. Please try again.\n');
      } else {
        console.error('\n❌ Error:', error instanceof Error ? error.message : String(error), '\n');
      }
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
