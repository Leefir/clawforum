/**
 * start command - One-shot entry point
 *
 * Initializes workspace and Motion if needed, then opens Motion chat.
 * - First run: creates Onboarding contract for onboarding
 * - Onboarding complete: goes straight to chat
 * - Partial onboarding: resumes with a reminder
 */

import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
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
import { startCommand as watchdogStartCommand, isWatchdogAlive } from './watchdog.js';

export function buildOnboardingSubtasks(language: string): Array<{ id: string; description: string }> {
  let langInstruction: string;
  if (language === 'auto') {
    langInstruction = "Detect the user's preferred language from their first message and respond in it immediately.";
  } else {
    langInstruction = `The user typed "${language}" at the language prompt. Infer the language from this text and respond in that language immediately.`;
  }

  return [
    {
      id: 'language',
      description: `${langInstruction} Write the language preference to USER.md (not inside clawspace/).`,
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
      description: 'Onboarding is complete. Let them know everything is set up and the Claw is working on their first task.',
    },
  ];
}

export async function pickLanguage(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    console.log('\nSelect language / 选择语言:');
    console.log('  1. English');
    console.log('  2. 中文');
    console.log('  or type any word for auto-detect (e.g. hello, 你好)\n');
    rl.question('> ', (answer) => {
      rl.close();
      const t = answer.trim();
      if (t === '1') resolve('English');
      else if (t === '2') resolve('中文');
      else if (t === '') resolve('auto');
      else resolve(t);
    });
  });
}

type OnboardingStatus =
  | { state: 'complete' }
  | { state: 'in_progress'; contractId: string; pending: string[] }
  | { state: 'not_found' };

/**
 * Find the Onboarding contract and determine its completion state.
 */
export function getOnboardingStatus(motionDir: string): OnboardingStatus {
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

      if (title !== 'Onboarding') continue;

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
  // Step 1: workspace init
  const wasFirstRun = !isInitialized();
  if (wasFirstRun) {
    await initCommand(true);
  }
  loadGlobalConfig();

  // Step 2: motion init
  const motionDir = getMotionDir();
  if (!fs.existsSync(path.join(motionDir, 'AGENTS.md'))) {
    await motionInitCommand(true);
  }

  // Step 3: onboarding 状态
  const onboarding = getOnboardingStatus(motionDir);

  // onboarding 已完成 → 直接进 chat
  if (onboarding.state === 'complete') {
    const pm = createMotionPM();
    if (!pm.isAlive('motion')) {
      await pm.spawn('motion', motionDir);
      await new Promise(r => setTimeout(r, PROCESS_SPAWN_CONFIRM_MS));
    }
    if (!isWatchdogAlive()) await watchdogStartCommand();
    await motionChatCommand();
    return;
  }

  const inboxDir = path.join(motionDir, 'inbox', 'pending');

  if (wasFirstRun && onboarding.state === 'not_found') {
    // ★ 首次运行：后台启动 daemon，前台展示语言选择（并行）
    const pm = createMotionPM();
    const daemonReady = (async () => {
      if (!pm.isAlive('motion')) {
        await pm.spawn('motion', motionDir);
        await new Promise(r => setTimeout(r, PROCESS_SPAWN_CONFIRM_MS));
      }
    })();
    daemonReady.catch(() => {}); // 防止并行期间 UnhandledPromiseRejection；await 时仍正确 rethrow

    const language = await pickLanguage();
    await daemonReady;
    if (!isWatchdogAlive()) await watchdogStartCommand();

    const motionFs = new NodeFileSystem({ baseDir: motionDir, enforcePermissions: false });
    const manager = new ContractManager(motionDir, motionFs);
    const contractId = await manager.create({
      title: 'Onboarding',
      goal: 'Get to know the user and establish your identity before anything else. No interrogation — just talk.',
      subtasks: buildOnboardingSubtasks(language),
      acceptance: [],
    });

    writeInboxMessage({
      inboxDir,
      type: 'message',
      source: 'system',
      priority: 'high',
      body: `New contract created (${contractId}): Onboarding. Please begin execution.`,
      idPrefix: 'start',
      filenameTag: 'start',
    });

  } else {
    // 非首次但 not_found（极少），或 in_progress
    const pm = createMotionPM();
    if (!pm.isAlive('motion')) {
      await pm.spawn('motion', motionDir);
      await new Promise(r => setTimeout(r, PROCESS_SPAWN_CONFIRM_MS));
    }
    if (!isWatchdogAlive()) await watchdogStartCommand();

    if (onboarding.state === 'not_found') {
      const motionFs = new NodeFileSystem({ baseDir: motionDir, enforcePermissions: false });
      const manager = new ContractManager(motionDir, motionFs);
      const contractId = await manager.create({
        title: 'Onboarding',
        goal: 'Get to know the user and establish your identity before anything else.',
        subtasks: buildOnboardingSubtasks('auto'),
        acceptance: [],
      });
      writeInboxMessage({
        inboxDir,
        type: 'message', source: 'system', priority: 'high',
        body: `New contract created (${contractId}): Onboarding. Please begin execution.`,
        idPrefix: 'start', filenameTag: 'start',
      });
    } else {
      const pendingList = onboarding.pending.join(', ');
      writeInboxMessage({
        inboxDir,
        type: 'message', source: 'system', priority: 'high',
        body: `Resuming Onboarding contract (${onboarding.contractId}). Pending subtasks: ${pendingList}. Please continue.`,
        idPrefix: 'start', filenameTag: 'start',
      });
    }
  }

  // Step 5: 打开 chat
  await motionChatCommand();
}
