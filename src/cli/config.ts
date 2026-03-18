/**
 * CLI Configuration - 配置加载和类型定义
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import type { LLMServiceConfig, ProviderConfig } from '../foundation/llm/types.js';

// Re-export shared constants
export { CLAW_SUBDIRS } from '../types/paths.js';

// Zod Schemas (snake_case for YAML compatibility)
export const LLMProviderSchema = z.object({
  name: z.string(),
  api_key: z.string(),
  base_url: z.string().optional(),
  model: z.string(),
  max_tokens: z.number().default(4096),
  temperature: z.number().default(0.7),
  timeout_ms: z.number().default(60000),
  thinking: z.boolean().optional(),
  thinking_budget_tokens: z.number().optional(),
});

export const ClawGlobalConfigSchema = z.object({
  version: z.string().default('1'),
  llm: z.object({
    primary: LLMProviderSchema,
    fallback: LLMProviderSchema.optional(),
    retry_attempts: z.number().default(3),
    retry_delay_ms: z.number().default(1000),
  }),
  motion: z.object({
    heartbeat_interval_ms: z.number().default(300000),
  }).optional(),
});

export const ClawConfigSchema = z.object({
  name: z.string(),
  llm: z.object({
    primary: LLMProviderSchema.optional(),
  }).optional(),
  max_steps: z.number().default(100),
  tool_profile: z.enum(['full', 'readonly', 'subagent']).default('full'),
});

export type ClawGlobalConfig = z.infer<typeof ClawGlobalConfigSchema>;
export type ClawConfig = z.infer<typeof ClawConfigSchema>;

// Workspace root - 优先从环境变量获取（供 exec 子进程继承）
function getWorkspaceRoot(): string {
  return process.env.CLAWFORUM_ROOT ?? process.cwd();
}

// Paths
export function getGlobalConfigPath(): string {
  return path.join(getWorkspaceRoot(), '.clawforum', 'config.yaml');
}

export function getClawDir(name: string): string {
  return path.join(getWorkspaceRoot(), '.clawforum', 'claws', name);
}

export function getMotionDir(): string {
  return path.join(getWorkspaceRoot(), '.clawforum', 'motion');
}

export function getClawConfigPath(name: string): string {
  return path.join(getClawDir(name), 'config.yaml');
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
  
  try {
    return ClawGlobalConfigSchema.parse(parsed);
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

// Convert snake_case to camelCase
export function toProviderConfig(p: z.infer<typeof LLMProviderSchema>): ProviderConfig {
  return {
    name: p.name,
    apiKey: p.api_key,
    baseUrl: p.base_url,
    model: p.model,
    maxTokens: p.max_tokens,
    temperature: p.temperature,
    timeoutMs: p.timeout_ms,
    thinking: p.thinking,
    thinkingBudgetTokens: p.thinking_budget_tokens,
  };
}

// Build LLMServiceConfig from global + claw config
export function buildLLMConfig(
  globalConfig: ClawGlobalConfig,
  clawConfig?: ClawConfig
): LLMServiceConfig {
  // Use claw's primary if provided, otherwise use global's primary
  const primaryProvider = clawConfig?.llm?.primary 
    ? toProviderConfig(clawConfig.llm.primary)
    : toProviderConfig(globalConfig.llm.primary);
  
  // Fallback always from global
  const fallbackProvider = globalConfig.llm.fallback
    ? toProviderConfig(globalConfig.llm.fallback)
    : undefined;
  
  return {
    primary: primaryProvider,
    fallback: fallbackProvider,
    maxAttempts: globalConfig.llm.retry_attempts,
    retryDelayMs: globalConfig.llm.retry_delay_ms,
  };
}
