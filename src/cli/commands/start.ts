/**
 * start command - One-shot entry point
 *
 * Initializes workspace and Motion if needed, then opens Motion chat.
 * - First run: creates Bootstrap contract for onboarding
 * - Onboarding complete: goes straight to chat
 * - Partial onboarding: resumes with a reminder
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

const BOOTSTRAP_SUBTASKS = [
  {
    id: 'language',
    description: 'IMPORTANT: You must write ALL your messages in English until this subtask is marked complete — regardless of what language you normally use. Ask the user which language they prefer. Whatever language the user replies in — or explicitly states — that is their answer. Switch to that language immediately for all future subtasks. Write the preference to USER.md (not inside clawspace/).',
  },
  {
    id: 'identity',
    description: 'You are the coordinator of Claws — "Motion" is your system role, not your name. Ask the user what they want to call you, and what kind of vibe or presence they want from you. Write the result to IDENTITY.md (not inside clawspace/).',
  },
  {
    id: 'user',
    description: 'Learn who they are: name, how to address them, any relevant context. Write to USER.md (not inside clawspace/).',
  },
  {
    id: 'soul',
    description: 'Open SOUL.md together. Talk about what matters to them and how they want you to behave. Update SOUL.md (not inside clawspace/) with what you learn.',
  },
  {
    id: 'first-claw',
    description: 'Help the user create their first Claw. Ask what task or project they want to work on. A Claw is a separate context window for a specific ongoing task — all Claws have identical capabilities, they just handle different work. Run both commands: exec: clawforum claw create <name>, then exec: clawforum claw daemon <name>',
  },
  {
    id: 'first-contract',
    description: 'Help the user assign the first contract to their new Claw. Ask what they want to get done, then create the contract via dispatch: { "task": "为 <claw-name> 创建契约：<task description>" }',
  },
  {
    id: 'ready',
    description: 'Bootstrap is complete. Let them know everything is set up and the Claw is working on their first task.',
  },
];

type BootstrapStatus =
  | { state: 'complete' }
  | { state: 'in_progress'; contractId: string; pending: string[] }
  | { state: 'not_found' };

/**
 * Find the Bootstrap contract and determine its completion state.
 */
function getBootstrapStatus(motionDir: string): BootstrapStatus {
  const dirs = ['contract/active', 'contract/paused', 'contract/archive'];

  for (const dir of dirs) {
    const contractsDir = path.join(motionDir, dir);
    if (!fs.existsSync(contractsDir)) continue;

    let entries: string[];
    try {
      entries = fs.readdirSync(contractsDir);
    } catch {
      continue;
    }

    for (const contractId of entries) {
      const contractYaml = path.join(contractsDir, contractId, 'contract.yaml');
      const progressJson = path.join(contractsDir, contractId, 'progress.json');
      if (!fs.existsSync(contractYaml) || !fs.existsSync(progressJson)) continue;

      let title = '';
      try {
        const yaml = fs.readFileSync(contractYaml, 'utf-8');
        const m = yaml.match(/^title:\s*["']?(.+?)["']?\s*$/m);
        title = m?.[1] ?? '';
      } catch { continue; }

      if (title !== 'Bootstrap') continue;

      let progress: Record<string, unknown>;
      try {
        progress = JSON.parse(fs.readFileSync(progressJson, 'utf-8'));
      } catch { continue; }

      const subtasks = (progress.subtasks ?? {}) as Record<string, { status: string }>;
      const pending = Object.entries(subtasks)
        .filter(([, v]) => v.status !== 'completed')
        .map(([k]) => k);

      if (dir === 'contract/archive' && pending.length === 0) {
        return { state: 'complete' };
      }
      return { state: 'in_progress', contractId, pending };
    }
  }

  return { state: 'not_found' };
}

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
    await initCommand(true);
  }
  loadGlobalConfig();

  // Step 2: motion not initialized → write template files
  const motionDir = getMotionDir();
  if (!fs.existsSync(path.join(motionDir, 'AGENTS.md'))) {
    await motionInitCommand(true);
  }

  // Step 3: check Bootstrap onboarding status
  const bootstrap = getBootstrapStatus(motionDir);

  // Onboarding complete → go straight to chat, no inbox message needed
  if (bootstrap.state === 'complete') {
    const pm = createMotionPM();
    if (!pm.isAlive('motion')) {
      await pm.spawn('motion', motionDir);
      await new Promise(r => setTimeout(r, PROCESS_SPAWN_CONFIRM_MS));
    }
    await motionChatCommand();
    return;
  }

  // Step 4: start daemon if needed
  const pm = createMotionPM();
  if (!pm.isAlive('motion')) {
    await pm.spawn('motion', motionDir);
    await new Promise(r => setTimeout(r, PROCESS_SPAWN_CONFIRM_MS));
  }

  const motionFs = new NodeFileSystem({ baseDir: motionDir, enforcePermissions: false });
  const manager = new ContractManager(motionDir, motionFs);
  const inboxDir = path.join(motionDir, 'inbox', 'pending');

  if (bootstrap.state === 'not_found') {
    // Create Bootstrap contract from scratch
    const contractId = await manager.create({
      title: 'Bootstrap',
      goal: 'Get to know the user and establish your identity before anything else. No interrogation — just talk. Start all messages in English until the language subtask is complete.',
      subtasks: BOOTSTRAP_SUBTASKS,
      acceptance: [],
    });

    writeInboxMessage({
      inboxDir,
      type: 'message',
      source: 'system',
      priority: 'high',
      body: `New contract created (${contractId}): Bootstrap. Please begin execution.`,
      idPrefix: 'start',
      filenameTag: 'start',
    });
  } else {
    // Bootstrap in progress — remind Motion of the pending subtasks
    const pendingList = bootstrap.pending.join(', ');
    writeInboxMessage({
      inboxDir,
      type: 'message',
      source: 'system',
      priority: 'high',
      body: `Resuming Bootstrap contract (${bootstrap.contractId}). Pending subtasks: ${pendingList}. Please continue.`,
      idPrefix: 'start',
      filenameTag: 'start',
    });
  }

  // Step 5: open Motion chat
  await motionChatCommand();
}
