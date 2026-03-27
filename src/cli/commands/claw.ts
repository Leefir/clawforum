/**
 * claw command - Create and chat with Claws
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

import { 
  loadGlobalConfig, 
  loadClawConfig, 
  saveClawConfig, 
  clawExists,
  getClawDir,
  buildLLMConfig,
  getGlobalConfigPath,
  CLAW_SUBDIRS,
} from '../config.js';

import { runChatViewport } from './chat-viewport.js';
import { buildAgentsMdTemplate } from '../../prompts/index.js';

/**
 * Format relative time (milliseconds to a human-readable string)
 */
function formatRelativeTime(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h`;
}

// LLM 输出事件类型（与 watchdog 一致）
const LLM_OUTPUT_EVENTS = new Set(['thinking_delta', 'text_delta', 'tool_call']);

/**
 * 从 stream.jsonl 读取最后活跃时间（统一与 watchdog 指标）
 */
function getLastActiveMs(clawDir: string): number | undefined {
  const streamFile = path.join(clawDir, 'dialog', 'stream.jsonl');
  try {
    const lines = fs.readFileSync(streamFile, 'utf-8').trim().split('\n').filter(Boolean);
    let last: number | undefined;
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        if (LLM_OUTPUT_EVENTS.has(ev.type) && typeof ev.ts === 'number') {
          last = ev.ts;
        }
      } catch { /* skip */ }
    }
    return last;
  } catch { return undefined; }
}

import { ProcessManager } from '../../foundation/process/manager.js';
import { NodeFileSystem } from '../../foundation/fs/node-fs.js';
import { LocalTransport } from '../../foundation/transport/local.js';
import { randomUUID } from 'crypto';
import { PROCESS_SPAWN_CONFIRM_MS, DEFAULT_MAX_STEPS } from '../../constants.js';

export async function createCommand(name: string): Promise<void> {
  // Load global config (ensures initialized)
  loadGlobalConfig();
  
  // Check if claw already exists
  if (clawExists(name)) {
    console.error(`Error: Claw "${name}" already exists`);
    process.exit(1);
  }
  
  const clawDir = getClawDir(name);
  
  // Create directory structure (using shared constants)
  for (const dir of CLAW_SUBDIRS) {
    fs.mkdirSync(path.join(clawDir, dir), { recursive: true });
  }
  
  // Create claw config (inherits from global)
  const config = {
    name,
    max_steps: DEFAULT_MAX_STEPS,
    tool_profile: 'full' as const,
    max_concurrent_tasks: 3,
  };
  
  saveClawConfig(name, config);
  
  // Create AGENTS.md template
  const agentsMdPath = path.join(clawDir, 'AGENTS.md');
  const agentsTemplate = buildAgentsMdTemplate(name);
  fs.writeFileSync(agentsMdPath, agentsTemplate);
  
  console.log(`✓ Created Claw "${name}"`);
  console.log(`  Location: ${clawDir}`);
  console.log(`\nNext step: clawforum claw chat ${name}`);
}

export async function chatCommand(name: string): Promise<void> {
  loadGlobalConfig();

  if (!clawExists(name)) {
    console.error(`Error: Claw "${name}" does not exist`);
    process.exit(1);
  }

  const clawDir = getClawDir(name);
  const globalConfigPath = getGlobalConfigPath();
  const baseDir = path.dirname(globalConfigPath);

  await runChatViewport({
    agentDir: clawDir,
    label: name,
    ensureDaemon: async () => {
      const nodeFs = new NodeFileSystem({ baseDir, enforcePermissions: false });
      const pm = new ProcessManager(nodeFs, baseDir);
      if (!pm.isAlive(name)) {
        console.log(`Starting Claw "${name}" daemon...`);
        const pid = await pm.spawn(name, clawDir);
        console.log(`Started (PID: ${pid})`);
        // Wait for daemon to initialize
        await new Promise(resolve => setTimeout(resolve, PROCESS_SPAWN_CONFIRM_MS));
      }
    },
  });
}

// ============================================================================
// Daemon Management Commands
// ============================================================================

/**
 * Stop the Claw daemon process
 */
export async function stopCommand(name: string): Promise<void> {
  loadGlobalConfig();
  
  if (!clawExists(name)) {
    console.error(`Error: Claw "${name}" does not exist`);
    process.exit(1);
  }

  const globalConfigPath = getGlobalConfigPath();
  const baseDir = path.dirname(globalConfigPath);
  
  const nodeFs = new NodeFileSystem({ baseDir, enforcePermissions: false });
  const processManager = new ProcessManager(nodeFs, baseDir);

  // Check if running
  if (!processManager.isAlive(name)) {
    console.log(`Claw "${name}" is not running`);
    return;
  }

  console.log(`Stopping Claw "${name}"...`);
  
  const success = await processManager.stop(name);
  if (success) {
    console.log(`Stopped Claw "${name}"`);
  } else {
    console.error(`Failed to stop Claw "${name}"`);
    process.exit(1);
  }
}

/**
 * List all Claws and their status
 */
export async function listCommand(): Promise<void> {
  loadGlobalConfig();

  const globalConfigPath = getGlobalConfigPath();
  const baseDir = path.dirname(globalConfigPath);
  const clawsDir = path.join(baseDir, 'claws');

  const nodeFs = new NodeFileSystem({ baseDir, enforcePermissions: false });
  const processManager = new ProcessManager(nodeFs, baseDir);

  // Helper: check contract status
  function getContractStatus(clawPath: string): string {
    for (const sub of ['active', 'paused']) {
      try {
        const entries = fs.readdirSync(path.join(clawPath, 'contract', sub), { withFileTypes: true });
        if (entries.some(e => e.isDirectory())) return sub;
      } catch { /* skip */ }
    }
    return '-';
  }

  // Helper: count unread outbox messages
  function getOutboxCount(clawPath: string): number {
    try {
      return fs.readdirSync(path.join(clawPath, 'outbox', 'pending')).length;
    } catch { return 0; }
  }

  // Helper: format relative last-active time
  function formatLastActive(clawPath: string): string {
    const ms = getLastActiveMs(clawPath);
    if (ms === undefined) return '-';
    const age = Date.now() - ms;
    const mins = Math.floor(age / 60000);
    if (mins < 1) return '<1m';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    return `${hours}h`;
  }

  try {
    // Ensure claws directory exists
    if (!fs.existsSync(clawsDir)) {
      fs.mkdirSync(clawsDir, { recursive: true });
    }
    const entries = fs.readdirSync(clawsDir);
    const claws: Array<{
      name: string;
      status: string;
      pid?: string;
      contract: string;
      outbox: number;
      lastActive: string;
    }> = [];

    for (const entry of entries) {
      const clawPath = path.join(clawsDir, entry);
      const configPath = path.join(clawPath, 'config.yaml');
      if (fs.existsSync(configPath)) {
        const isRunning = processManager.isAlive(entry);
        let pid: string | undefined;

        if (isRunning) {
          try {
            const pidFile = path.join(clawPath, 'status', 'pid');
            pid = fs.readFileSync(pidFile, 'utf-8').trim();
          } catch { /* ignore read errors */ }
        }

        claws.push({
          name: entry,
          status: isRunning ? 'running' : 'stopped',
          pid,
          contract: getContractStatus(clawPath),
          outbox: getOutboxCount(clawPath),
          lastActive: formatLastActive(clawPath),
        });
      }
    }

    if (claws.length === 0) {
      console.log('No claws found. Create one with: clawforum claw create <name>');
      return;
    }

    // Print table
    console.log('\nClaw List:');
    console.log('─'.repeat(80));
    console.log(`${'Name'.padEnd(20)} ${'Status'.padEnd(12)} ${'PID'.padEnd(10)} ${'Contract'.padEnd(10)} ${'Outbox'.padEnd(8)} ${'LastActive'.padEnd(10)}`);
    console.log('─'.repeat(80));

    for (const claw of claws) {
      const statusIcon = claw.status === 'running' ? '[running]' : '[stopped]';
      const pidStr = claw.pid || '-';
      console.log(`${claw.name.padEnd(20)} ${statusIcon.padEnd(12)} ${pidStr.padEnd(10)} ${claw.contract.padEnd(10)} ${String(claw.outbox).padEnd(8)} ${claw.lastActive.padEnd(10)}`);
    }

    console.log('─'.repeat(80));
    console.log(`\nTotal: ${claws.length} claws (${claws.filter(c => c.status === 'running').length} running)\n`);
  } catch (error) {
    console.error('Failed to list claws:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Display Claw health status (reads directory in real time)
 */
export async function healthCommand(name: string): Promise<void> {
  loadGlobalConfig();

  if (!clawExists(name)) {
    console.error(`Error: Claw "${name}" does not exist`);
    process.exit(1);
  }

  const clawDir = getClawDir(name);
  const globalConfigPath = getGlobalConfigPath();
  const baseDir = path.dirname(globalConfigPath);

  const nodeFs = new NodeFileSystem({ baseDir, enforcePermissions: false });
  const processManager = new ProcessManager(nodeFs, baseDir);

  const isRunning = processManager.isAlive(name);

  // Read inbox/outbox pending counts in real time
  let inboxPending = 0;
  let outboxPending = 0;
  try {
    const entries = fs.readdirSync(path.join(clawDir, 'inbox', 'pending'));
    inboxPending = entries.length;
  } catch { /* directory does not exist */ }
  try {
    const entries = fs.readdirSync(path.join(clawDir, 'outbox', 'pending'));
    outboxPending = entries.length;
  } catch { /* directory does not exist */ }

  // Check contract status
  let contractStatus = 'none';
  for (const sub of ['active', 'paused']) {
    try {
      const entries = fs.readdirSync(
        path.join(clawDir, 'contract', sub), { withFileTypes: true }
      );
      if (entries.some(e => e.isDirectory())) {
        contractStatus = sub;
        break;
      }
    } catch { /* skip */ }
  }

  // Last active time（统一使用 stream.jsonl 指标）
  let lastActive = '-';
  const lastMs = getLastActiveMs(clawDir);
  if (lastMs !== undefined) {
    lastActive = formatRelativeTime(Date.now() - lastMs);
  }

  console.log(`\nHealth Check: ${name}`);
  console.log('─'.repeat(40));
  console.log(`status: ${isRunning ? 'running' : 'stopped'}`);
  console.log(`inbox_pending: ${inboxPending}`);
  console.log(`outbox_pending: ${outboxPending}`);
  console.log(`contract: ${contractStatus}`);
  console.log(`last_active: ${lastActive}`);
  console.log(`as_of: ${new Date().toISOString()}`);
}

// ============================================================================
// Send Message Command
// ============================================================================

/**
 * Send an inbox message to a Claw
 */
export async function sendCommand(
  name: string, 
  message: string, 
  options?: { priority?: 'critical' | 'high' | 'normal' | 'low' }
): Promise<void> {
  loadGlobalConfig();
  
  if (!clawExists(name)) {
    console.error(`Error: Claw "${name}" does not exist`);
    process.exit(1);
  }

  const globalConfigPath = getGlobalConfigPath();
  const baseDir = path.dirname(globalConfigPath);
  
  // Create transport (workspaceDir = baseDir, i.e. ~/.clawforum)
  const transport = new LocalTransport({ workspaceDir: baseDir });
  await transport.initialize();

  try {
    await transport.sendInboxMessage(name, {
      id: randomUUID(),
      type: 'user_inbox_message',
      from: 'user',
      to: name,
      content: message,
      priority: options?.priority ?? 'normal',
      timestamp: new Date().toISOString(),
    });

    console.log(`Message sent to "${name}"`);
  } finally {
    await transport.close();
  }
}

// ============================================================================
// Outbox Command
// ============================================================================

/**
 * Read and consume Claw outbox messages
 */
export async function outboxCommand(
  name: string,
  options?: { limit?: number }
): Promise<void> {
  loadGlobalConfig();

  if (!clawExists(name)) {
    console.error(`Error: Claw "${name}" does not exist`);
    process.exit(1);
  }

  const clawDir = getClawDir(name);
  const pendingDir = path.join(clawDir, 'outbox', 'pending');
  const doneDir = path.join(clawDir, 'outbox', 'done');

  // Read pending files
  let files: string[] = [];
  try {
    const allFiles = await fs.promises.readdir(pendingDir);
    files = allFiles.filter(f => f.endsWith('.md')).sort();
  } catch {
    console.log('outbox is empty');
    return;
  }

  if (files.length === 0) {
    console.log('outbox is empty');
    return;
  }

  // Limit number of messages read (default 1)
  const limit = options?.limit ?? 1;
  const toRead = files.slice(0, limit);
  const remaining = files.length - toRead.length;

  // Read and output
  const results: string[] = [];
  for (const fileName of toRead) {
    const filePath = path.join(pendingDir, fileName);
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      results.push(content);

      // Move to done/
      try {
        await fs.promises.mkdir(doneDir, { recursive: true });
        await fs.promises.rename(filePath, path.join(doneDir, `${Date.now()}_${fileName}`));
      } catch (err) {
        console.warn(`[outbox] Failed to move ${fileName} to done: ${err instanceof Error ? err.message : String(err)}`);
      }
    } catch {
      // skip on read failure
    }
  }

  // Output
  for (const content of results) {
    console.log(content);
    console.log('---');
  }

  if (remaining > 0) {
    console.log(`(${remaining} more unread message(s))`);
  }
}
