/**
 * Status command - Show status of all clawforum processes
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadGlobalConfig, getMotionDir, getGlobalConfigPath } from '../config.js';
import { ProcessManager } from '../../foundation/process/manager.js';
import { NodeFileSystem } from '../../foundation/fs/node-fs.js';
import { getWatchdogPid, isWatchdogAlive } from './watchdog.js';

export async function statusCommand(): Promise<void> {
  loadGlobalConfig();

  // 1. Watchdog
  const watchdogPid = getWatchdogPid();
  const watchdogAlive = isWatchdogAlive();
  console.log(`watchdog: ${watchdogAlive ? `running (PID=${watchdogPid})` : 'stopped'}`);

  // 2. Motion
  const baseDir = path.dirname(getMotionDir());
  const nodeFs = new NodeFileSystem({ baseDir, enforcePermissions: false });
  const pm = new ProcessManager(nodeFs, baseDir, (id) => {
    if (id === 'motion') return path.join(baseDir, 'motion');
    return path.join(baseDir, 'claws', id);
  });
  const motionStatus = pm.getAliveStatus('motion');
  console.log(`motion:   ${motionStatus.alive ? `running (${motionStatus.reason})` : `stopped (${motionStatus.reason})`}`);

  // 3. Claws
  const clawsDir = path.join(baseDir, 'claws');
  if (fs.existsSync(clawsDir)) {
    const clawEntries = fs.readdirSync(clawsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);

    for (const name of clawEntries) {
      const s = pm.getAliveStatus(name);
      console.log(`  ${name}: ${s.alive ? `running (${s.reason})` : `stopped (${s.reason})`}`);
    }
  }
}
