/**
 * @module L1.Config
 *
 * CRUD operations for global + claw configs / phase 500 sub-file extraction
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  ClawGlobalConfigSchema,
  ClawConfigSchema,
  type ClawGlobalConfig,
  type ClawConfig,
} from './schemas.js';
import {
  getGlobalConfigPath,
  getClawConfigPath,
  getClawDir,
} from './paths.js';

// Expand ${ENV_VAR} syntax in config values
function expandEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{([^}]+)\}/g, (_, varName) => {
      const val = process.env[varName];
      if (val === undefined) {
        throw new Error(`Environment variable "${varName}" is not set`);
      }
      return val;
    });
  }
  if (Array.isArray(obj)) {
    return obj.map(expandEnvVars);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvVars(value);
    }
    return result;
  }
  return obj;
}

// Load global config
export function loadGlobalConfig(): ClawGlobalConfig {
  const configPath = getGlobalConfigPath();

  if (!fs.existsSync(configPath)) {
    throw new Error(
      'Global config not found. Run "clawforum init" first.'
    );
  }

  const content = fs.readFileSync(configPath, 'utf-8');
  const parsed = yaml.load(content);

  // Expand environment variables before validation
  const expanded = expandEnvVars(parsed);

  try {
    return ClawGlobalConfigSchema.parse(expanded);
  } catch (error) {
    throw new Error(
      `Invalid global config: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// Check if initialized
export function isInitialized(): boolean {
  return fs.existsSync(getGlobalConfigPath());
}

// Save global config
export function saveGlobalConfig(config: ClawGlobalConfig): void {
  const configPath = getGlobalConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, yaml.dump(config));
}

// Load claw config
export function loadClawConfig(name: string): ClawConfig {
  const configPath = getClawConfigPath(name);

  if (!fs.existsSync(configPath)) {
    throw new Error(`Claw "${name}" not found.`);
  }

  const content = fs.readFileSync(configPath, 'utf-8');
  const parsed = yaml.load(content);

  try {
    return ClawConfigSchema.parse(parsed);
  } catch (error) {
    throw new Error(
      `Invalid claw config: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// Patch the primary LLM config in-place (raw YAML read/write, no Zod round-trip)
export function patchGlobalConfigPrimary(patch: Record<string, unknown>): void {
  const configPath = getGlobalConfigPath();
  const raw = yaml.load(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  const llm = (raw.llm ?? {}) as Record<string, unknown>;
  const primary = (llm.primary ?? {}) as Record<string, unknown>;
  llm.primary = { ...primary, ...patch };
  raw.llm = llm;
  fs.writeFileSync(configPath, yaml.dump(raw));
}

// Save claw config
export function saveClawConfig(name: string, config: ClawConfig): void {
  const clawDir = getClawDir(name);
  fs.mkdirSync(clawDir, { recursive: true });

  const configPath = getClawConfigPath(name);
  fs.writeFileSync(configPath, yaml.dump(config));
}

// Check if claw exists
export function clawExists(name: string): boolean {
  return fs.existsSync(getClawConfigPath(name));
}
