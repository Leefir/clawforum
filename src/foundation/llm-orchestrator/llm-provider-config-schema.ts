/**
 * LLMProvider config schema / phase 10 decentralize Config 拆解
 * Owner: llm-orchestrator（每 LLM provider 的 yaml schema 业主）
 * Source: 迁自 foundation/config/schemas.ts:41-59 createLLMProviderSchema
 */
import { z } from 'zod';
import {
  DEFAULT_LLM_TIMEOUT_MS,
} from './defaults.js';

// phase 10: LLM provider 自 own max_tokens default（ML#2 业务语义自负 / ML#5 消反向 import）
// 历史同源 step-executor REACT_DEFAULT_MAX_TOKENS、拆后各模块自管。
export const FORMAT_MAP: Record<string, string> = {
  '1': 'custom-anthropic',
  '2': 'custom-openai',
  '3': 'custom-gemini',
};

export const LLM_PROVIDER_DEFAULT_MAX_TOKENS = 100_000_000;

export const llmProviderConfigSchema = z.object({
  preset: z.string().min(1).optional(),
  label: z.string().optional(),
  api_key: z.string().min(1, 'api_key must not be empty'),
  base_url: z.string().optional(),
  model: z.string().optional(),
  max_tokens: z.number().min(1).max(100_000_000).default(LLM_PROVIDER_DEFAULT_MAX_TOKENS),
  temperature: z.number().min(0).max(2).default(0.7),
  timeout_ms: z.number().min(1000).max(600000).default(DEFAULT_LLM_TIMEOUT_MS),
  thinking: z.boolean().optional(),
  thinking_budget_tokens: z.number().min(1).optional(),
  thinking_mode: z.enum(['adaptive', 'enabled']).optional(),
  thinking_effort: z.enum(['low', 'medium', 'high']).optional(),
  extra_headers: z.record(z.string()).optional(),
  drop_thinking_blocks: z.boolean().optional(),
  reasoning_effort: z.enum(['low', 'medium', 'high']).optional(),
});

export type LLMProviderConfig = z.infer<typeof llmProviderConfigSchema>;
