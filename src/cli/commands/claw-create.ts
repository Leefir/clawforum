/**
 * @module L6.CLI.Claw.Create
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  loadGlobalConfig, saveClawConfig, clawExists, getClawDir, CLAW_SUBDIRS,
} from '../../foundation/config/index.js';
import { CliError } from '../errors.js';
import { buildAgentsMdTemplate } from '../../prompts/index.js';

export async function createCommand(name: string): Promise<void> {
  // Load global config (ensures initialized)
  loadGlobalConfig();
  
  // Check if claw already exists
  if (clawExists(name)) {
    throw new CliError(`Claw "${name}" already exists`);
  }
  
  const clawDir = getClawDir(name);
  
  // Create directory structure (using shared constants)
  for (const dir of CLAW_SUBDIRS) {
    fs.mkdirSync(path.join(clawDir, dir), { recursive: true });
  }
  
  // Create claw config (inherits from global)
  const config = {
    name,
    tool_profile: 'full' as const,
    max_concurrent_tasks: 3,
  };
  
  saveClawConfig(name, config);
  
  // Create AGENTS.md template
  const agentsMdPath = path.join(clawDir, 'AGENTS.md');
  const agentsTemplate = buildAgentsMdTemplate(name);
  fs.writeFileSync(agentsMdPath, agentsTemplate);
  
  console.log(`Created Claw "${name}"`);
  console.log(`  Location: ${clawDir}`);
  console.log(`\nNext step: clawforum claw chat ${name}`);
}
