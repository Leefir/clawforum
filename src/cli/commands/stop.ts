/**
 * stop command - Stop all clawforum processes
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadGlobalConfig, getGlobalConfigPath } from '../config.js';
import { stopCommand as watchdogStop } from './watchdog.js';
import { stopCommand as motionStop } from './motion.js';
import { NodeFileSystem } from '../../foundation/fs/node-fs.js';
import { ProcessManager } from '../../foundation/process/manager.js';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

export async function stopAllCommand(): Promise<void> {
  loadGlobalConfig();

  // 1. Stop watchdog first (prevents it from restarting motion)
  await watchdogStop();

  // 2. Stop motion
  await motionStop();

  // 3. Stop all running claws
  const baseDir = path.dirname(getGlobalConfigPath());
  const clawsDir = path.join(baseDir, 'claws');
  const nodeFs = new NodeFileSystem({ baseDir, enforcePermissions: false });
  const pm = new ProcessManager(nodeFs, baseDir);

  let clawNames: string[] = [];
  try {
    clawNames = fs.readdirSync(clawsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch { /* no claws dir */ }

  const running = clawNames.filter(name => pm.isAlive(name));
  if (running.length > 0) {
    console.log(`Stopping ${running.length} claw(s): ${running.join(', ')}...`);
    await Promise.all(running.map(name => pm.stop(name)));
    console.log('All claws stopped');
  }

  console.log('Done.');

  // Cleanup: pgrep兜底，清理残留的daemon-entry.js孤儿进程
  // Use full path as pattern to only match current installation
  try {
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    // dist/cli/commands/ → up 2 levels → dist/
    const daemonEntryPath = path.resolve(thisDir, '..', '..', 'daemon-entry.js');
    const result = spawnSync('pgrep', ['-f', daemonEntryPath], { encoding: 'utf-8' });
    const output = (result.status === 0 || result.status === 1) ? (result.stdout ?? '') : '';
    const pids = output.trim().split('\n')
      .map(s => parseInt(s, 10))
      .filter(p => !isNaN(p) && p !== process.pid);
    if (pids.length > 0) {
      console.log(`Cleaning up ${pids.length} orphan daemon process(es)...`);
      for (const p of pids) {
        try { process.kill(p, 'SIGTERM'); } catch {}
      }
    }
  } catch {}
}
