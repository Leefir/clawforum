/**
 * Clawforum CLI - Command line interface
 */

// 设置工作区根路径，供 exec 子进程继承（子进程 CWD 是 clawspace/，无法直接找到 .clawforum）
if (!process.env.CLAWFORUM_ROOT) {
  process.env.CLAWFORUM_ROOT = process.cwd();
}

import { program } from 'commander';
import { initCommand } from './commands/init.js';
import { 
  createCommand, 
  chatCommand, 
  startCommand, 
  stopCommand, 
  listCommand, 
  healthCommand,
} from './commands/claw.js';
import { daemonCommand } from './commands/daemon.js';
import { 
  initCommand as motionInitCommand,
  chatCommand as motionChatCommand,
} from './commands/motion.js';

program
  .name('clawforum')
  .description('AI Agent Orchestration System')
  .version('0.1.0');

// init command
program
  .command('init')
  .description('Initialize clawforum workspace')
  .action(async () => {
    try {
      await initCommand();
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// claw command group
const clawCmd = program
  .command('claw')
  .description('Manage Claws');

// claw create
clawCmd
  .command('create <name>')
  .description('Create a new Claw')
  .action(async (name: string) => {
    try {
      await createCommand(name);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// claw chat
clawCmd
  .command('chat <name>')
  .description('Chat with a Claw')
  .action(async (name: string) => {
    try {
      await chatCommand(name);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// claw start
clawCmd
  .command('start <name>')
  .description('Start Claw daemon')
  .action(async (name: string) => {
    try {
      await startCommand(name);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// claw stop
clawCmd
  .command('stop <name>')
  .description('Stop Claw daemon')
  .action(async (name: string) => {
    try {
      await stopCommand(name);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// claw list
clawCmd
  .command('list')
  .description('List all Claws and their status')
  .action(async () => {
    try {
      await listCommand();
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// claw health
clawCmd
  .command('health <name>')
  .description('Show Claw health status')
  .action(async (name: string) => {
    try {
      await healthCommand(name);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// claw daemon (internal command, spawned by ProcessManager)
clawCmd
  .command('daemon <name>')
  .description('Run Claw as daemon (internal)')
  .action(async (name: string) => {
    try {
      await daemonCommand(name);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// motion command group
const motionCmd = program
  .command('motion')
  .description('Manage Motion (system orchestrator)');

// motion init
motionCmd
  .command('init')
  .description('Initialize Motion configuration')
  .action(async () => {
    try {
      await motionInitCommand();
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// motion chat
motionCmd
  .command('chat')
  .description('Chat with Motion')
  .action(async () => {
    try {
      await motionChatCommand();
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.parse();
