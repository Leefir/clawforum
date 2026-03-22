/**
 * start command - One-shot entry point
 *
 * Initializes workspace and Motion if needed, then opens Motion chat.
 * On first run, creates a Bootstrap contract so Motion greets the user
 * and establishes identity before anything else.
 */

import * as path from 'path';
import * as fs from 'fs';
import { isInitialized, loadGlobalConfig, getMotionDir } from '../config.js';
import { initCommand } from './init.js';
import {
  initCommand as motionInitCommand,
  chatCommand as motionChatCommand,
  createMotionPM,
} from './motion.js';
import { ContractManager } from '../../core/contract/manager.js';
import { NodeFileSystem } from '../../foundation/fs/node-fs.js';
import { writeInboxMessage } from '../../utils/inbox-writer.js';
import { PROCESS_SPAWN_CONFIRM_MS } from '../../constants.js';

export async function startCommand(): Promise<void> {
  try {
    await _start();
  } catch (error) {
    console.error('clawforum start failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function _start(): Promise<void> {
  // Step 1: workspace not initialized → run interactive init (prompts for LLM config)
  if (!isInitialized()) {
    await initCommand();
  }
  loadGlobalConfig();

  // Step 2: motion not initialized → write template files
  const motionDir = getMotionDir();
  const isFirstRun = !fs.existsSync(path.join(motionDir, 'AGENTS.md'));
  if (isFirstRun) {
    await motionInitCommand();
  }

  // Step 3: motion daemon not running → start it
  const pm = createMotionPM();
  if (!pm.isAlive('motion')) {
    await pm.spawn('motion', motionDir);
    await new Promise(r => setTimeout(r, PROCESS_SPAWN_CONFIRM_MS));
  }

  // Step 4: first run → system creates Bootstrap contract and notifies Motion
  if (isFirstRun) {
    const motionFs = new NodeFileSystem({ baseDir: motionDir, enforcePermissions: false });
    const manager = new ContractManager(motionDir, motionFs);
    const contractId = await manager.create({
      title: 'Bootstrap',
      goal: 'Get to know the user and establish your identity before anything else. No interrogation — just talk.',
      subtasks: [
        {
          id: 'language',
          description: 'Ask the user which language they prefer to communicate in. Remember this and use it for all future conversations. Write the preference to memory/USER.md.',
        },
        {
          id: 'identity',
          description: 'Figure out who you are: name, vibe, emoji. Talk it through with the user naturally. Write the result to memory/IDENTITY.md.',
        },
        {
          id: 'user',
          description: 'Learn who they are: name, how to address them, any relevant context. Write to memory/USER.md.',
        },
        {
          id: 'soul',
          description: 'Open SOUL.md together. Talk about what matters to them and how they want you to behave. Update SOUL.md with what you learn.',
        },
        {
          id: 'first-claw',
          description: 'Help the user create their first Claw. Ask what they want to name it and what kind of work it will do. Run: exec: clawforum claw create <name>',
        },
        {
          id: 'first-contract',
          description: 'Help the user assign the first contract to their new Claw. Ask what they want to get done, then create a contract for it.',
        },
        {
          id: 'ready',
          description: 'Bootstrap is complete. Let them know everything is set up and the Claw is working on their first task.',
        },
      ],
      acceptance: [],
    });

    writeInboxMessage({
      inboxDir: path.join(motionDir, 'inbox', 'pending'),
      type: 'message',
      source: 'system',
      priority: 'high',
      body: `New contract created (${contractId}): Bootstrap. Please begin execution.`,
      idPrefix: 'start',
      filenameTag: 'start',
    });
  }

  // Step 5: open Motion chat
  await motionChatCommand();
}

