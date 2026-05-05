/**
 * @module L6.CLI.Claw.Stop
 * Stop the Claw daemon process
 */

import * as path from 'path';
import {
  loadGlobalConfig, clawExists, getClawDir, getGlobalConfigPath,
} from '../../foundation/config/index.js';
import { CliError } from '../errors.js';
import { createDirContext, createProcessManagerForCLI } from '../../foundation/config/factories.js';

export async function stopCommand(name: string): Promise<void> {
  loadGlobalConfig();
  
  if (!clawExists(name)) {
    throw new CliError(`Claw "${name}" does not exist`);
  }

  const globalConfigPath = getGlobalConfigPath();
  const baseDir = path.dirname(globalConfigPath);
  
  const processManager = createProcessManagerForCLI();
  const { audit: systemAudit } = createDirContext(baseDir);

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
    throw new CliError(`Failed to stop Claw "${name}"`);
  }
}
