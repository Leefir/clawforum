/**
 * Clawforum CLI - Command line interface
 */

import { program } from 'commander';
import { initCommand } from './commands/init.js';
import { createCommand, chatCommand } from './commands/claw.js';

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

program.parse();
