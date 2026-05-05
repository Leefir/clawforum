/**
 * @module L1.Config (factually L2 cross-cutting per arch §6)
 *
 * Zod schemas for global + claw configs / phase 500 sub-file extraction
 */

import { z } from 'zod';

// API format code → preset id (for manual entry)
export const FORMAT_MAP: Record<string, string> = {
  '1': 'custom-anthropic',
  '2': 'custom-openai',
  '3': 'custom-gemini',
};

// Zod Schemas (snake_case for YAML compatibility)
export const LLMProviderSchema = z.object({
  preset: z.string().optional(),
  label: z.string().optional(),
  api_key: z.string(),
  base_url: z.string().optional(),
  model: z.string().optional(),
  max_tokens: z.number().min(1).max(128000).default(4096),
  temperature: z.number().min(0).max(2).default(0.7),
  timeout_ms: z.number().min(1000).max(600000).default(60000),
  thinking: z.boolean().optional(),
  thinking_budget_tokens: z.number().min(1).optional(),
  thinking_mode: z.enum(['adaptive', 'enabled']).optional(),
  thinking_effort: z.enum(['low', 'medium', 'high']).optional(),
  extra_headers: z.record(z.string()).optional(),
  drop_thinking_blocks: z.boolean().optional(),
  reasoning_effort: z.enum(['low', 'medium', 'high']).optional(),
});

export const CircuitBreakerSchema = z.object({
  failure_threshold: z.number().min(1).max(20).default(3),
  reset_timeout_ms: z.number().min(1000).max(3600000).default(60000),
});

export const ClawGlobalConfigSchema = z.object({
  version: z.string().default('1'),
  default_max_steps: z.number().min(1).max(1000).optional(),
  llm: z.object({
    primary: LLMProviderSchema,
    fallbacks: z.array(LLMProviderSchema).optional(),
    retry_attempts: z.number().min(0).max(10).default(3),
    retry_delay_ms: z.number().min(0).max(60000).default(1000),
    circuit_breaker: CircuitBreakerSchema.optional(),
  }),
  motion: z.object({
    heartbeat_interval_ms: z.number().min(0).default(0),
    max_steps: z.number().min(1).max(1000).default(100),
    subagent_max_steps: z.number().min(1).max(200).optional(),
    max_concurrent_tasks: z.number().min(1).max(20).default(3),
    llm_idle_timeout_ms: z.number().min(0).max(600000).default(60000),
  }).optional(),
  tool_timeout_ms: z.number().min(1000).max(600000).default(60000),
  watchdog: z.object({
    interval_ms: z.number().min(5000).default(30000),
    disk_warning_mb: z.number().min(10).default(500),
    claw_inactivity_timeout_ms: z.number().min(60000).default(300000),
  }).optional(),
  cron: z.object({
    enabled: z.boolean().default(true),
    tick_interval_ms: z.number().min(100).max(60000).default(1000),
    jobs: z.object({
      disk_monitor: z.object({
        enabled: z.boolean().default(true),
        schedule: z.string().default('hourly'),
      }).optional(),
      llm_stats: z.object({
        enabled: z.boolean().default(true),
        schedule: z.string().default('daily:06:00'),
      }).optional(),
      dream_trigger: z.object({
        enabled: z.boolean().default(false),
        schedule: z.string().default('daily:04:00'),
        max_compression_tokens: z.number().min(500).max(20000).default(4000),
      }).optional(),
      contract_observer: z.object({
        enabled: z.boolean().default(true),
        schedule: z.string().default('interval:1m'),
      }).optional(),
    }).optional(),
  }).optional(),
  viewport: z.object({
    show_recap_stream: z.boolean().default(false),
    show_system_messages: z.boolean().default(false),
    show_contract_events: z.boolean().default(true),
    trim_output_newlines: z.boolean().default(true),
  }).optional(),
  audit: z.object({
    retention: z.object({
      max_size_mb: z.number().min(1).nullable().default(null),
    }).optional(),
  }).optional(),
  stream: z.object({
    retention: z.object({
      max_files: z.number().min(1).nullable().default(null),
      max_days: z.number().min(1).nullable().default(null),
    }).optional(),
  }).optional(),
});

export const ClawConfigSchema = z.object({
  name: z.string(),
  llm: z.object({
    primary: LLMProviderSchema.optional(),
  }).optional(),
  max_steps: z.number().min(1).max(1000).optional(),
  tool_profile: z.enum(['full', 'readonly', 'subagent', 'dream']).default('full'),
  subagent_max_steps: z.number().min(1).max(200).optional(),
  max_concurrent_tasks: z.number().min(1).max(20).default(3),
});

export type ClawGlobalConfig = z.infer<typeof ClawGlobalConfigSchema>;
export type ClawConfig = z.infer<typeof ClawConfigSchema>;

// Tool profile for tool permission management
export type ToolProfile = 'full' | 'readonly' | 'subagent' | 'dream';
