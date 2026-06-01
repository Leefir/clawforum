/**
 * Configuration barrel re-export / phase 500 A.3 functional split
 *
 * 3 sub-file:
 * - schemas.ts (zod schemas + types)
 * - crud.ts (load/save/exists)
 * - adapters.ts (toProviderConfig + buildLLMConfig)
 *
 * Path getters (getWorkspaceRoot, getClawDir, ...) now live in foundation/paths.ts.
 */

// Types (schemas.ts deleted in phase 10 Step D)
export type {
  ClawGlobalConfig,
  ClawConfig,
} from '../../assembly/compose-config.js';
// Note: LLMProviderConfig moved to llm-orchestrator/llm-provider-config-schema.ts (phase 10)
// Note: FORMAT_MAP moved to llm-orchestrator/llm-provider-config-schema.ts (phase 10)

// Path getters + shared constants (canonical owner: foundation/paths.ts)
export { CLAW_SUBDIRS } from '../paths.js';
export {
  getWorkspaceRoot,
  getGlobalConfigPath,
  getClawDir,
  getChestnutRoot,
  getNamedSubrootDir,
  getClawConfigPath,
} from '../paths.js';

// CRUD
export {
  loadGlobalConfig,
  isInitialized,
  saveGlobalConfig,
  loadClawConfig,
  patchGlobalConfigPrimary,
  saveClawConfig,
  clawExists,
} from './crud.js';

// Phase 10 Step B: new thin loader
export {
  loadYamlConfig,
  writeYamlConfig,
  patchYamlConfig,
  configExists,
} from './loader.js';
export type { LoaderDeps } from './loader.js';

// LLM Provider presets (re-export to avoid CLI bypassing L2 config, phase1101)
export { PRESETS } from '../llm-provider/presets.js';
