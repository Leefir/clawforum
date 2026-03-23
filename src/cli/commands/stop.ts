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
}
