/**
 * Config types - System configuration schemas
 * Phase 0: Zod schemas with TypeScript type inference
 */

import { z } from 'zod';

// ============================================================================
// LLM Provider Configuration
// ============================================================================

export const LLMProviderSchema = z.object({
  name: z.string(),
  api_key: z.string(),
  base_url: z.string().optional(),
  model: z.string(),
  max_tokens: z.number().default(4096),
  temperature: z.number().min(0).max(2).default(0.7),
  timeout_ms: z.number().default(60000),
});

export const LLMConfigSchema = z.object({
  primary: LLMProviderSchema,
  fallback: LLMProviderSchema.optional(),
  retry_attempts: z.number().default(3),
  retry_delay_ms: z.number().default(1000),
});

// ============================================================================
// Tool Profile Configuration
// ============================================================================

export const ToolProfileSchema = z.enum([
  'full',       // All tools available
  'readonly',   // Only read tools (read, ls, search)
  'subagent',   // Tools for subagent execution
  'dream',      // Tools for dream/night processing
]);

// ============================================================================
// Motion Configuration
// ============================================================================

export const MotionConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  
  // Claw management
  max_claws: z.number().default(10),
  auto_spawn: z.boolean().default(true),
  
  // Heartbeat
  heartbeat_interval_ms: z.number().default(30000),
  heartbeat_timeout_ms: z.number().default(120000),
  
  // Auth levels
  default_auth_level: z.enum(['auto', 'notify', 'confirm']).default('notify'),
  
  // Paths
  workspace_dir: z.string().default('./workspace'),
  
  // Cron settings
  cron: z.object({
    enabled: z.boolean().default(true),
    log_archive_hour: z.number().min(0).max(23).default(3),
    disk_check_interval_ms: z.number().default(3600000),
    dream_enabled: z.boolean().default(true),
    dream_start_hour: z.number().min(0).max(23).default(2),
    dream_end_hour: z.number().min(0).max(23).default(5),
  }).default({}),
});

// ============================================================================
// Claw Configuration
// ============================================================================

export const ClawConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  
  // Capabilities
  tool_profile: ToolProfileSchema.default('full'),
  allowed_skills: z.array(z.string()).default([]),
  
  // LLM settings
  llm: LLMConfigSchema,
  
  // Context management
  max_context_tokens: z.number().default(128000),
  context_compression_threshold: z.number().default(0.8),
  memory_ttl_hours: z.number().default(24),
  
  // Paths
  claw_dir: z.string(),
  
  // ReAct loop settings
  max_steps: z.number().default(100),
  step_timeout_ms: z.number().default(300000),
  
  // Subagent settings
  max_subagents: z.number().default(3),
  subagent_timeout_ms: z.number().default(600000),
});

// ============================================================================
// Global Configuration
// ============================================================================

export const ClawGlobalConfigSchema = z.object({
  version: z.string().default('0.1.0'),
  
  // System paths
  system_dir: z.string().default('./.clawforum'),
  logs_dir: z.string().default('./.clawforum/logs'),
  skills_dir: z.string().default('./skills'),
  
  // Global defaults
  default_llm: LLMProviderSchema.optional(),
  
  // Feature flags
  features: z.object({
    enable_monitoring: z.boolean().default(true),
    enable_contracts: z.boolean().default(true),
    enable_dream: z.boolean().default(true),
    enable_subagents: z.boolean().default(true),
  }).default({}),
});

// ============================================================================
// Type exports (inferred from schemas)
// ============================================================================

export type LLMProvider = z.infer<typeof LLMProviderSchema>;
export type LLMConfig = z.infer<typeof LLMConfigSchema>;
export type ToolProfile = z.infer<typeof ToolProfileSchema>;
export type MotionConfig = z.infer<typeof MotionConfigSchema>;
export type ClawConfig = z.infer<typeof ClawConfigSchema>;
export type ClawGlobalConfig = z.infer<typeof ClawGlobalConfigSchema>;

// Combined config for runtime
export interface ClawConfigRuntime {
  global: ClawGlobalConfig;
  claw: ClawConfig;
  motion?: MotionConfig;
}
