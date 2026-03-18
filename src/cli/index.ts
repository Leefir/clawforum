/**
 * Clawforum CLI - Command line interface
 */

// 设置工作区根路径，供 exec 子进程继承（子进程 CWD 是 clawspace/，无法直接找到 .clawforum）
if (!process.env.CLAWFORUM_ROOT) {
  process.env.CLAWFORUM_ROOT = process.cwd();
}

import { program } from 'commander';
import { initCommand } from './commands/init.js';
import * as path from 'path';
import { 
  createCommand, 
  chatCommand, 
  stopCommand, 
  listCommand, 
  healthCommand,
  sendCommand,
  outboxCommand,
} from './commands/claw.js';
import { daemonCommand } from './commands/daemon.js';
import { 
  initCommand as motionInitCommand,
  chatCommand as motionChatCommand,
  stopCommand as motionStopCommand,
} from './commands/motion.js';
import { contractCreateCommand } from './commands/contract.js';
import {
  startCommand as watchdogStartCommand,
  stopCommand as watchdogStopCommand,
  daemonCommand as watchdogDaemonCommand,
} from './commands/watchdog.js';

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

// claw send
clawCmd
  .command('send <name> <message>')
  .description('Send a message to a Claw inbox')
  .option('--priority <level>', 'Message priority (critical/high/normal/low)', 'normal')
  .action(async (name: string, message: string, opts: { priority: string }) => {
    try {
      // 验证 priority 值
      const validPriorities = ['critical', 'high', 'normal', 'low'];
      if (!validPriorities.includes(opts.priority)) {
        console.error(`Invalid priority: ${opts.priority}. Must be one of: ${validPriorities.join(', ')}`);
        process.exit(1);
      }
      await sendCommand(name, message, { priority: opts.priority as any });
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// claw outbox
clawCmd
  .command('outbox <name>')
  .description('Read and consume outbox messages from a Claw')
  .option('--limit <n>', 'Max messages to read (default: 1)', '1')
  .action(async (name: string, opts: { limit: string }) => {
    try {
      await outboxCommand(name, { limit: parseInt(opts.limit, 10) });
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// claw daemon (auto-backgrounds)
clawCmd
  .command('daemon <name>')
  .description('Start Claw daemon (auto-backgrounds)')
  .action(async (name: string) => {
    try {
      if (process.env.CLAWFORUM_DAEMON_MODE) {
        await daemonCommand(name);
        return;
      }
      // 前台入口：后台启动
      const { loadGlobalConfig, clawExists, getClawDir, getGlobalConfigPath } = await import('./config.js');
      const { NodeFileSystem } = await import('../foundation/fs/node-fs.js');
      const { ProcessManager } = await import('../foundation/process/manager.js');
      loadGlobalConfig();
      if (!clawExists(name)) {
        console.error(`Error: Claw "${name}" does not exist`);
        process.exit(1);
      }
      const clawDir = getClawDir(name);
      const baseDir = path.dirname(getGlobalConfigPath());
      const nodeFs = new NodeFileSystem({ baseDir, enforcePermissions: false });
      const pm = new ProcessManager(nodeFs, baseDir);
      if (pm.isAlive(name)) {
        console.log(`Claw "${name}" is already running`);
        return;
      }
      const pid = await pm.spawn(name, clawDir);
      console.log(`Started Claw "${name}" (PID: ${pid})`);
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

// motion stop
motionCmd
  .command('stop')
  .description('Stop Motion daemon')
  .action(async () => {
    try {
      await motionStopCommand();
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// motion daemon (auto-backgrounds)
motionCmd
  .command('daemon')
  .description('Start Motion daemon (auto-backgrounds)')
  .action(async () => {
    try {
      if (process.env.CLAWFORUM_DAEMON_MODE) {
        await daemonCommand('motion');
        return;
      }
      // 前台入口
      const { loadGlobalConfig, getMotionDir } = await import('./config.js');
      const { NodeFileSystem } = await import('../foundation/fs/node-fs.js');
      const { ProcessManager } = await import('../foundation/process/manager.js');
      loadGlobalConfig();
      const motionDir = getMotionDir();
      const baseDir = path.dirname(motionDir);
      const nodeFs = new NodeFileSystem({ baseDir, enforcePermissions: false });
      const pm = new ProcessManager(nodeFs, baseDir, (id) => {
        if (id === 'motion') return path.join(baseDir, 'motion');
        return path.join(baseDir, 'claws', id);
      });
      if (pm.isAlive('motion')) {
        console.log('Motion is already running');
        return;
      }
      const pid = await pm.spawn('motion', motionDir);
      console.log(`Started Motion daemon (PID: ${pid})`);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// contract command group
const contractCmd = program
  .command('contract')
  .description('Manage contracts');

// contract create
contractCmd
  .command('create')
  .description('Create a contract for a claw')
  .requiredOption('--claw <id>', 'Target claw ID')
  .requiredOption('--file <path>', 'Path to contract YAML file')
  .action(async (opts: { claw: string; file: string }) => {
    try {
      await contractCreateCommand(opts.claw, opts.file);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// watchdog command group
const watchdogCmd = program
  .command('watchdog')
  .description('System watchdog for Motion');

// watchdog start
watchdogCmd
  .command('start')
  .description('Start watchdog')
  .action(async () => {
    try {
      await watchdogStartCommand();
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// watchdog stop
watchdogCmd
  .command('stop')
  .description('Stop watchdog')
  .action(async () => {
    try {
      await watchdogStopCommand();
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// watchdog daemon (internal command, spawned by startCommand)
watchdogCmd
  .command('daemon')
  .description('Run watchdog daemon (internal)')
  .action(async () => {
    try {
      await watchdogDaemonCommand();
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.parse();
