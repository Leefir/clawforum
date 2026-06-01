/**
 * Phase 10 Step C: facade re-implemented on loader + composer.
 * Public function signatures preserved (callers unchanged except for removing `defaults` param).
 */
import * as path from 'path';
import {
  createGlobalConfigSchema,
  getClawConfigSchema,
  type ClawGlobalConfig,
  type ClawConfig,
} from '../../assembly/compose-config.js';
import {
  loadYamlConfig,
  writeYamlConfig,
  patchYamlConfig,
  configExists,
} from './loader.js';
import {
  getGlobalConfigPath,
  getClawConfigPath,
} from '../paths.js';
import type { FileSystem } from '../fs/types.js';

export function loadGlobalConfig(deps: { fsFactory: (baseDir: string) => FileSystem }): ClawGlobalConfig {
  const configPath = getGlobalConfigPath();
  const schema = createGlobalConfigSchema();
  try {
    return loadYamlConfig<ClawGlobalConfig>(
      { fsFactory: deps.fsFactory },
      configPath,
      schema,
      { notFoundMessage: 'Global config not found. Run "chestnut init" first.' },
    );
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.startsWith('Failed to read config:')) {
        throw new Error(err.message);
      }
      if (err.message.startsWith('Invalid YAML in config:')) {
        throw new Error(err.message);
      }
      if (err.message.startsWith('Invalid config (env var):')) {
        throw new Error(err.message.replace('Invalid config (env var):', 'Invalid global config (env var):'));
      }
      if (err.message.startsWith('Invalid config:')) {
        throw new Error(err.message.replace('Invalid config:', 'Invalid global config:'));
      }
    }
    throw err;
  }
}

export function isInitialized(deps: { fsFactory: (baseDir: string) => FileSystem }): boolean {
  const configPath = getGlobalConfigPath();
  const dir = path.dirname(configPath);
  const fs = deps.fsFactory(dir);
  return fs.existsSync(path.basename(configPath));
}

export function saveGlobalConfig(deps: { fsFactory: (baseDir: string) => FileSystem }, config: ClawGlobalConfig): void {
  const configPath = getGlobalConfigPath();
  writeYamlConfig(
    { fsFactory: deps.fsFactory },
    configPath,
    config,
  );
}

export function loadClawConfig(deps: { fsFactory: (baseDir: string) => FileSystem }, name: string): ClawConfig | undefined {
  const configPath = getClawConfigPath(name);
  if (!configExists({ fsFactory: deps.fsFactory }, configPath)) {
    return undefined;
  }
  try {
    return loadYamlConfig<ClawConfig>(
      { fsFactory: deps.fsFactory },
      configPath,
      getClawConfigSchema(),
    );
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.startsWith('Failed to read config:')) {
        throw new Error(err.message);
      }
      if (err.message.startsWith('Invalid YAML in config:')) {
        throw new Error(err.message);
      }
      if (err.message.startsWith('Invalid config (env var):')) {
        throw new Error(err.message.replace('Invalid config (env var):', 'Invalid claw config (env var):'));
      }
      if (err.message.startsWith('Invalid config:')) {
        throw new Error(err.message.replace('Invalid config:', 'Invalid claw config:'));
      }
    }
    throw err;
  }
}

export function patchGlobalConfigPrimary(deps: { fsFactory: (baseDir: string) => FileSystem }, patch: Record<string, unknown>): void {
  const configPath = getGlobalConfigPath();
  patchYamlConfig(
    { fsFactory: deps.fsFactory },
    configPath,
    (cfg) => {
      const llm = cfg.llm as Record<string, unknown> | undefined;
      if (!llm || typeof llm !== 'object') {
        throw new Error('Invalid global config: missing llm section');
      }
      const primary = llm.primary as Record<string, unknown> | undefined;
      if (!primary || typeof primary !== 'object') {
        throw new Error('Invalid global config: missing llm.primary section');
      }
      for (const [k, v] of Object.entries(patch)) {
        primary[k] = v;
      }
    },
  );
}

export function saveClawConfig(deps: { fsFactory: (baseDir: string) => FileSystem }, name: string, config: ClawConfig): void {
  const configPath = getClawConfigPath(name);
  writeYamlConfig(
    { fsFactory: deps.fsFactory },
    configPath,
    config,
  );
}

export function clawExists(deps: { fsFactory: (baseDir: string) => FileSystem }, name: string): boolean {
  const configPath = getClawConfigPath(name);
  const dir = path.dirname(configPath);
  const fs = deps.fsFactory(dir);
  return fs.existsSync(path.basename(configPath));
}

// Re-export type for caller convenience
export type { ClawGlobalConfig, ClawConfig };
